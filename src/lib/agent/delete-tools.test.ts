import { describe, expect, it } from 'vitest';
import { createSeedData } from '../../data/seed';
import type { AppData } from '../../data/types';
import { addBlock, addMilestone, addTask, getProject } from '../ops';
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
