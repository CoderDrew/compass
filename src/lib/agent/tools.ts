// The initial tool set as pure functions over AppData. Reads return bounded DTOs; writes
// return the next AppData plus a result, and always go through the existing ops.ts rules.
// No I/O here — `run.ts` adds loading, invariants, attribution and conflict-safe commit.

import { BLOCK_KINDS } from '../../data/meta.ts';
import type { ActivityKind, AppData, BlockKind, CategoryId, DueString, Priority, Project, Status, TaskStatus, WeekPlan } from '../../data/types.ts';
import { addBlock, addTask, completeNextAction, getProject, getWeek, logActivity, recordEntry, toggleFocus, updateProject, updateTask, updateWeek } from '../ops.ts';
import { attentionReasons, isOpen, plannedHours } from '../selectors.ts';
import type { AgentContext } from './attribution.ts';
import { fail } from './errors.ts';
import type { Scope } from './invariants.ts';
import { normalize, resolveProject, resolveTask } from './resolve.ts';
import { parseInput, type Schema } from './schema.ts';
import { currentWeekStart, daysBetween, localDateIn, userToday } from './time.ts';

const STATUSES: Status[] = ['active', 'maintain', 'review', 'waiting', 'parked', 'completed', 'archived'];
const CATEGORIES: CategoryId[] = ['employment', 'business', 'software', 'creative', 'career', 'personal'];
const PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low'];
const TASK_STATUSES: TaskStatus[] = ['todo', 'doing', 'done'];
const KINDS: ActivityKind[] = ['status', 'priority', 'task', 'milestone', 'note', 'decision', 'next-action', 'blocker', 'waiting', 'project', 'focus', 'review'];

const TITLE = 200;
const TEXT = 4000;
const REQUEST_ID = { type: 'string', min: 1, max: 64, optional: true, description: 'Optional idempotency key; repeating it never applies the change twice.' } as const;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface ReadTool<I = any> {
  kind: 'read';
  description: string;
  input: Schema;
  run(d: AppData, input: I, ctx: AgentContext): unknown;
}

export interface WriteOutcome {
  data: AppData;
  result: Record<string, unknown>;
  scope: Scope;
  /** Task the operation is about (stamped on its activity entries). */
  taskId?: string;
  /** Names of what changed; empty means nothing to do. */
  changed: string[];
}

export interface WriteTool<I = any> {
  kind: 'write';
  description: string;
  input: Schema;
  run(d: AppData, input: I, ctx: AgentContext): WriteOutcome;
}

// ── Read DTOs ───────────────────────────────────────────────────

function projectSummary(p: Project, ctx: AgentContext, focus: string[]) {
  const today = localDateIn(ctx.timeZone, ctx.now);
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    status: p.status,
    priority: p.priority,
    nextAction: clip(p.nextAction, 300),
    ...(p.nextActionDue ? { nextActionDue: p.nextActionDue } : {}),
    ...(p.deadline ? { deadline: p.deadline, ...(p.deadlineLabel ? { deadlineLabel: p.deadlineLabel } : {}) } : {}),
    lastActivity: p.lastActivity,
    daysSinceActivity: Math.max(0, daysBetween(localDateIn(ctx.timeZone, new Date(p.lastActivity)), today)),
    inFocus: focus.includes(p.id),
    attention: attentionReasons(p, userToday(ctx.timeZone, ctx.now)),
    openTasks: p.tasks.filter((t) => t.status !== 'done').length,
    lowPressure: !!p.lowPressure,
  };
}

function weekView(d: AppData, w: WeekPlan) {
  return {
    weekStart: w.weekStart,
    focus: w.focusProjectIds.map((id) => ({ id, name: getProject(d, id)?.name ?? '(deleted project)' })),
    blocks: w.blocks.map((b) => ({ id: b.id, kind: b.kind, title: b.title, ...(b.projectId ? { projectId: b.projectId } : {}), ...(b.day !== undefined ? { day: b.day } : {}), hours: b.hours })),
    plannedHours: plannedHours(w),
    capacityHours: d.settings.weeklyCapacity,
    notes: clip(w.notes, TEXT),
    ...(w.reviewedAt ? { reviewedAt: w.reviewedAt } : {}),
  };
}

// ── Read tools ──────────────────────────────────────────────────

interface ListProjectsInput {
  status?: Status[];
  category?: CategoryId[];
  focus_only?: boolean;
  needs_attention?: boolean;
  stale_days?: number;
  query?: string;
  limit?: number;
}

const list_projects: ReadTool<ListProjectsInput> = {
  kind: 'read',
  description: 'List projects with status, next action, recency and attention flags. Use stale_days to find projects without recent activity.',
  input: {
    status: { type: 'array', of: { type: 'enum', values: STATUSES }, max: 7, optional: true, description: 'Only these statuses. Archived projects are excluded unless listed here.' },
    category: { type: 'array', of: { type: 'enum', values: CATEGORIES }, max: 6, optional: true },
    focus_only: { type: 'boolean', optional: true, description: "Only this week's focus projects." },
    needs_attention: { type: 'boolean', optional: true, description: 'Only projects flagged as needing attention (low-pressure hobbies never are).' },
    stale_days: { type: 'number', min: 1, max: 365, integer: true, optional: true, description: 'Only open projects with no activity for at least this many days.' },
    query: { type: 'string', min: 1, max: 100, optional: true, description: 'Text to match in the name or description.' },
    limit: { type: 'number', min: 1, max: 50, integer: true, optional: true },
  },
  run(d, i, ctx) {
    const focus = getWeek(d, currentWeekStart(ctx.timeZone, ctx.now)).focusProjectIds;
    const q = i.query ? normalize(i.query) : '';
    const rows = d.projects
      .filter((p) => (i.status?.length ? i.status.includes(p.status) : p.status !== 'archived'))
      .filter((p) => !i.category?.length || i.category.includes(p.category))
      .filter((p) => !i.focus_only || focus.includes(p.id))
      .filter((p) => !q || normalize(`${p.name} ${p.description}`).includes(q))
      .map((p) => projectSummary(p, ctx, focus))
      .filter((p) => !i.needs_attention || p.attention.length > 0)
      .filter((p) => i.stale_days === undefined || (p.daysSinceActivity >= i.stale_days && isOpen(getProject(d, p.id)!)))
      .sort((a, b) => (i.stale_days !== undefined ? b.daysSinceActivity - a.daysSinceActivity : 0));
    return { weekStart: currentWeekStart(ctx.timeZone, ctx.now), total: rows.length, projects: rows.slice(0, i.limit ?? 50) };
  },
};

const get_project: ReadTool<{ project: string }> = {
  kind: 'read',
  description: 'Get one project with its tasks, milestones and recent activity. Accepts an id or a name.',
  input: { project: { type: 'string', min: 1, max: TITLE, description: 'Project id or name.' } },
  run(d, i, ctx) {
    const p = resolveProject(d, i.project);
    const focus = getWeek(d, currentWeekStart(ctx.timeZone, ctx.now)).focusProjectIds;
    return {
      ...projectSummary(p, ctx, focus),
      description: clip(p.description, TEXT),
      type: p.type,
      phase: p.phase,
      milestone: p.milestone,
      blockers: p.blockers,
      waitingOn: p.waitingOn,
      notes: clip(p.notes, TEXT),
      ...(p.repoUrl ? { repoUrl: p.repoUrl } : {}),
      ...(p.websiteUrl ? { websiteUrl: p.websiteUrl } : {}),
      ongoing: !!p.ongoing,
      tasks: p.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, ...(t.due ? { due: t.due } : {}), ...(t.effort ? { effort: t.effort } : {}) })),
      milestones: p.milestones.map((m) => ({ id: m.id, title: m.title, done: m.done, ...(m.targetDate ? { targetDate: m.targetDate } : {}) })),
      recentActivity: d.activity.filter((e) => e.projectId === p.id).slice(0, 20).map(activityDto(d)),
    };
  },
};

const activityDto = (d: AppData) => (e: AppData['activity'][number]) => ({
  id: e.id,
  at: e.at,
  kind: e.kind,
  text: e.text,
  ...(e.projectId ? { projectId: e.projectId, projectName: getProject(d, e.projectId)?.name } : {}),
  ...(e.taskId ? { taskId: e.taskId } : {}),
  ...(e.source ? { source: e.source.agent } : {}),
});

const get_activity: ReadTool<{ since?: string; until?: string; project?: string; kinds?: ActivityKind[]; limit?: number }> = {
  kind: 'read',
  description: 'Activity history (newest first): status changes, completed tasks, notes, decisions, focus changes.',
  input: {
    since: { type: 'date', optional: true, description: 'Inclusive start date (user time zone).' },
    until: { type: 'date', optional: true, description: 'Inclusive end date (user time zone).' },
    project: { type: 'string', min: 1, max: TITLE, optional: true, description: 'Project id or name.' },
    kinds: { type: 'array', of: { type: 'enum', values: KINDS }, max: KINDS.length, optional: true },
    limit: { type: 'number', min: 1, max: 200, integer: true, optional: true },
  },
  run(d, i, ctx) {
    const pid = i.project ? resolveProject(d, i.project).id : undefined;
    const day = (iso: string) => localDateIn(ctx.timeZone, new Date(iso));
    const entries = d.activity
      .filter((e) => !pid || e.projectId === pid)
      .filter((e) => !i.kinds?.length || i.kinds.includes(e.kind))
      .filter((e) => (!i.since || day(e.at) >= i.since) && (!i.until || day(e.at) <= i.until));
    return { total: entries.length, entries: entries.slice(0, i.limit ?? 50).map(activityDto(d)) };
  },
};

const get_week_plan: ReadTool<{ week_start?: string }> = {
  kind: 'read',
  description: "A week's plan: focus projects, planned blocks, capacity and notes. Defaults to the current week.",
  input: { week_start: { type: 'monday', optional: true, description: 'Monday of the week (YYYY-MM-DD).' } },
  run(d, i, ctx) {
    return weekView(d, getWeek(d, i.week_start ?? currentWeekStart(ctx.timeZone, ctx.now)));
  },
};

// ── Write tools ─────────────────────────────────────────────────

const add_activity: WriteTool<{ project?: string; kind?: 'note' | 'decision'; text: string }> = {
  kind: 'write',
  description: 'Log progress, a note or a decision in the activity history, optionally on a project.',
  input: {
    project: { type: 'string', min: 1, max: TITLE, optional: true, description: 'Project id or name.' },
    kind: { type: 'enum', values: ['note', 'decision'], optional: true },
    text: { type: 'string', min: 1, max: TEXT },
    request_id: REQUEST_ID,
  },
  run(d, i, ctx) {
    const p = i.project ? resolveProject(d, i.project) : undefined;
    const data = recordEntry(d, p?.id, i.kind ?? 'note', i.text, ctx.now);
    const entry = data.activity[0];
    return { data, scope: { projectId: p?.id }, changed: ['activity'], result: { entry: { id: entry.id, at: entry.at, kind: entry.kind, text: entry.text, ...(p ? { projectId: p.id } : {}) } } };
  },
};

const create_task: WriteTool<{ project: string; title: string; priority?: Priority; due?: DueString; effort?: string; notes?: string }> = {
  kind: 'write',
  description: 'Add a task to a project. Only set a due date the user actually gave.',
  input: {
    project: { type: 'string', min: 1, max: TITLE, description: 'Project id or name.' },
    title: { type: 'string', min: 1, max: TITLE },
    priority: { type: 'enum', values: PRIORITIES, optional: true },
    due: { type: 'due', optional: true },
    effort: { type: 'string', min: 1, max: 40, optional: true, description: 'e.g. "2h", "half day"' },
    notes: { type: 'string', min: 1, max: TEXT, optional: true },
    request_id: REQUEST_ID,
  },
  run(d, i, ctx) {
    const p = resolveProject(d, i.project);
    const dup = p.tasks.find((t) => t.status !== 'done' && normalize(t.title) === normalize(i.title));
    if (dup) fail('NOT_ALLOWED', `${p.name} already has an open task "${dup.title}".`, { candidates: [{ id: dup.id, name: dup.title }] });
    let data = addTask(d, p.id, { title: i.title, priority: i.priority ?? 'medium', ...(i.due ? { due: i.due } : {}), ...(i.effort ? { effort: i.effort } : {}), ...(i.notes ? { notes: i.notes } : {}) }, ctx.now);
    const tasks = getProject(data, p.id)!.tasks;
    const task = tasks[tasks.length - 1];
    data = logActivity(data, { projectId: p.id, kind: 'task', text: `Added task: ${clip(task.title, 80)}` }, ctx.now);
    return { data, scope: { projectId: p.id }, taskId: task.id, changed: ['task'], result: { projectId: p.id, task: { id: task.id, title: task.title, status: task.status, priority: task.priority, ...(task.due ? { due: task.due } : {}) } } };
  },
};

interface UpdateTaskInput {
  project: string;
  task: string;
  status?: TaskStatus;
  title?: string;
  priority?: Priority;
  due?: DueString | null;
  effort?: string | null;
  notes?: string | null;
}

const update_task: WriteTool<UpdateTaskInput> = {
  kind: 'write',
  description: 'Update a task: mark it doing/done/todo, rename it, or change priority, due date, effort or notes.',
  input: {
    project: { type: 'string', min: 1, max: TITLE, description: 'Project id or name.' },
    task: { type: 'string', min: 1, max: TITLE, description: 'Task id or title.' },
    status: { type: 'enum', values: TASK_STATUSES, optional: true },
    title: { type: 'string', min: 1, max: TITLE, optional: true },
    priority: { type: 'enum', values: PRIORITIES, optional: true },
    due: { type: 'due', optional: true, nullable: true, description: 'null clears the due date.' },
    effort: { type: 'string', min: 1, max: 40, optional: true, nullable: true },
    notes: { type: 'string', min: 1, max: TEXT, optional: true, nullable: true },
    request_id: REQUEST_ID,
  },
  run(d, i, ctx) {
    const p = resolveProject(d, i.project);
    const t = resolveTask(p, i.task);
    const patch: Record<string, unknown> = {};
    const changed: string[] = [];
    const set = (k: string, v: unknown, cur: unknown) => {
      if (v === undefined) return;
      const next = v === null ? undefined : v;
      if (next !== cur) {
        patch[k] = next;
        changed.push(k);
      }
    };
    set('status', i.status, t.status);
    set('title', i.title, t.title);
    set('priority', i.priority, t.priority);
    set('due', i.due, t.due);
    set('effort', i.effort, t.effort);
    set('notes', i.notes, t.notes);
    if (!changed.length) fail('INVALID_INPUT', `Nothing to change on "${t.title}".`);
    let data = updateTask(d, p.id, t.id, patch, ctx.now);
    const updated = getProject(data, p.id)!.tasks.find((x) => x.id === t.id)!;
    // updateTask already logs completion; log every other change explicitly.
    const others = changed.filter((k) => !(k === 'status' && i.status === 'done'));
    if (others.length) {
      const text = others.includes('status') && others.length === 1 ? `Task ${updated.status === 'doing' ? 'started' : 'reopened'}: ${clip(updated.title, 80)}` : `Updated task (${others.join(', ')}): ${clip(updated.title, 80)}`;
      data = logActivity(data, { projectId: p.id, kind: 'task', text }, ctx.now);
    }
    return { data, scope: { projectId: p.id }, taskId: t.id, changed, result: { projectId: p.id, changed, task: { id: updated.id, title: updated.title, status: updated.status, priority: updated.priority, ...(updated.due ? { due: updated.due } : {}), ...(updated.completedAt ? { completedAt: updated.completedAt } : {}) } } };
  },
};

interface UpdateProjectInput {
  project: string;
  next_action?: string;
  next_action_due?: DueString | null;
  complete_next_action?: boolean;
  blockers?: string;
  waiting_on?: string;
  phase?: string;
  milestone?: string;
  description?: string;
  append_notes?: string;
}

const update_project: WriteTool<UpdateProjectInput> = {
  kind: 'write',
  description:
    "Update a project's working fields: next action (or mark it done), blockers, waiting-on, phase, current milestone text, description, or append to notes. Status, priority and deadlines cannot be changed here.",
  input: {
    project: { type: 'string', min: 1, max: TITLE, description: 'Project id or name.' },
    next_action: { type: 'string', max: 500, optional: true, description: 'New next action (empty string clears it).' },
    next_action_due: { type: 'due', optional: true, nullable: true },
    complete_next_action: { type: 'boolean', optional: true, description: 'Mark the current next action done; next_action (if given) becomes the following one.' },
    blockers: { type: 'string', max: 1000, optional: true, description: 'Empty string clears blockers.' },
    waiting_on: { type: 'string', max: 1000, optional: true, description: 'Empty string clears it.' },
    phase: { type: 'string', max: TITLE, optional: true },
    milestone: { type: 'string', max: TITLE, optional: true, description: 'Free-text current milestone/focus.' },
    description: { type: 'string', max: TEXT, optional: true },
    append_notes: { type: 'string', min: 1, max: TEXT, optional: true, description: 'Appended as a dated paragraph; never replaces notes.' },
    request_id: REQUEST_ID,
  },
  run(d, i, ctx) {
    const p = resolveProject(d, i.project);
    let data = d;
    const changed: string[] = [];

    if (i.complete_next_action) {
      if (!p.nextAction.trim()) fail('INVALID_INPUT', `${p.name} has no next action to complete.`);
      data = completeNextAction(data, p.id, i.next_action ?? '', ctx.now);
      changed.push('complete_next_action');
    }
    const cur = getProject(data, p.id)!;
    const patch: Record<string, unknown> = {};
    const set = (input: unknown, key: keyof Project, label: string) => {
      if (input === undefined) return;
      const v = input === null ? undefined : input;
      if (v !== cur[key]) {
        patch[key] = v;
        changed.push(label);
      }
    };
    if (!i.complete_next_action) set(i.next_action, 'nextAction', 'next_action');
    set(i.next_action_due, 'nextActionDue', 'next_action_due');
    set(i.blockers, 'blockers', 'blockers');
    set(i.waiting_on, 'waitingOn', 'waiting_on');
    set(i.phase, 'phase', 'phase');
    set(i.milestone, 'milestone', 'milestone');
    set(i.description, 'description', 'description');
    if (i.append_notes) {
      const stamp = localDateIn(ctx.timeZone, ctx.now);
      patch.notes = `${cur.notes.trimEnd()}${cur.notes.trim() ? '\n\n' : ''}${stamp}: ${i.append_notes}`;
      changed.push('append_notes');
    }
    if (!changed.length) fail('INVALID_INPUT', `Nothing to change on ${p.name}.`);

    if (Object.keys(patch).length) data = updateProject(data, p.id, patch, ctx.now);
    // updateProject logs next action, blockers and waiting changes; log the rest.
    const quiet = changed.filter((k) => ['next_action_due', 'phase', 'milestone', 'description', 'append_notes'].includes(k));
    if (quiet.length) data = logActivity(data, { projectId: p.id, kind: 'project', text: `Updated ${quiet.map((k) => k.replace(/_/g, ' ')).join(', ')}` }, ctx.now);

    const after = getProject(data, p.id)!;
    return { data, scope: { projectId: p.id }, changed, result: { changed, project: { id: after.id, name: after.name, nextAction: after.nextAction, ...(after.nextActionDue ? { nextActionDue: after.nextActionDue } : {}), blockers: after.blockers, waitingOn: after.waitingOn, phase: after.phase, milestone: after.milestone } } };
  },
};

interface UpdateWeekInput {
  week_start?: string;
  add_focus?: string[];
  remove_focus?: string[];
  notes?: string;
  append_notes?: string;
  add_blocks?: { title: string; project?: string; kind?: BlockKind; hours: number; day?: number }[];
}

const update_week_plan: WriteTool<UpdateWeekInput> = {
  kind: 'write',
  description:
    "Change a week's plan: add/remove focus projects, set or append notes, or add planning blocks. Blocks without a day stay unscheduled — Compass never auto-schedules. Existing blocks can't be removed here.",
  input: {
    week_start: { type: 'monday', optional: true, description: 'Monday of the week; defaults to the current week.' },
    add_focus: { type: 'array', of: { type: 'string', min: 1, max: TITLE }, max: 10, optional: true, description: 'Project ids or names.' },
    remove_focus: { type: 'array', of: { type: 'string', min: 1, max: TITLE }, max: 10, optional: true },
    notes: { type: 'string', max: TEXT, optional: true, description: 'Replaces the week notes.' },
    append_notes: { type: 'string', min: 1, max: TEXT, optional: true },
    add_blocks: {
      type: 'array',
      max: 10,
      optional: true,
      of: {
        type: 'object',
        fields: {
          title: { type: 'string', min: 1, max: TITLE },
          project: { type: 'string', min: 1, max: TITLE, optional: true },
          kind: { type: 'enum', values: BLOCK_KINDS.map((b) => b.id), optional: true },
          hours: { type: 'number', min: 0.25, max: 12 },
          day: { type: 'number', min: 0, max: 6, integer: true, optional: true, description: '0 = Monday … 6 = Sunday. Omit to leave unscheduled.' },
        },
      },
    },
    request_id: REQUEST_ID,
  },
  run(d, i, ctx) {
    const week = i.week_start ?? currentWeekStart(ctx.timeZone, ctx.now);
    if (i.notes !== undefined && i.append_notes !== undefined) fail('INVALID_INPUT', 'Use either notes or append_notes, not both.');
    let data = d;
    const changed: string[] = [];
    const focus = () => getWeek(data, week).focusProjectIds;

    for (const ref of i.add_focus ?? []) {
      const p = resolveProject(data, ref);
      if (!focus().includes(p.id)) {
        data = toggleFocus(data, week, p.id, ctx.now);
        changed.push(`focus+${p.id}`);
      }
    }
    for (const ref of i.remove_focus ?? []) {
      const p = resolveProject(data, ref);
      if (focus().includes(p.id)) {
        data = toggleFocus(data, week, p.id, ctx.now);
        changed.push(`focus-${p.id}`);
      }
    }
    const curNotes = getWeek(data, week).notes;
    const notes = i.append_notes ? `${curNotes.trimEnd()}${curNotes.trim() ? '\n' : ''}${i.append_notes}` : i.notes;
    if (notes !== undefined && notes !== curNotes) {
      data = updateWeek(data, week, (w) => ({ ...w, notes }));
      data = logActivity(data, { kind: 'focus', text: `Updated notes for week of ${week}` }, ctx.now);
      changed.push('notes');
    }
    for (const b of i.add_blocks ?? []) {
      const p = b.project ? resolveProject(data, b.project) : undefined;
      data = addBlock(data, week, { kind: b.kind ?? 'focus', title: b.title, hours: b.hours, ...(p ? { projectId: p.id } : {}), ...(b.day !== undefined ? { day: b.day } : {}) });
      data = logActivity(data, { ...(p ? { projectId: p.id } : {}), kind: 'focus', text: `Planned ${b.hours}h "${clip(b.title, 60)}" for week of ${week}${b.day === undefined ? ' (unscheduled)' : ''}` }, ctx.now);
      changed.push('block');
    }
    if (!changed.length) fail('INVALID_INPUT', `Nothing to change in the week of ${week}.`);
    return { data, scope: { weekStart: week }, changed, result: { changed, week: weekView(data, getWeek(data, week)) } };
  },
};

export const TOOLS = { list_projects, get_project, get_activity, get_week_plan, add_activity, create_task, update_task, update_project, update_week_plan } as const;

export type ToolName = keyof typeof TOOLS;

export const isToolName = (n: string): n is ToolName => Object.prototype.hasOwnProperty.call(TOOLS, n);

/** Validate raw input for a tool (throws INVALID_INPUT). */
export function parseToolInput(name: ToolName, raw: unknown): Record<string, unknown> {
  return parseInput<Record<string, unknown>>(TOOLS[name].input, raw);
}
