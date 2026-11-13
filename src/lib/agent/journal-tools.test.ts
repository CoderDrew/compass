import { describe, expect, it } from 'vitest';
import { createSeedData } from '../../data/seed';
import type { AppData } from '../../data/types';
import { addJournalEntry, recordEntry } from '../ops';
import type { AgentContext } from './attribution';
import { checkInvariants } from './invariants';
import { memoryPortfolioStore, runTool } from './run';
import { MAX_SUMMARIES_PER_DAY } from './tools';

// Wednesday 2026-11-11, 22:30 in Toronto = 03:30 UTC Thursday: "today" must be the user's day.
const NOW = new Date('2026-11-12T03:30:00Z');
const base = (now = NOW): Omit<AgentContext, 'opId'> => ({ now, timeZone: 'America/Toronto', agent: 'Claude', clientId: 'client-1' });
const dataOf = (s: ReturnType<typeof memoryPortfolioStore>) => s.row!.data as AppData;

/** Seed with one private note, one starred note and an older starred note. */
function seeded(): AppData {
  let d = createSeedData(new Date('2026-11-01T12:00:00Z'));
  d = addJournalEntry(d, { day: '2026-11-11', text: 'Private thought' }, new Date('2026-11-11T14:00:00Z'));
  d = addJournalEntry(d, { day: '2026-11-11', text: 'Remember: offline_access', keep: true }, new Date('2026-11-11T15:00:00Z'));
  d = addJournalEntry(d, { day: '2026-10-01', text: 'Old starred', keep: true }, new Date('2026-10-01T15:00:00Z'));
  return d;
}

describe('add_journal_summary', () => {
  it("posts an attributed summary on the user's day and keeps every existing note", async () => {
    const store = memoryPortfolioStore(seeded());
    const before = dataOf(store).journal;
    const r = await runTool(store, 'add_journal_summary', { text: '  Built the journal MCP tools.  ', projects: ['Starfall'], request_id: 'j1' }, base());
    expect(r).toMatchObject({ ok: true, revision: 2, result: { entry: { day: '2026-11-11', author: 'Claude', text: 'Built the journal MCP tools.', projects: [{ id: 'starfall' }] } } });
    const d = dataOf(store);
    expect(d.journal[0]).toMatchObject({ day: '2026-11-11', source: { type: 'agent', agent: 'Claude', clientId: 'client-1' }, projectIds: ['starfall'] });
    expect(d.journal[0].opId).toBe(r.ok ? r.opId : undefined);
    expect(d.journal.slice(1)).toEqual(before);
    expect(d.activity).toEqual(seeded().activity); // the summary isn't copied into the activity log
  });

  it('never posts the same summary twice', async () => {
    const store = memoryPortfolioStore(seeded());
    await runTool(store, 'add_journal_summary', { text: 'Same', request_id: 'j1' }, base());
    expect(await runTool(store, 'add_journal_summary', { text: 'Same', request_id: 'j1' }, base(new Date(NOW.getTime() + 3_600_000)))).toMatchObject({
      ok: true,
      duplicate: true,
      result: { entries: [{ kind: 'journal', text: 'Same' }] },
    });
    // Without request_id: identical arguments within 10 minutes are a repeat.
    await runTool(store, 'add_journal_summary', { text: 'No id' }, base());
    expect(await runTool(store, 'add_journal_summary', { text: 'No id' }, base(new Date(NOW.getTime() + 60_000)))).toMatchObject({ duplicate: true });
    expect(dataOf(store).journal.filter((j) => j.source)).toHaveLength(2);
  });

  it('accepts a recent past day but not the future or far back', async () => {
    const store = memoryPortfolioStore(seeded());
    expect(await runTool(store, 'add_journal_summary', { text: 'Yesterday', day: '2026-11-10' }, base())).toMatchObject({ ok: true });
    expect(await runTool(store, 'add_journal_summary', { text: 'Tomorrow', day: '2026-11-12' }, base())).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await runTool(store, 'add_journal_summary', { text: 'Ancient', day: '2026-11-01' }, base())).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('resolves projects strictly and refuses unknown fields', async () => {
    const store = memoryPortfolioStore(seeded());
    expect(await runTool(store, 'add_journal_summary', { text: 'x', projects: ['Harbor'] }, base())).toMatchObject({ ok: false, error: { code: 'AMBIGUOUS_REFERENCE' } });
    expect(await runTool(store, 'add_journal_summary', { text: 'x', keep: true }, base())).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(store.commits).toHaveLength(0);
  });

  it('caps summaries per day', async () => {
    let d = seeded();
    for (let n = 0; n < MAX_SUMMARIES_PER_DAY; n++)
      d = { ...d, journal: [{ id: `j-a${n}`, day: '2026-11-11', at: NOW.toISOString(), text: `s${n}`, source: { type: 'agent', agent: 'Claude' } }, ...d.journal] };
    const store = memoryPortfolioStore(d);
    expect(await runTool(store, 'add_journal_summary', { text: 'one more' }, base())).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } });
  });
});

describe('get_journal', () => {
  it("returns summaries and starred notes from the last 7 days, never the user's private notes", async () => {
    const store = memoryPortfolioStore(seeded());
    await runTool(store, 'add_journal_summary', { text: 'Agent summary' }, base());
    const r = await runTool(store, 'get_journal', {}, base());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = r.result as { since: string; entries: { text: string; author: string; starred?: boolean }[] };
    expect(res.since).toBe('2026-11-05');
    expect(res.entries.map((e) => e.text)).toEqual(['Agent summary', 'Remember: offline_access']);
    expect(res.entries[1]).toMatchObject({ author: 'user', starred: true });
    expect(JSON.stringify(res)).not.toContain('Private thought');

    const old = await runTool(store, 'get_journal', { since: '2026-09-01', until: '2026-10-31' }, base());
    expect(old.ok && (old.result as { entries: { text: string }[] }).entries.map((e) => e.text)).toEqual(['Old starred']);
  });
});

describe('journal invariants', () => {
  const d = seeded();
  const agentEntry = { id: 'j-new', day: '2026-11-11', at: NOW.toISOString(), text: 'New', source: { type: 'agent' as const, agent: 'Claude' } };
  it('other tools may not touch the journal', () => {
    const after = recordEntry(d, 'starfall', 'note', 'x');
    expect(() => checkInvariants(d, { ...after, journal: [agentEntry, ...d.journal] }, { projectId: 'starfall' })).toThrow(/journal must not change/);
  });
  it('appending allows only new agent entries, never edits or deletes', () => {
    expect(() => checkInvariants(d, { ...d, journal: [agentEntry, ...d.journal] }, { journalAppend: true })).not.toThrow();
    expect(() => checkInvariants(d, { ...d, journal: [{ ...agentEntry, source: undefined }, ...d.journal] }, { journalAppend: true })).toThrow(/agent summaries/);
    expect(() => checkInvariants(d, { ...d, journal: [{ ...agentEntry, keep: true }, ...d.journal] }, { journalAppend: true })).toThrow(/agent summaries/);
    expect(() => checkInvariants(d, { ...d, journal: d.journal.slice(1) }, { journalAppend: true })).toThrow(/journal must not change/);
    expect(() => checkInvariants(d, { ...d, journal: d.journal.map((j, n) => (n ? j : { ...j, text: 'edited' })) }, { journalAppend: true })).toThrow(/journal must not change/);
  });
});
