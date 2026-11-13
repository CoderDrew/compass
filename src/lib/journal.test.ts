import { describe, expect, it } from 'vitest';
import { createSeedData } from '../data/seed';
import type { AppData } from '../data/types';
import { checkInvariants } from './agent/invariants';
import { addJournalEntry, deleteJournalEntry, journalForDay, MAX_JOURNAL_TEXT, recordEntry, updateJournalEntry } from './ops';
import { isPristineSeed } from './sync';
import { parseAppData, validate } from './storage';

const NOW = new Date(2026, 10, 13, 9, 0);
const LATER = new Date(2026, 10, 13, 17, 30);
const seed = () => createSeedData(NOW);

describe('journal', () => {
  it('adds trimmed entries newest first and leaves the activity log alone', () => {
    let d = addJournalEntry(seed(), { day: '2026-11-13', text: '  First  ' }, NOW);
    d = addJournalEntry(d, { day: '2026-11-13', text: 'Second', keep: true, projectIds: ['starfall', 'nope'] }, LATER);
    expect(d.journal.map((j) => j.text)).toEqual(['Second', 'First']);
    expect(d.journal[0]).toMatchObject({ keep: true, projectIds: ['starfall'] });
    expect(d.journal[1].keep).toBeUndefined();
    expect(d.activity).toHaveLength(1);
    expect(validate(d)).toEqual([]);
  });

  it('ignores empty text and caps length', () => {
    const d = seed();
    expect(addJournalEntry(d, { day: '2026-11-13', text: '   ' })).toBe(d);
    expect(addJournalEntry(d, { day: '2026-11-13', text: 'x'.repeat(5000) }).journal[0].text).toHaveLength(MAX_JOURNAL_TEXT);
  });

  it('reads a day oldest first', () => {
    let d = addJournalEntry(seed(), { day: '2026-11-13', text: 'a' }, NOW);
    d = addJournalEntry(d, { day: '2026-11-12', text: 'yesterday' }, NOW);
    d = addJournalEntry(d, { day: '2026-11-13', text: 'b' }, LATER);
    expect(journalForDay(d, '2026-11-13').map((j) => j.text)).toEqual(['a', 'b']);
  });

  it('edits text and keep, but never agent-written entries', () => {
    let d = addJournalEntry(seed(), { day: '2026-11-13', text: 'Mine' }, NOW);
    const id = d.journal[0].id;
    d = updateJournalEntry(d, id, { text: 'Mine, edited', keep: true }, LATER);
    expect(d.journal[0]).toMatchObject({ text: 'Mine, edited', keep: true, editedAt: LATER.toISOString() });
    d = updateJournalEntry(d, id, { keep: false });
    expect('keep' in d.journal[0]).toBe(false);

    const agent: AppData = { ...d, journal: [{ id: 'j-agent', day: '2026-11-13', at: LATER.toISOString(), text: 'Summary', source: { type: 'agent', agent: 'Claude' } }, ...d.journal] };
    expect(updateJournalEntry(agent, 'j-agent', { text: 'Rewritten', keep: true })).toBe(agent);
    expect(deleteJournalEntry(agent, id).journal.map((j) => j.id)).toEqual(['j-agent']);
  });

  it('loads older data without a journal, and keeps it through a round trip', () => {
    const { journal: _omit, ...old } = seed();
    expect(parseAppData(JSON.stringify(old)).journal).toEqual([]);
    const d = addJournalEntry(seed(), { day: '2026-11-13', text: 'Keep me' }, NOW);
    expect(parseAppData(JSON.stringify(d)).journal).toEqual(d.journal);
  });

  it('rejects malformed entries', () => {
    const bad = { ...seed(), journal: [{ id: 'j1', day: '13/11/2026', at: NOW.toISOString(), text: 'x' }] };
    expect(validate(bad)).toEqual(['Journal entry #1 is invalid.']);
    expect(validate({ ...seed(), journal: {} })).toEqual(['"journal" must be a list.']);
  });

  it('counts a journal-only browser as having real data', () => {
    expect(isPristineSeed(seed())).toBe(true);
    expect(isPristineSeed(addJournalEntry(seed(), { day: '2026-11-13', text: 'note' }, NOW))).toBe(false);
  });

  it('agent writes must leave the journal untouched', () => {
    const before = addJournalEntry(seed(), { day: '2026-11-13', text: 'Private note' }, NOW);
    const ok = recordEntry(before, 'starfall', 'note', 'Agent progress', LATER);
    expect(() => checkInvariants(before, ok, { projectId: 'starfall' })).not.toThrow();
    expect(() => checkInvariants(before, { ...ok, journal: [] }, { projectId: 'starfall' })).toThrow(/journal must not change/);
  });
});
