import { describe, expect, it } from 'vitest';
import { createSeedData } from '../../data/seed';
import type { AppData } from '../../data/types';
import { getProject, getWeek, recordEntry, updateProject } from '../ops';
import type { AgentContext } from './attribution';
import { memoryPortfolioStore, runTool, type PortfolioStore } from './run';

const NOW = new Date('2026-11-11T15:00:00Z');
const base = (now = NOW): Omit<AgentContext, 'opId'> => ({ now, timeZone: 'America/Toronto', agent: 'ChatGPT', clientId: 'client-1' });
const seed = () => createSeedData(new Date('2026-11-01T12:00:00Z'));
const dataOf = (s: ReturnType<typeof memoryPortfolioStore>) => s.row!.data as AppData;

describe('runTool — writes', () => {
  it('add_activity logs an attributed note and bumps the revision', async () => {
    const store = memoryPortfolioStore(seed());
    const r = await runTool(store, 'add_activity', { project: 'Antech', text: 'WordPress updates; Vendor Onboarding form changes; Customer Portal branding' }, base());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.revision).toBe(2);
    const e = dataOf(store).activity[0];
    expect(e).toMatchObject({ kind: 'note', projectId: 'antech', source: { type: 'agent', agent: 'ChatGPT', clientId: 'client-1' }, opId: r.opId });
    expect(getProject(dataOf(store), 'antech')!.lastActivity).toBe(NOW.toISOString());
  });

  it('never applies the same request twice', async () => {
    const store = memoryPortfolioStore(seed());
    const input = { project: 'antech', text: 'Same note', request_id: 'req-1' };
    await runTool(store, 'add_activity', input, base());
    const again = await runTool(store, 'add_activity', input, base(new Date(NOW.getTime() + 3_600_000)));
    expect(again).toMatchObject({ ok: true, duplicate: true, revision: 2 });
    expect(store.commits).toHaveLength(1);

    // Without request_id: identical arguments within 10 minutes are a repeat; later they are new.
    const s2 = memoryPortfolioStore(seed());
    await runTool(s2, 'add_activity', { text: 'Again' }, base());
    expect(await runTool(s2, 'add_activity', { text: 'Again' }, base(new Date(NOW.getTime() + 5 * 60_000)))).toMatchObject({ duplicate: true });
    expect(await runTool(s2, 'add_activity', { text: 'Again' }, base(new Date(NOW.getTime() + 11 * 60_000)))).toMatchObject({ ok: true, revision: 3 });
  });

  it('create_task adds a task with an attributed entry and refuses duplicates', async () => {
    const store = memoryPortfolioStore(seed());
    const r = await runTool(store, 'create_task', { project: 'oneshotz', title: 'Draft vendor schema', priority: 'high' }, base());
    expect(r.ok).toBe(true);
    const p = getProject(dataOf(store), 'oneshotz')!;
    const task = p.tasks.find((t) => t.title === 'Draft vendor schema')!;
    expect(task).toMatchObject({ status: 'todo', priority: 'high' });
    expect(task.due).toBeUndefined(); // no invented due date
    expect(dataOf(store).activity[0]).toMatchObject({ kind: 'task', taskId: task.id, text: 'Added task: Draft vendor schema' });

    const dup = await runTool(store, 'create_task', { project: 'oneshotz', title: 'draft vendor schema!', request_id: 'other' }, base());
    expect(dup).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } });
  });

  it('update_task completes and reopens via the existing ops rules', async () => {
    const store = memoryPortfolioStore(seed());
    const done = await runTool(store, 'update_task', { project: 'antech', task: 'customer portal branding', status: 'done' }, base());
    expect(done.ok).toBe(true);
    let t = getProject(dataOf(store), 'antech')!.tasks.find((x) => x.title === 'Customer Portal Branding')!;
    expect(t.completedAt).toBe(NOW.toISOString());
    expect(dataOf(store).activity[0]).toMatchObject({ kind: 'task', text: 'Finished task: Customer Portal Branding', taskId: t.id, source: { agent: 'ChatGPT' } });

    await runTool(store, 'update_task', { project: 'antech', task: t.id, status: 'todo' }, base());
    t = getProject(dataOf(store), 'antech')!.tasks.find((x) => x.id === t.id)!;
    expect(t.completedAt).toBeUndefined();
    expect(dataOf(store).activity[0].text).toBe('Task reopened: Customer Portal Branding');

    // The identical request again is recognised as a repeat…
    expect(await runTool(store, 'update_task', { project: 'antech', task: t.id, status: 'todo' }, base())).toMatchObject({ ok: true, duplicate: true });
    // …and a new request that changes nothing is rejected.
    expect(await runTool(store, 'update_task', { project: 'antech', task: t.id, status: 'todo', request_id: 'n' }, base())).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('update_project changes working fields, appends notes, and cannot touch status', async () => {
    const store = memoryPortfolioStore(seed());
    const before = getProject(seed(), 'ai-career-dev')!;
    const r = await runTool(store, 'update_project', { project: 'AI career development', next_action: 'Finish RAG eval write-up', append_notes: 'Built the eval harness today.' }, base());
    expect(r.ok).toBe(true);
    const p = getProject(dataOf(store), 'ai-career-dev')!;
    expect(p.nextAction).toBe('Finish RAG eval write-up');
    expect(p.notes.startsWith(before.notes.trimEnd())).toBe(true);
    expect(p.notes.endsWith('2026-11-11: Built the eval harness today.')).toBe(true);
    expect(p.status).toBe(before.status);
    expect(p.priority).toBe(before.priority);
    const kinds = dataOf(store).activity.slice(0, 2).map((e) => e.kind).sort();
    expect(kinds).toEqual(['next-action', 'project']);

    expect(await runTool(store, 'update_project', { project: 'antech', status: 'parked' }, base())).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('update_project can complete the next action and set the following one', async () => {
    const store = memoryPortfolioStore(seed());
    const cur = getProject(seed(), 'ravenloft')!.nextAction;
    await runTool(store, 'update_project', { project: 'ravenloft', complete_next_action: true, next_action: 'Stat the Death House encounters' }, base());
    expect(getProject(dataOf(store), 'ravenloft')!.nextAction).toBe('Stat the Death House encounters');
    expect(dataOf(store).activity[0].text).toContain(`Done: ${cur.slice(0, 20)}`);
  });

  it('update_week_plan adds focus once and keeps new blocks unscheduled', async () => {
    const store = memoryPortfolioStore(seed());
    const r = await runTool(store, 'update_week_plan', { add_focus: ['Ravenloft'], add_blocks: [{ title: 'Ravenloft prep', project: 'ravenloft', hours: 2 }] }, base());
    expect(r.ok).toBe(true);
    const w = getWeek(dataOf(store), '2026-11-09');
    expect(w.focusProjectIds).toEqual(['ravenloft']);
    expect(w.blocks).toHaveLength(1);
    expect(w.blocks[0].day).toBeUndefined();
    const again = await runTool(store, 'update_week_plan', { add_focus: ['ravenloft'], request_id: 'second' }, base());
    expect(again).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(getWeek(dataOf(store), '2026-11-09').focusProjectIds).toEqual(['ravenloft']);
  });

  it('reports ambiguity instead of guessing', async () => {
    const store = memoryPortfolioStore(seed());
    const r = await runTool(store, 'add_activity', { project: 'Olympus', text: 'x' }, base());
    expect(r).toMatchObject({ ok: false, error: { code: 'AMBIGUOUS_REFERENCE' } });
    expect(store.commits).toHaveLength(0);
  });
});

describe('runTool — concurrency and failure', () => {
  it('rebases on a concurrent browser edit instead of overwriting it', async () => {
    const store = memoryPortfolioStore(seed());
    let first = true;
    const racing: PortfolioStore = {
      load: store.load,
      async commit(rev, data, meta) {
        if (first) {
          first = false;
          // A browser saves between our load and our commit.
          store.externalWrite((d) => recordEntry(d, 'mindjax', 'note', 'Edited in the browser'));
        }
        return store.commit(rev, data, meta);
      },
    };
    const r = await runTool(racing, 'add_activity', { project: 'antech', text: 'From ChatGPT' }, base());
    expect(r).toMatchObject({ ok: true, attempts: 2, revision: 3 });
    const texts = dataOf(store).activity.map((e) => e.text);
    expect(texts).toContain('Edited in the browser');
    expect(texts).toContain('From ChatGPT');
    expect(texts.filter((t) => t === 'From ChatGPT')).toHaveLength(1);
  });

  it('gives up after bounded retries without a partial write', async () => {
    const store = memoryPortfolioStore(seed());
    const busy: PortfolioStore = {
      load: store.load,
      async commit(rev, data, meta) {
        store.externalWrite((d) => updateProject(d, 'mindjax', { blockers: `busy ${Math.random()}` }));
        return store.commit(rev, data, meta);
      },
    };
    const r = await runTool(busy, 'add_activity', { text: 'Never lands' }, base(), { maxAttempts: 3 });
    expect(r).toMatchObject({ ok: false, error: { code: 'CONFLICT_RETRY_EXHAUSTED' } });
    expect(dataOf(store).activity.some((e) => e.text === 'Never lands')).toBe(false);
    expect(store.commits).toHaveLength(0);
  });

  it('refuses to operate on invalid stored data, missing data, or unknown tools', async () => {
    const bad = memoryPortfolioStore({ ...seed(), projects: [{ id: 'x' }] } as unknown as AppData);
    expect(await runTool(bad, 'list_projects', {}, base())).toMatchObject({ ok: false, error: { code: 'DATA_INVALID' } });
    expect(await runTool(memoryPortfolioStore(null), 'get_week_plan', {}, base())).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await runTool(memoryPortfolioStore(seed()), 'delete_everything', {}, base())).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('maps unexpected storage errors to INTERNAL with the op id', async () => {
    const broken: PortfolioStore = {
      load: async () => {
        throw new Error('db down: secret details');
      },
      commit: async () => ({ ok: false, reason: 'conflict' }),
    };
    const r = await runTool(broken, 'add_activity', { text: 'x' }, base());
    expect(r).toMatchObject({ ok: false, error: { code: 'INTERNAL', message: 'Unexpected error.' } });
    if (!r.ok) expect(r.error.opId).toMatch(/^h:/);
  });

  it('reads do not write', async () => {
    const store = memoryPortfolioStore(seed());
    const r = await runTool(store, 'list_projects', { focus_only: true }, base());
    expect(r).toMatchObject({ ok: true, revision: 1 });
    expect(store.commits).toHaveLength(0);
  });
});

describe('portability of shared domain code', () => {
  // Raw sources of every module the MCP server will reuse (loaded by Vite, no Node APIs needed).
  const sources = {
    ...import.meta.glob(['../ops.ts', '../dates.ts', '../storage.ts', '../selectors.ts', '../sync.ts'], { query: '?raw', import: 'default', eager: true }),
    ...import.meta.glob(['../../data/meta.ts', '../../data/seed.ts', '../../data/types.ts'], { query: '?raw', import: 'default', eager: true }),
    ...import.meta.glob(['./*.ts', '!./*.test.ts'], { query: '?raw', import: 'default', eager: true }),
  } as Record<string, string>;

  it('covers the shared modules', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(17);
  });

  it.each(Object.entries(sources))('%s only uses relative .ts imports and no browser/Vite APIs', (f, raw) => {
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) expect(m[1], `${f}: ${m[1]}`).toMatch(/^\.{1,2}\/.*\.ts$/);
    expect(src).not.toMatch(/window\.|localStorage|document\.|import\.meta\.env/);
  });
});
