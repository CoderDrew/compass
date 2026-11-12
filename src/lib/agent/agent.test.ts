import { describe, expect, it } from 'vitest';
import { createSeedData } from '../../data/seed';
import type { AppData } from '../../data/types';
import { toggleFocus, updateProject } from '../ops';
import { parseAppData, validate } from '../storage';
import { AgentFailure, type AgentError } from './errors';
import { attributeNewEntries, deriveOpId, findPriorOp, hash64, type AgentContext } from './attribution';
import { checkInvariants } from './invariants';
import { resolveProject, resolveTask } from './resolve';
import { parseInput, toJsonSchema } from './schema';
import { currentWeekStart, isMonday, localDateIn, mondayOf } from './time';
import { TOOLS } from './tools';

const NOW = new Date('2026-11-11T15:00:00Z'); // Wednesday; Toronto 10:00
const TZ = 'America/Toronto';
const ctx = (over: Partial<AgentContext> = {}): AgentContext => ({ now: NOW, timeZone: TZ, agent: 'ChatGPT', clientId: 'client-1', opId: 'r:test', ...over });
const seed = () => createSeedData(new Date('2026-11-01T12:00:00Z'));

function errorOf(fn: () => unknown): AgentError {
  try {
    fn();
  } catch (e) {
    if (e instanceof AgentFailure) return e.error;
    throw e;
  }
  throw new Error('expected an AgentFailure');
}

describe('time helpers', () => {
  it('computes the user-local date and week, not the server (UTC) one', () => {
    expect(localDateIn(TZ, new Date('2026-11-10T03:00:00Z'))).toBe('2026-11-09'); // still Monday evening in Toronto
    expect(localDateIn('UTC', new Date('2026-11-10T03:00:00Z'))).toBe('2026-11-10');
    expect(currentWeekStart(TZ, NOW)).toBe('2026-11-09');
    expect(mondayOf('2026-11-15')).toBe('2026-11-09'); // Sunday belongs to the week starting Monday
    expect(isMonday('2026-11-09')).toBe(true);
    expect(isMonday('2026-11-10')).toBe(false);
    expect(isMonday('2026-02-30')).toBe(false);
  });
});

describe('reference resolution', () => {
  const d = seed();
  it('prefers stable ids, case-insensitively', () => {
    expect(resolveProject(d, 'starfall').id).toBe('starfall');
    expect(resolveProject(d, 'Starfall').id).toBe('starfall'); // not ambiguous with "Starfall — Terrain Photo Library"
    expect(resolveProject(d, 'Tablebook').id).toBe('tablebook');
  });
  it('matches names loosely but only when unambiguous', () => {
    expect(resolveProject(d, 'Lighthouse').id).toBe('lighthouse');
    expect(resolveProject(d, 'skills development').id).toBe('skills-dev');
    expect(resolveProject(d, 'my skills development project').id).toBe('skills-dev');
    expect(resolveProject(d, 'community pantry').id).toBe('community-pantry');
  });
  it('reports ambiguity with candidates instead of guessing', () => {
    const e = errorOf(() => resolveProject(d, 'Harbor'));
    expect(e.code).toBe('AMBIGUOUS_REFERENCE');
    expect(e.candidates?.map((c) => c.id).sort()).toEqual(['harbor-social', 'harbor-web']);
  });
  it('reports not-found with suggestions', () => {
    const e = errorOf(() => resolveProject(d, 'Harbor podcast'));
    expect(e.code).toBe('NOT_FOUND');
    expect(e.suggestions?.length).toBeGreaterThan(0);
    expect(errorOf(() => resolveProject(d, 'zzzz')).suggestions).toEqual([]);
  });
  it('resolves tasks within the project and hints when the user meant a milestone', () => {
    const job = resolveProject(d, 'day-job');
    expect(resolveTask(job, 'supplier intake').title).toBe('Supplier intake form');
    const e = errorOf(() => resolveTask(resolveProject(d, 'starfall'), 'playtesting'));
    expect(e.code).toBe('NOT_FOUND');
    expect(e.message).toContain('milestone matches: "Physical playtesting round"');
  });
});

describe('input schemas', () => {
  it('rejects unknown fields, bad dates, non-Mondays and overlong text', () => {
    const bad = (tool: keyof typeof TOOLS, input: unknown) => errorOf(() => parseInput(TOOLS[tool].input, input));
    expect(bad('update_project', { project: 'day-job', status: 'parked' }).details).toContain('status is not a recognised field');
    expect(bad('create_task', { project: 'day-job', title: 'x', due: '2026-13-01' }).code).toBe('INVALID_INPUT');
    expect(bad('create_task', { project: 'day-job', title: 'x', due: '2026-02-30' }).code).toBe('INVALID_INPUT');
    expect(bad('create_task', { project: 'day-job', title: 'x', due: '2026-13' }).code).toBe('INVALID_INPUT');
    expect(bad('get_week_plan', { week_start: '2026-11-11' }).details?.[0]).toMatch(/Monday/);
    expect(bad('add_activity', { text: 'x'.repeat(4001) }).details?.[0]).toMatch(/at most 4000/);
    expect(bad('add_activity', { text: '   ' }).details?.[0]).toMatch(/empty/);
    expect(bad('create_task', {}).details).toEqual(expect.arrayContaining(['project is required', 'title is required']));
  });
  it('accepts month-only dates and null to clear', () => {
    expect(parseInput(TOOLS.update_task.input, { project: 'a', task: 'b', due: '2027-02' })).toMatchObject({ due: '2027-02' });
    expect(parseInput(TOOLS.update_task.input, { project: 'a', task: 'b', due: null })).toMatchObject({ due: null });
  });
  it('publishes closed JSON Schemas for every tool', () => {
    for (const [name, t] of Object.entries(TOOLS)) {
      const js = toJsonSchema(t.input);
      expect(js.type, name).toBe('object');
      expect(js.additionalProperties, name).toBe(false);
    }
    expect(toJsonSchema(TOOLS.create_task.input).required).toEqual(['project', 'title']);
  });
});

describe('read tools', () => {
  it('list_projects hides archived, filters focus and finds stale projects without nagging hobbies', () => {
    let d = seed();
    d = updateProject(d, 'retro-campaign', { status: 'archived' });
    d = toggleFocus(d, '2026-11-09', 'lighthouse');
    d = { ...d, projects: d.projects.map((p) => (p.id === 'guitar' || p.id === 'rpg-tools' ? { ...p, lastActivity: '2026-09-01T12:00:00Z' } : p)) };

    const all = TOOLS.list_projects.run(d, {}, ctx()) as { projects: { id: string }[]; total: number };
    expect(all.projects.some((p) => p.id === 'retro-campaign')).toBe(false);

    const focus = TOOLS.list_projects.run(d, { focus_only: true }, ctx()) as { projects: { id: string; inFocus: boolean }[] };
    expect(focus.projects.map((p) => p.id)).toEqual(['lighthouse']);

    const stale = TOOLS.list_projects.run(d, { stale_days: 30 }, ctx()) as { projects: { id: string; daysSinceActivity: number; lowPressure: boolean; attention: string[] }[] };
    expect(stale.projects.map((p) => p.id).sort()).toEqual(['guitar', 'rpg-tools']);
    const guitar = stale.projects.find((p) => p.id === 'guitar')!;
    expect(guitar.lowPressure).toBe(true);
    expect(guitar.attention).toEqual([]); // hobbies never "need attention"

    const attention = TOOLS.list_projects.run(d, { needs_attention: true }, ctx()) as { projects: { id: string }[] };
    expect(attention.projects.some((p) => p.id === 'guitar')).toBe(false);
  });

  it('get_project returns tasks, milestones and recent activity', () => {
    const r = TOOLS.get_project.run(seed(), { project: 'Day Job' }, ctx()) as { id: string; tasks: unknown[]; milestones: unknown[] };
    expect(r.id).toBe('day-job');
    expect(r.tasks).toHaveLength(5);
  });

  it('get_activity filters by project, kind and user-local dates', () => {
    let d = seed();
    d = updateProject(d, 'day-job', { nextAction: 'Ship portal' }, new Date('2026-11-10T03:00:00Z')); // Nov 9 in Toronto
    const r = TOOLS.get_activity.run(d, { project: 'day-job', since: '2026-11-09', until: '2026-11-09' }, ctx()) as { entries: { kind: string }[] };
    expect(r.entries.map((e) => e.kind)).toEqual(['next-action']);
    const none = TOOLS.get_activity.run(d, { project: 'day-job', since: '2026-11-10' }, ctx()) as { entries: unknown[] };
    expect(none.entries).toEqual([]);
  });

  it("get_week_plan defaults to the user's current week", () => {
    const r = TOOLS.get_week_plan.run(seed(), {}, ctx()) as { weekStart: string; capacityHours: number };
    expect(r.weekStart).toBe('2026-11-09');
    expect(r.capacityHours).toBe(12);
  });
});

describe('attribution and idempotency', () => {
  it('derives stable ids from request_id, time-stamped hashes otherwise', () => {
    expect(deriveOpId('add_activity', { text: 'a', request_id: 'x' }, NOW)).toBe(deriveOpId('add_activity', { request_id: 'x', text: 'b' }, new Date()));
    const h1 = deriveOpId('add_activity', { text: 'a', kind: 'note' }, NOW);
    const h2 = deriveOpId('add_activity', { kind: 'note', text: 'a' }, new Date(NOW.getTime() + 1000));
    expect(h1.split(':')[1]).toBe(h2.split(':')[1]);
    expect(h1).not.toBe(h2);
    expect(hash64('a')).not.toBe(hash64('b'));
  });

  it('stamps only new entries and finds prior operations', () => {
    const before = seed();
    const after = updateProject(before, 'day-job', { nextAction: 'x', blockers: 'y' }, NOW);
    const stamped = attributeNewEntries(before, after, ctx({ opId: 'r:abc' }), 't-1');
    const fresh = stamped.activity.slice(0, 2);
    expect(fresh.every((e) => e.opId === 'r:abc' && e.source?.agent === 'ChatGPT' && e.source.clientId === 'client-1' && e.taskId === 't-1')).toBe(true);
    expect(stamped.activity[2].source).toBeUndefined();
    expect(findPriorOp(stamped, 'r:abc', NOW)).toHaveLength(2);
    expect(findPriorOp(stamped, 'r:other', NOW)).toHaveLength(0);
  });

  it('activity attribution is optional and validated', () => {
    const d = seed();
    expect(validate(d)).toEqual([]);
    const withSource = { ...d, activity: [{ ...d.activity[0], source: { type: 'agent', agent: 'ChatGPT' }, opId: 'r:1', taskId: 't' }] };
    expect(validate(withSource)).toEqual([]);
    expect(validate({ ...d, activity: [{ ...d.activity[0], source: { type: 'robot' } }] })[0]).toMatch(/invalid source/);
    expect(validate({ ...d, activity: [{ ...d.activity[0], opId: 5 }] })[0]).toMatch(/invalid reference/);
    // Round-trips through import parsing unchanged.
    expect(parseAppData(JSON.stringify(withSource)).activity[0].source).toEqual({ type: 'agent', agent: 'ChatGPT' });
  });
});

describe('invariants', () => {
  const before = seed();
  const reject = (after: AppData, scope = { projectId: 'day-job' }) => errorOf(() => checkInvariants(before, after, scope));

  it('allow a scoped change', () => {
    expect(() => checkInvariants(before, updateProject(before, 'day-job', { nextAction: 'x' }, NOW), { projectId: 'day-job' })).not.toThrow();
  });
  it('reject status, priority and deadline changes', () => {
    expect(reject(updateProject(before, 'day-job', { status: 'parked' })).code).toBe('NOT_ALLOWED');
    expect(reject(updateProject(before, 'day-job', { priority: 'low' })).details?.[0]).toMatch(/priority/);
    expect(reject(updateProject(before, 'day-job', { deadline: '2027-01-01' })).details?.[0]).toMatch(/deadline/);
  });
  it('reject changes outside the target and any removal', () => {
    expect(reject(updateProject(before, 'mindjax', { nextAction: 'x' })).details?.[0]).toMatch(/Mindjax/);
    expect(reject({ ...before, projects: before.projects.slice(1) }).code).toBe('NOT_ALLOWED');
    expect(reject({ ...before, projects: before.projects.map((p) => (p.id === 'day-job' ? { ...p, tasks: [] } : p)) }).details).toContain(
      'Day Job — Internal Tools: tasks must not be removed',
    );
    expect(reject({ ...before, activity: [] }).details).toContain('activity history must not be removed');
    expect(reject({ ...before, settings: { ...before.settings, weeklyCapacity: 99 } }).details).toContain('settings must not change');
  });
});
