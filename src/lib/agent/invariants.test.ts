import { describe, expect, it } from 'vitest';
import { createSeedData } from '../../data/seed';
import type { AppData, DeletedSnapshot } from '../../data/types';
import { addBlock, addMilestone, addTask, deleteMilestone, deleteTask, getProject, getWeek, logActivity, removeBlock } from '../ops';
import { validate } from '../storage';
import { AgentFailure } from './errors';
import { checkInvariants, type Scope } from './invariants';

const NOW = new Date('2026-11-15T15:00:00Z');
const WEEK = '2026-11-09';

function base(): AppData {
  let d = createSeedData(new Date('2026-11-01T12:00:00Z'));
  d = addTask(d, 'starfall', { title: 'Write rules draft' }, NOW);
  d = addMilestone(d, 'starfall', { title: 'Second playtest' }, NOW);
  d = addBlock(d, WEEK, { kind: 'focus', title: 'Deploy Olympus', hours: 2, day: 3 });
  return d;
}

const snap = (d: AppData, s: DeletedSnapshot) => logActivity(d, { kind: 'task', text: 'Deleted', deleted: s }, NOW);

function rejection(fn: () => void): string[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof AgentFailure) return e.error.details ?? [e.error.message];
    throw e;
  }
  return [];
}

describe('checkInvariants — scoped removals', () => {
  const d = base();
  const task = getProject(d, 'starfall')!.tasks.at(-1)!;
  const ms = getProject(d, 'starfall')!.milestones.at(-1)!;
  const block = getWeek(d, WEEK).blocks.at(-1)!;

  it('rejects removing a task not named in scope', () => {
    const after = snap(deleteTask(d, 'starfall', task.id, NOW), { type: 'task', projectId: 'starfall', item: task });
    expect(rejection(() => checkInvariants(d, after, { projectId: 'starfall' }))).toContain('Starfall — Original Miniatures Game: tasks must not be removed');
  });

  it('allows removing a named task when a new activity entry snapshots it', () => {
    const after = snap(deleteTask(d, 'starfall', task.id, NOW), { type: 'task', projectId: 'starfall', item: task });
    expect(rejection(() => checkInvariants(d, after, { projectId: 'starfall', removeTaskIds: [task.id] }))).toEqual([]);
  });

  it('rejects a named removal without a snapshot entry', () => {
    const after = deleteTask(d, 'starfall', task.id, NOW);
    expect(rejection(() => checkInvariants(d, after, { projectId: 'starfall', removeTaskIds: [task.id] }))).toContain(`task ${task.id} must be snapshotted before removal`);
  });

  it('allows a snapshotted milestone removal and rejects an unsnapshotted one', () => {
    const scope: Scope = { projectId: 'starfall', removeMilestoneIds: [ms.id] };
    const removed = deleteMilestone(d, 'starfall', ms.id, NOW);
    expect(rejection(() => checkInvariants(d, snap(removed, { type: 'milestone', projectId: 'starfall', item: ms }), scope))).toEqual([]);
    expect(rejection(() => checkInvariants(d, removed, scope))).toContain(`milestone ${ms.id} must be snapshotted before removal`);
    expect(rejection(() => checkInvariants(d, snap(removed, { type: 'milestone', projectId: 'starfall', item: ms }), { projectId: 'starfall' }))).toContain(
      'Starfall — Original Miniatures Game: milestones must not be removed',
    );
  });

  it('allows a snapshotted block removal and rejects an unsnapshotted or unnamed one', () => {
    const removed = removeBlock(d, WEEK, block.id);
    const withSnap = snap(removed, { type: 'block', weekStart: WEEK, item: block });
    expect(rejection(() => checkInvariants(d, withSnap, { weekStart: WEEK, removeBlockIds: [block.id] }))).toEqual([]);
    expect(rejection(() => checkInvariants(d, removed, { weekStart: WEEK, removeBlockIds: [block.id] }))).toContain(`block ${block.id} must be snapshotted before removal`);
    expect(rejection(() => checkInvariants(d, withSnap, { weekStart: WEEK }))).toContain(`week ${WEEK}: blocks must not be removed`);
  });

  it('a snapshot of the wrong type does not count', () => {
    const after = snap(deleteTask(d, 'starfall', task.id, NOW), { type: 'milestone', projectId: 'starfall', item: { ...ms, id: task.id } });
    expect(rejection(() => checkInvariants(d, after, { projectId: 'starfall', removeTaskIds: [task.id] }))).toContain(`task ${task.id} must be snapshotted before removal`);
  });
});

describe('validate — deleted snapshots', () => {
  it('accepts an activity entry with a deleted snapshot and rejects a malformed one', () => {
    const d = base();
    const task = getProject(d, 'starfall')!.tasks.at(-1)!;
    expect(validate(snap(d, { type: 'task', projectId: 'starfall', item: task }))).toEqual([]);
    const bad = logActivity(d, { kind: 'task', text: 'x' }, NOW);
    (bad.activity[0] as unknown as Record<string, unknown>).deleted = { type: 'nope', item: { id: 'x' } };
    expect(validate(bad).join(' ')).toMatch(/invalid deleted snapshot/);
    const noRef = logActivity(d, { kind: 'task', text: 'x' }, NOW);
    (noRef.activity[0] as unknown as Record<string, unknown>).deleted = { type: 'block', item: { id: 'x' } };
    expect(validate(noRef).join(' ')).toMatch(/invalid deleted snapshot/);
  });
});
