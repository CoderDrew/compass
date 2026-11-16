import { describe, expect, it } from 'vitest';
import { createSeedData } from '../../data/seed';
import type { AppData } from '../../data/types';
import { addBlock, addMilestone, addTask, deleteProject, getProject, getWeek } from '../ops';
import type { AgentContext } from './attribution';
import { TOOL_SPECS } from './mcp';
import { memoryPortfolioStore, runTool } from './run';

const NOW = new Date('2026-11-15T15:00:00Z');
const WEEK = '2026-11-09';
const base = (now = NOW): Omit<AgentContext, 'opId'> => ({ now, timeZone: 'America/Toronto', agent: 'Claude', clientId: 'client-1' });
const dataOf = (s: ReturnType<typeof memoryPortfolioStore>) => s.row!.data as AppData;

function seed(): AppData {
  let d = createSeedData(new Date('2026-11-01T12:00:00Z'));
  d = addTask(d, 'starfall', { title: 'Write rules draft', notes: 'Long notes worth keeping' }, NOW);
  d = addTask(d, 'starfall', { title: 'Write lore draft' }, NOW);
  d = addMilestone(d, 'starfall', { title: 'Second playtest' }, NOW);
  d = addBlock(d, WEEK, { kind: 'deadline', title: 'Deploy Olympus', hours: 2, day: 3 });
  d = addBlock(d, WEEK, { kind: 'focus', title: 'Olympus launch', hours: 3, day: 4, projectId: 'starfall' });
  return d;
}
const blocks = (d: AppData) => getWeek(d, WEEK).blocks;
const blockId = (d: AppData, title: string) => blocks(d).find((b) => b.title === title)!.id;
const taskId = (d: AppData, title: string) => getProject(d, 'starfall')!.tasks.find((t) => t.title === title)!.id;

describe('delete_task / delete_milestone', () => {
  it('delete_task removes the task and logs a snapshot with agent source', async () => {
    const store = memoryPortfolioStore(seed());
    const id = taskId(dataOf(store), 'Write rules draft');
    const r = await runTool(store, 'delete_task', { project: 'Starfall', task: id }, base());
    expect(r).toMatchObject({ ok: true, result: { projectId: 'starfall', deleted: { id, title: 'Write rules draft' } } });
    const d = dataOf(store);
    expect(getProject(d, 'starfall')!.tasks.some((t) => t.id === id)).toBe(false);
    expect(d.activity[0]).toMatchObject({
      kind: 'task',
      text: 'Deleted task: Write rules draft',
      taskId: id,
      source: { type: 'agent', agent: 'Claude' },
      deleted: { type: 'task', projectId: 'starfall', item: { id, notes: 'Long notes worth keeping' } },
    });
    if (r.ok) expect((r.result as { activityId: string }).activityId).toBe(d.activity[0].id);
  });

  it('delete_task by an ambiguous title fails and changes nothing', async () => {
    const store = memoryPortfolioStore(seed());
    const r = await runTool(store, 'delete_task', { project: 'starfall', task: 'draft' }, base());
    expect(r).toMatchObject({ ok: false, error: { code: 'AMBIGUOUS_REFERENCE' } });
    expect(store.commits).toHaveLength(0);
  });

  it('delete_milestone removes it and logs a snapshot', async () => {
    const store = memoryPortfolioStore(seed());
    const r = await runTool(store, 'delete_milestone', { project: 'starfall', milestone: 'Second playtest' }, base());
    expect(r).toMatchObject({ ok: true, result: { deleted: { title: 'Second playtest' } } });
    const d = dataOf(store);
    expect(getProject(d, 'starfall')!.milestones.some((m) => m.title === 'Second playtest')).toBe(false);
    expect(d.activity[0]).toMatchObject({ kind: 'milestone', text: 'Deleted milestone: Second playtest', deleted: { type: 'milestone', projectId: 'starfall' } });
  });

  it('repeating a delete with the same request_id is a duplicate', async () => {
    const store = memoryPortfolioStore(seed());
    const id = taskId(dataOf(store), 'Write lore draft');
    await runTool(store, 'delete_task', { project: 'starfall', task: id, request_id: 'del-1' }, base());
    expect(await runTool(store, 'delete_task', { project: 'starfall', task: id, request_id: 'del-1' }, base())).toMatchObject({ ok: true, duplicate: true });
    expect(store.commits).toHaveLength(1);
  });
});

describe('MCP annotations', () => {
  it('marks only the deleting tools as destructive', () => {
    const destructive = TOOL_SPECS.filter((t) => t.annotations.destructiveHint).map((t) => t.name).sort();
    expect(destructive).toEqual(['delete_milestone', 'delete_task', 'update_week_plan']);
  });
});

describe('update_week_plan — remove and edit blocks', () => {
  const wk = { week_start: WEEK };

  it('re-plans a week in one call: removes one block and retitles another', async () => {
    const store = memoryPortfolioStore(seed());
    const deploy = blockId(dataOf(store), 'Deploy Olympus');
    const launch = blockId(dataOf(store), 'Olympus launch');
    const r = await runTool(store, 'update_week_plan', { ...wk, remove_blocks: [deploy], update_blocks: [{ id: launch, title: 'Olympus content', hours: 1 }] }, base());
    expect(r.ok).toBe(true);
    const d = dataOf(store);
    expect(blocks(d).map((b) => b.id)).not.toContain(deploy);
    expect(blocks(d).find((b) => b.id === launch)).toMatchObject({ title: 'Olympus content', hours: 1, day: 4 });
    const removed = d.activity.find((e) => e.text === 'Removed block "Deploy Olympus" from week of 2026-11-09');
    expect(removed).toMatchObject({ kind: 'focus', deleted: { type: 'block', weekStart: WEEK, item: { id: deploy, title: 'Deploy Olympus', hours: 2, day: 3 } } });
    expect(d.activity.some((e) => e.text.startsWith('Changed block "Olympus launch"'))).toBe(true);
  });

  it('an unknown block id is NOT_FOUND naming the id, and nothing changes', async () => {
    const store = memoryPortfolioStore(seed());
    for (const input of [{ remove_blocks: ['b-nope'] }, { update_blocks: [{ id: 'b-nope', title: 'x' }] }]) {
      const r = await runTool(store, 'update_week_plan', { ...wk, ...input }, base());
      expect(r).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      if (!r.ok) expect(r.error.message).toContain('b-nope');
    }
    expect(store.commits).toHaveLength(0);
  });

  it('the same id in remove_blocks and update_blocks is INVALID_INPUT', async () => {
    const store = memoryPortfolioStore(seed());
    const id = blockId(dataOf(store), 'Deploy Olympus');
    expect(await runTool(store, 'update_week_plan', { ...wk, remove_blocks: [id], update_blocks: [{ id, title: 'x' }] }, base())).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });

  it('unschedule clears the day, project null clears the project, and day + unschedule is rejected', async () => {
    const store = memoryPortfolioStore(seed());
    const id = blockId(dataOf(store), 'Olympus launch');
    expect(await runTool(store, 'update_week_plan', { ...wk, update_blocks: [{ id, day: 2, unschedule: true }] }, base())).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(await runTool(store, 'update_week_plan', { ...wk, update_blocks: [{ id, unschedule: true, project: null }] }, base())).toMatchObject({ ok: true });
    const b = blocks(dataOf(store)).find((x) => x.id === id)!;
    expect(b.day).toBeUndefined();
    expect(b.projectId).toBeUndefined();
  });

  it('an update that changes nothing is not a change', async () => {
    const store = memoryPortfolioStore(seed());
    const id = blockId(dataOf(store), 'Olympus launch');
    expect(await runTool(store, 'update_week_plan', { ...wk, update_blocks: [{ id, title: 'Olympus launch', hours: 3 }] }, base())).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(store.commits).toHaveLength(0);
  });
});

describe('restore_deleted', () => {
  async function deleted(tool: string, input: Record<string, unknown>, data = seed()) {
    const store = memoryPortfolioStore(data);
    const r = await runTool(store, tool, input, base());
    expect(r.ok).toBe(true);
    const activityId = dataOf(store).activity.find((e) => e.deleted)!.id;
    return { store, activityId };
  }

  it('restores a deleted task with its original id and fields', async () => {
    const before = seed();
    const id = taskId(before, 'Write rules draft');
    const { store, activityId } = await deleted('delete_task', { project: 'starfall', task: 'Write rules draft' }, before);
    const r = await runTool(store, 'restore_deleted', { activity_id: activityId }, base(new Date(NOW.getTime() + 60_000)));
    expect(r).toMatchObject({ ok: true, result: { restored: { type: 'task', id, title: 'Write rules draft' }, projectId: 'starfall' } });
    const d = dataOf(store);
    expect(getProject(d, 'starfall')!.tasks.find((t) => t.id === id)).toEqual(getProject(before, 'starfall')!.tasks.find((t) => t.id === id));
    expect(d.activity[0]).toMatchObject({ kind: 'task', text: 'Restored task: Write rules draft', taskId: id, source: { type: 'agent' } });
  });

  it('restores a milestone and a block', async () => {
    const m = await deleted('delete_milestone', { project: 'starfall', milestone: 'Second playtest' });
    expect(await runTool(m.store, 'restore_deleted', { activity_id: m.activityId }, base())).toMatchObject({ ok: true, result: { restored: { type: 'milestone' } } });
    expect(getProject(dataOf(m.store), 'starfall')!.milestones.some((x) => x.title === 'Second playtest')).toBe(true);

    const s = seed();
    const bid = blockId(s, 'Deploy Olympus');
    const b = await deleted('update_week_plan', { week_start: WEEK, remove_blocks: [bid] }, s);
    expect(await runTool(b.store, 'restore_deleted', { activity_id: b.activityId }, base())).toMatchObject({ ok: true, result: { restored: { type: 'block', id: bid }, weekStart: WEEK } });
    expect(blocks(dataOf(b.store)).find((x) => x.id === bid)).toMatchObject({ title: 'Deploy Olympus', hours: 2, day: 3 });
  });

  it('restoring twice is NOT_ALLOWED and does not duplicate the item', async () => {
    const { store, activityId } = await deleted('delete_task', { project: 'starfall', task: 'Write lore draft' });
    await runTool(store, 'restore_deleted', { activity_id: activityId, request_id: 'r1' }, base());
    const again = await runTool(store, 'restore_deleted', { activity_id: activityId, request_id: 'r2' }, base());
    expect(again).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } });
    if (!again.ok) expect(again.error.message).toContain('already exists');
    expect(getProject(dataOf(store), 'starfall')!.tasks.filter((t) => t.title === 'Write lore draft')).toHaveLength(1);
  });

  it('an activity entry without a snapshot is NOT_FOUND', async () => {
    const store = memoryPortfolioStore(seed());
    await runTool(store, 'add_activity', { text: 'Just a note' }, base());
    const id = dataOf(store).activity[0].id;
    expect(await runTool(store, 'restore_deleted', { activity_id: id }, base())).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await runTool(store, 'restore_deleted', { activity_id: 'a-missing' }, base())).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('restoring into a project deleted since is NOT_ALLOWED and changes nothing', async () => {
    const { store, activityId } = await deleted('delete_task', { project: 'starfall', task: 'Write lore draft' });
    store.externalWrite((d) => deleteProject(d, 'starfall', NOW));
    const commits = store.commits.length;
    expect(await runTool(store, 'restore_deleted', { activity_id: activityId }, base())).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } });
    expect(store.commits).toHaveLength(commits);
  });
});
