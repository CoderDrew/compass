// Pure data operations. Each takes AppData and returns a new AppData.
// Meaningful changes append to the activity log automatically.

import { statusLabel } from '../data/meta.ts';
import type { ActivityEntry, ActivityKind, AppData, Milestone, PlanBlock, Project, Settings, Task, WeekPlan } from '../data/types.ts';

export function uid(prefix = 'id'): string {
  const c = globalThis.crypto as Crypto | undefined;
  const r = c?.randomUUID ? c.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${r}`;
}

const MAX_ACTIVITY = 2000;

export function logActivity(d: AppData, entry: { projectId?: string; kind: ActivityKind; text: string }, now = new Date()): AppData {
  const e: ActivityEntry = { id: uid('a'), at: now.toISOString(), ...entry };
  return { ...d, activity: [e, ...d.activity].slice(0, MAX_ACTIVITY) };
}

function touch(p: Project, now: Date): Project {
  const iso = now.toISOString();
  return { ...p, updatedAt: iso, lastActivity: iso };
}

function mapProject(d: AppData, id: string, fn: (p: Project) => Project): AppData {
  return { ...d, projects: d.projects.map((p) => (p.id === id ? fn(p) : p)) };
}

export function getProject(d: AppData, id: string): Project | undefined {
  return d.projects.find((p) => p.id === id);
}

const trim = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function updateProject(d: AppData, id: string, patch: Partial<Project>, now = new Date()): AppData {
  const before = getProject(d, id);
  if (!before) return d;
  let next = mapProject(d, id, (p) => touch({ ...p, ...patch, id: p.id }, now));
  const log = (kind: ActivityKind, text: string) => (next = logActivity(next, { projectId: id, kind, text }, now));

  if (patch.status && patch.status !== before.status)
    log('status', `Status: ${statusLabel(before.status)} → ${statusLabel(patch.status)}`);
  if (patch.priority && patch.priority !== before.priority) log('priority', `Priority: ${before.priority} → ${patch.priority}`);
  if (patch.nextAction !== undefined && patch.nextAction !== before.nextAction)
    log('next-action', patch.nextAction ? `Next action: ${trim(patch.nextAction)}` : 'Cleared next action');
  if (patch.blockers !== undefined && patch.blockers !== before.blockers)
    log('blocker', patch.blockers ? `Blocker: ${trim(patch.blockers)}` : 'Blockers cleared');
  if (patch.waitingOn !== undefined && patch.waitingOn !== before.waitingOn)
    log('waiting', patch.waitingOn ? `Waiting on: ${trim(patch.waitingOn)}` : 'No longer waiting');
  return next;
}

/** Mark the current next action done (logged once) and optionally set the following one. */
export function completeNextAction(d: AppData, id: string, following = '', now = new Date()): AppData {
  const p = getProject(d, id);
  if (!p || !p.nextAction) return d;
  const next = mapProject(d, id, (x) => touch({ ...x, nextAction: following, nextActionDue: undefined }, now));
  return logActivity(next, { projectId: id, kind: 'next-action', text: `Done: ${trim(p.nextAction)}${following ? ` → next: ${trim(following, 60)}` : ''}` }, now);
}

export function newProject(fields: Partial<Project> & Pick<Project, 'name' | 'category'>, now = new Date()): Project {
  const iso = now.toISOString();
  return {
    id: uid('p'),
    description: '',
    status: 'active',
    priority: 'medium',
    type: '',
    phase: '',
    milestone: '',
    nextAction: '',
    blockers: '',
    waitingOn: '',
    notes: '',
    relatedIds: [],
    tasks: [],
    milestones: [],
    ...fields,
    lastActivity: iso,
    createdAt: iso,
    updatedAt: iso,
  };
}

export function addProject(d: AppData, p: Project, now = new Date()): AppData {
  return logActivity({ ...d, projects: [...d.projects, p] }, { projectId: p.id, kind: 'project', text: `Created project "${p.name}"` }, now);
}

export function deleteProject(d: AppData, id: string, now = new Date()): AppData {
  const p = getProject(d, id);
  if (!p) return d;
  const weeks: Record<string, WeekPlan> = {};
  for (const [k, w] of Object.entries(d.weeks)) {
    weeks[k] = {
      ...w,
      focusProjectIds: w.focusProjectIds.filter((x) => x !== id),
      blocks: w.blocks.map((b) => (b.projectId === id ? { ...b, projectId: undefined } : b)),
    };
  }
  const next: AppData = {
    ...d,
    weeks,
    projects: d.projects.filter((x) => x.id !== id).map((x) => (x.relatedIds.includes(id) ? { ...x, relatedIds: x.relatedIds.filter((r) => r !== id) } : x)),
  };
  return logActivity(next, { kind: 'project', text: `Deleted project "${p.name}"` }, now);
}

// ── Tasks ───────────────────────────────────────────────────────

export function addTask(d: AppData, projectId: string, fields: Partial<Task> & Pick<Task, 'title'>, now = new Date()): AppData {
  const t: Task = { id: uid('t'), status: 'todo', priority: 'medium', ...fields };
  return mapProject(d, projectId, (p) => touch({ ...p, tasks: [...p.tasks, t] }, now));
}

export function updateTask(d: AppData, projectId: string, taskId: string, patch: Partial<Task>, now = new Date()): AppData {
  const p = getProject(d, projectId);
  const before = p?.tasks.find((t) => t.id === taskId);
  if (!p || !before) return d;
  const completing = patch.status === 'done' && before.status !== 'done';
  const reopening = patch.status !== undefined && patch.status !== 'done' && before.status === 'done';
  const merged: Task = {
    ...before,
    ...patch,
    completedAt: completing ? now.toISOString() : reopening ? undefined : (patch.completedAt ?? before.completedAt),
  };
  let next = mapProject(d, projectId, (x) => touch({ ...x, tasks: x.tasks.map((t) => (t.id === taskId ? merged : t)) }, now));
  if (completing) next = logActivity(next, { projectId, kind: 'task', text: `Finished task: ${trim(merged.title)}` }, now);
  return next;
}

export function deleteTask(d: AppData, projectId: string, taskId: string, now = new Date()): AppData {
  return mapProject(d, projectId, (p) => touch({ ...p, tasks: p.tasks.filter((t) => t.id !== taskId) }, now));
}

// ── Milestones ──────────────────────────────────────────────────

export function addMilestone(d: AppData, projectId: string, fields: Partial<Milestone> & Pick<Milestone, 'title'>, now = new Date()): AppData {
  const m: Milestone = { id: uid('m'), done: false, ...fields };
  return mapProject(d, projectId, (p) => touch({ ...p, milestones: [...p.milestones, m] }, now));
}

export function updateMilestone(d: AppData, projectId: string, mId: string, patch: Partial<Milestone>, now = new Date()): AppData {
  const p = getProject(d, projectId);
  const before = p?.milestones.find((m) => m.id === mId);
  if (!p || !before) return d;
  const completing = patch.done === true && !before.done;
  const merged: Milestone = {
    ...before,
    ...patch,
    completedAt: completing ? now.toISOString() : patch.done === false ? undefined : before.completedAt,
  };
  let next = mapProject(d, projectId, (x) => touch({ ...x, milestones: x.milestones.map((m) => (m.id === mId ? merged : m)) }, now));
  if (completing) next = logActivity(next, { projectId, kind: 'milestone', text: `Completed milestone: ${trim(merged.title)}` }, now);
  return next;
}

export function deleteMilestone(d: AppData, projectId: string, mId: string, now = new Date()): AppData {
  return mapProject(d, projectId, (p) => touch({ ...p, milestones: p.milestones.filter((m) => m.id !== mId) }, now));
}

// ── Notes / decisions ───────────────────────────────────────────

export function recordEntry(d: AppData, projectId: string | undefined, kind: 'note' | 'decision', text: string, now = new Date()): AppData {
  let next = logActivity(d, { projectId, kind, text: text.trim() }, now);
  if (projectId) next = mapProject(next, projectId, (p) => touch(p, now));
  return next;
}

export function deleteActivity(d: AppData, activityId: string): AppData {
  return { ...d, activity: d.activity.filter((a) => a.id !== activityId) };
}

// ── Weekly plans ────────────────────────────────────────────────

export function emptyWeek(weekStart: string): WeekPlan {
  return { weekStart, focusProjectIds: [], blocks: [], notes: '' };
}

export function getWeek(d: AppData, weekStart: string): WeekPlan {
  return d.weeks[weekStart] ?? emptyWeek(weekStart);
}

export function updateWeek(d: AppData, weekStart: string, fn: (w: WeekPlan) => WeekPlan): AppData {
  return { ...d, weeks: { ...d.weeks, [weekStart]: fn(getWeek(d, weekStart)) } };
}

export function toggleFocus(d: AppData, weekStart: string, projectId: string, now = new Date()): AppData {
  const w = getWeek(d, weekStart);
  const on = !w.focusProjectIds.includes(projectId);
  const next = updateWeek(d, weekStart, (x) => ({
    ...x,
    focusProjectIds: on ? [...x.focusProjectIds, projectId] : x.focusProjectIds.filter((id) => id !== projectId),
  }));
  const name = getProject(d, projectId)?.name ?? 'project';
  return logActivity(next, { projectId, kind: 'focus', text: on ? `Added "${name}" to weekly focus` : `Removed "${name}" from weekly focus` }, now);
}

export function addBlock(d: AppData, weekStart: string, block: Omit<PlanBlock, 'id'>): AppData {
  return updateWeek(d, weekStart, (w) => ({ ...w, blocks: [...w.blocks, { ...block, id: uid('b') }] }));
}

export function updateBlock(d: AppData, weekStart: string, id: string, patch: Partial<PlanBlock>): AppData {
  return updateWeek(d, weekStart, (w) => ({ ...w, blocks: w.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
}

export function removeBlock(d: AppData, weekStart: string, id: string): AppData {
  return updateWeek(d, weekStart, (w) => ({ ...w, blocks: w.blocks.filter((b) => b.id !== id) }));
}

export function updateSettings(d: AppData, patch: Partial<Settings>): AppData {
  return { ...d, settings: { ...d.settings, ...patch } };
}
