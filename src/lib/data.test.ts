import { describe, expect, it } from 'vitest';
import { createSeedData } from '../data/seed';
import { SCHEMA_VERSION } from '../data/types';
import {
  addMilestone, addProject, addTask, completeNextAction, deleteProject, getWeek, newProject, recordEntry, toggleFocus, updateMilestone, updateProject, updateTask,
} from './ops';
import {
  BACKUP_KEY, STORAGE_KEY, backupCurrent, exportJSON, loadData, memoryStorage, migrate, parseAppData, saveData, validate,
} from './storage';
import { attentionReasons, capacityState, datedItems, EMPTY_FILTERS, matchesFilters, progressOf, urgencyOf } from './selectors';

const NOW = new Date(2026, 10, 10, 9, 0); // Nov 10 2026

describe('seed data', () => {
  const d = createSeedData(NOW);
  it('contains every initial project with unique ids', () => {
    expect(d.projects).toHaveLength(18);
    expect(new Set(d.projects.map((p) => p.id)).size).toBe(18);
    expect(validate(d)).toEqual([]);
  });
  it('related project links all resolve', () => {
    const ids = new Set(d.projects.map((p) => p.id));
    for (const p of d.projects) for (const r of p.relatedIds) expect(ids.has(r)).toBe(true);
  });
  it('only stores deadlines that were stated (month precision for Genghis)', () => {
    const withDeadline = d.projects.filter((p) => p.deadline);
    expect(withDeadline.map((p) => p.id).sort()).toEqual(['hazard-quest', 'ravenloft']);
    expect(withDeadline.every((p) => p.deadline === '2027-02')).toBe(true);
  });
});

describe('persistence', () => {
  it('seeds on first load and round-trips through storage', () => {
    const kv = memoryStorage();
    const first = loadData(kv);
    expect(first.source).toBe('seed');
    const changed = updateProject(first.data, 'voidraider', { nextAction: 'Write v0.3 rules' }, NOW);
    saveData(kv, changed);
    const again = loadData(kv);
    expect(again.source).toBe('stored');
    expect(again.data.projects.find((p) => p.id === 'voidraider')?.nextAction).toBe('Write v0.3 rules');
  });

  it('keeps unreadable data instead of overwriting it silently', () => {
    const kv = memoryStorage({ [STORAGE_KEY]: '{not json' });
    const res = loadData(kv);
    expect(res.source).toBe('recovered');
    expect(Object.keys(kv.dump()).some((k) => k.startsWith(`${STORAGE_KEY}:corrupt:`))).toBe(true);
  });

  it('backs up current data before replacing it', () => {
    const kv = memoryStorage({ [STORAGE_KEY]: '{"x":1}' });
    backupCurrent(kv);
    expect(kv.getItem(BACKUP_KEY)).toBe('{"x":1}');
  });
});

describe('import / export', () => {
  it('exports JSON that imports back identically', () => {
    const d = toggleFocus(createSeedData(NOW), '2026-11-09', 'ravenloft', NOW);
    const back = parseAppData(exportJSON(d));
    expect(back.projects).toEqual(d.projects);
    expect(back.weeks).toEqual(d.weeks);
    expect(back.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('rejects invalid JSON and invalid shapes with readable errors', () => {
    expect(() => parseAppData('nope')).toThrow(/not valid JSON/);
    expect(() => parseAppData('[]')).toThrow(/does not contain/);
    expect(() => parseAppData('{"projects": 3}')).toThrow(/failed validation/);
    const bad = createSeedData(NOW) as unknown as { projects: { status: string }[] };
    bad.projects[0].status = 'someday';
    expect(() => parseAppData(JSON.stringify(bad))).toThrow(/invalid status/);
  });

  it('rejects files from a newer schema version', () => {
    expect(() => parseAppData(JSON.stringify({ ...createSeedData(NOW), schemaVersion: 99 }))).toThrow(/newer version/);
  });

  it('migrates unversioned data', () => {
    const { schemaVersion: _v, ...legacy } = createSeedData(NOW);
    expect(migrate(legacy as Record<string, unknown>).schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('project operations', () => {
  it('logs status changes and next-action updates', () => {
    const d = updateProject(createSeedData(NOW), 'friday-food-bag', { status: 'active', nextAction: 'Kickoff call' }, NOW);
    const p = d.projects.find((x) => x.id === 'friday-food-bag')!;
    expect(p.status).toBe('active');
    expect(d.activity.slice(0, 2).map((a) => a.kind).sort()).toEqual(['next-action', 'status']);
  });

  it('adds and deletes projects, cleaning up references', () => {
    let d = createSeedData(NOW);
    const p = newProject({ name: 'New thing', category: 'software', relatedIds: ['oneshotz'] }, NOW);
    d = addProject(d, p, NOW);
    d = toggleFocus(d, '2026-11-09', p.id, NOW);
    d = updateProject(d, 'oneshotz', { relatedIds: [p.id] }, NOW);
    d = deleteProject(d, p.id, NOW);
    expect(d.projects.find((x) => x.id === p.id)).toBeUndefined();
    expect(d.projects.find((x) => x.id === 'oneshotz')!.relatedIds).toEqual([]);
    expect(getWeek(d, '2026-11-09').focusProjectIds).not.toContain(p.id);
  });

  it('completes tasks and milestones with timestamps and activity', () => {
    let d = addTask(createSeedData(NOW), 'oneshotz', { title: 'Pick milestone' }, NOW);
    const t = d.projects.find((x) => x.id === 'oneshotz')!.tasks[0];
    d = updateTask(d, 'oneshotz', t.id, { status: 'done' }, NOW);
    expect(d.projects.find((x) => x.id === 'oneshotz')!.tasks[0].completedAt).toBe(NOW.toISOString());
    expect(d.activity[0].text).toMatch(/Finished task/);

    d = addMilestone(d, 'oneshotz', { title: 'MVP' }, NOW);
    const m = d.projects.find((x) => x.id === 'oneshotz')!.milestones[0];
    d = updateMilestone(d, 'oneshotz', m.id, { done: true }, NOW);
    expect(progressOf(d.projects.find((x) => x.id === 'oneshotz')!)).toEqual({ done: 1, total: 1, basis: 'milestones' });
    d = updateMilestone(d, 'oneshotz', m.id, { done: false }, NOW);
    expect(d.projects.find((x) => x.id === 'oneshotz')!.milestones[0].completedAt).toBeUndefined();
  });

  it('completes a next action with a single log entry', () => {
    const before = createSeedData(NOW);
    const d = completeNextAction(before, 'voidraider', 'Draft rule v0.3', NOW);
    expect(d.projects.find((x) => x.id === 'voidraider')!.nextAction).toBe('Draft rule v0.3');
    expect(d.activity.length).toBe(before.activity.length + 1);
    expect(d.activity[0].text).toMatch(/^Done: Consolidate/);
  });

  it('records notes against a project', () => {
    const d = recordEntry(createSeedData(NOW), 'voidraider', 'decision', 'Use d10 pools', NOW);
    expect(d.activity[0]).toMatchObject({ projectId: 'voidraider', kind: 'decision', text: 'Use d10 pools' });
  });
});

describe('selectors', () => {
  const d = createSeedData(NOW);
  it('never reports progress for ongoing commitments', () => {
    expect(progressOf(d.projects.find((p) => p.id === 'antech')!)).toBeNull();
    expect(progressOf(d.projects.find((p) => p.id === 'dcc-tools')!)).toEqual({ done: 2, total: 3, basis: 'milestones' });
  });
  it('hobbies never need attention', () => {
    const drums = { ...d.projects.find((p) => p.id === 'drumming')!, nextAction: '', nextActionDue: '2020-01-01' };
    expect(attentionReasons(drums, NOW)).toEqual([]);
  });
  it('month-precision deadlines are never shown as overdue mid-month', () => {
    expect(urgencyOf({ days: -5, due: '2026-11' })).toBe('week');
    const items = datedItems(d, NOW).filter((i) => i.kind === 'deadline');
    expect(items).toHaveLength(2);
  });
  it('filters by text, category and waiting', () => {
    const ctx = { today: NOW, focusIds: [] };
    const hits = d.projects.filter((p) => matchesFilters(p, { ...EMPTY_FILTERS, q: 'genghis' }, ctx)).map((p) => p.id);
    expect(hits).toContain('hazard-quest');
    const waiting = d.projects.filter((p) => matchesFilters(p, { ...EMPTY_FILTERS, waitingOnly: true }, ctx)).map((p) => p.id);
    expect(waiting.sort()).toEqual(['friday-food-bag', 'lccc-degree']);
  });
  it('warns when over capacity', () => {
    const w = { weekStart: '2026-11-09', focusProjectIds: [], notes: '', blocks: [{ id: 'b', kind: 'focus' as const, title: 'x', hours: 14 }] };
    expect(capacityState(w, 12).level).toBe('over');
  });
});
