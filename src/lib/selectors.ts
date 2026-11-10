// Derived views over AppData: progress, attention, deadlines, filtering, capacity.
// Pure functions — `today` is always passed in so results are testable.

import { PRIORITY_RANK, STATUS_RANK } from '../data/meta';
import type { AppData, CategoryId, DueString, Priority, Project, Status, WeekPlan } from '../data/types';
import { daysUntil, parseDue } from './dates';

// ── Progress ────────────────────────────────────────────────────

export interface Progress {
  done: number;
  total: number;
  basis: 'milestones' | 'tasks';
}

/** Progress is only reported where measurable — never a made-up percentage. */
export function progressOf(p: Project): Progress | null {
  if (p.ongoing) return null;
  if (p.milestones.length) return { done: p.milestones.filter((m) => m.done).length, total: p.milestones.length, basis: 'milestones' };
  if (p.tasks.length) return { done: p.tasks.filter((t) => t.status === 'done').length, total: p.tasks.length, basis: 'tasks' };
  return null;
}

// ── Attention ───────────────────────────────────────────────────

export const PLANNING_STATUSES: Status[] = ['active', 'waiting', 'maintain'];
export const isOpen = (p: Project) => p.status !== 'completed' && p.status !== 'archived';

export type AttentionReason = 'overdue' | 'due-soon' | 'deadline-near' | 'no-next-action' | 'stale-waiting' | 'blocked';

export const REASON_LABEL: Record<AttentionReason, string> = {
  overdue: 'Overdue item',
  'due-soon': 'Due this week',
  'deadline-near': 'Deadline within 30 days',
  'no-next-action': 'No next action',
  'stale-waiting': 'Waiting 2+ weeks — follow up?',
  blocked: 'Has a blocker',
};

const STALE_DAYS = 14;

export function attentionReasons(p: Project, today: Date): AttentionReason[] {
  // Hobbies and paused work never nag.
  if (p.lowPressure || !PLANNING_STATUSES.includes(p.status)) return [];
  const r = new Set<AttentionReason>();
  const dues: (DueString | undefined)[] = [
    p.nextActionDue,
    ...p.tasks.filter((t) => t.status !== 'done').map((t) => t.due),
    ...p.milestones.filter((m) => !m.done).map((m) => m.targetDate),
  ];
  for (const due of dues) {
    const n = daysUntil(due, today);
    if (n === null) continue;
    const month = parseDue(due)?.precision === 'month';
    if (n < 0 && !month) r.add('overdue');
    else if (n <= 7) r.add('due-soon');
  }
  const dl = daysUntil(p.deadline, today);
  if (dl !== null && dl <= 30) r.add('deadline-near');
  if (!p.nextAction.trim() && p.status !== 'maintain') r.add('no-next-action');
  if (p.blockers.trim()) r.add('blocked');
  if (p.status === 'waiting') {
    const since = (today.getTime() - new Date(p.lastActivity).getTime()) / 86_400_000;
    if (since >= STALE_DAYS) r.add('stale-waiting');
  }
  return [...r];
}

export const needsAttention = (p: Project, today: Date) => attentionReasons(p, today).length > 0;

// ── Deadlines / dated items ─────────────────────────────────────

export interface DatedItem {
  key: string;
  projectId: string;
  projectName: string;
  title: string;
  due: DueString;
  kind: 'deadline' | 'milestone' | 'task' | 'next-action';
  days: number;
  lowPressure: boolean;
}

export function datedItems(d: AppData, today: Date): DatedItem[] {
  const out: DatedItem[] = [];
  for (const p of d.projects) {
    if (!isOpen(p)) continue;
    const push = (key: string, title: string, due: DueString | undefined, kind: DatedItem['kind']) => {
      const days = daysUntil(due, today);
      if (days === null || !due) return;
      out.push({ key, projectId: p.id, projectName: p.name, title, due, kind, days, lowPressure: !!p.lowPressure });
    };
    push(`${p.id}:deadline`, p.deadlineLabel || 'Deadline', p.deadline, 'deadline');
    if (p.nextAction) push(`${p.id}:next`, p.nextAction, p.nextActionDue, 'next-action');
    p.milestones.filter((m) => !m.done).forEach((m) => push(m.id, m.title, m.targetDate, 'milestone'));
    p.tasks.filter((t) => t.status !== 'done').forEach((t) => push(t.id, t.title, t.due, 'task'));
  }
  return out.sort((a, b) => a.days - b.days);
}

export type UrgencyGroup = 'overdue' | 'week' | 'month' | 'quarter' | 'later';
export const URGENCY_LABEL: Record<UrgencyGroup, string> = {
  overdue: 'Past due',
  week: 'Next 7 days',
  month: 'Next 30 days',
  quarter: 'Next 3 months',
  later: 'Later',
};

export function urgencyOf(item: Pick<DatedItem, 'days' | 'due'>): UrgencyGroup {
  const month = parseDue(item.due)?.precision === 'month';
  if (item.days < 0 && !month) return 'overdue';
  if (item.days <= 7) return 'week';
  if (item.days <= 30) return 'month';
  if (item.days <= 92) return 'quarter';
  return 'later';
}

export function groupByUrgency(items: DatedItem[]): [UrgencyGroup, DatedItem[]][] {
  const order: UrgencyGroup[] = ['overdue', 'week', 'month', 'quarter', 'later'];
  return order.map((g) => [g, items.filter((i) => urgencyOf(i) === g)] as [UrgencyGroup, DatedItem[]]).filter(([, l]) => l.length);
}

// ── Filters ─────────────────────────────────────────────────────

export interface Filters {
  q: string;
  categories: CategoryId[];
  statuses: Status[];
  priorities: Priority[];
  deadline: 'any' | 'has' | '30' | '90';
  focusOnly: boolean;
  waitingOnly: boolean;
  attentionOnly: boolean;
}

export const EMPTY_FILTERS: Filters = {
  q: '',
  categories: [],
  statuses: [],
  priorities: [],
  deadline: 'any',
  focusOnly: false,
  waitingOnly: false,
  attentionOnly: false,
};

export const activeFilterCount = (f: Filters) =>
  (f.q ? 1 : 0) + f.categories.length + f.statuses.length + f.priorities.length + (f.deadline !== 'any' ? 1 : 0) +
  (f.focusOnly ? 1 : 0) + (f.waitingOnly ? 1 : 0) + (f.attentionOnly ? 1 : 0);

export function matchesFilters(p: Project, f: Filters, ctx: { today: Date; focusIds: string[] }): boolean {
  // Archived projects only appear when explicitly requested.
  if (p.status === 'archived' && !f.statuses.includes('archived')) return false;
  if (f.q) {
    const hay = [p.name, p.description, p.nextAction, p.notes, p.phase, p.milestone, p.type, p.waitingOn, p.blockers, ...p.tasks.map((t) => t.title)]
      .join(' ')
      .toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))) return false;
  }
  if (f.categories.length && !f.categories.includes(p.category)) return false;
  if (f.statuses.length && !f.statuses.includes(p.status)) return false;
  if (f.priorities.length && !f.priorities.includes(p.priority)) return false;
  if (f.deadline !== 'any') {
    const n = daysUntil(p.deadline, ctx.today);
    if (n === null) return false;
    if (f.deadline !== 'has' && n > Number(f.deadline)) return false;
  }
  if (f.focusOnly && !ctx.focusIds.includes(p.id)) return false;
  if (f.waitingOnly && p.status !== 'waiting' && !p.waitingOn.trim()) return false;
  if (f.attentionOnly && !needsAttention(p, ctx.today)) return false;
  return true;
}

export function sortProjects(list: Project[]): Project[] {
  return [...list].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.name.localeCompare(b.name),
  );
}

// ── Capacity ────────────────────────────────────────────────────

export function plannedHours(w: WeekPlan): number {
  return w.blocks.reduce((s, b) => s + (b.kind === 'deadline' ? 0 : b.hours || 0), 0);
}

export interface CapacityState {
  planned: number;
  capacity: number;
  remaining: number;
  level: 'ok' | 'tight' | 'over';
}

export function capacityState(w: WeekPlan, capacity: number): CapacityState {
  const planned = plannedHours(w);
  const remaining = capacity - planned;
  const level = planned > capacity ? 'over' : planned > capacity * 0.85 ? 'tight' : 'ok';
  return { planned, capacity, remaining, level };
}

/** Soft guidance: more than this many focus projects dilutes the week. */
export const FOCUS_SOFT_LIMIT = 5;

// ── Dashboard health ────────────────────────────────────────────

export function portfolioHealth(d: AppData, projects: Project[], today: Date) {
  const open = projects.filter(isOpen);
  const items = datedItems({ ...d, projects }, today);
  const since = new Date(today.getTime() - 30 * 86_400_000).toISOString();
  return {
    active: open.filter((p) => p.status === 'active').length,
    critical: open.filter((p) => p.priority === 'critical' && PLANNING_STATUSES.includes(p.status)).length,
    waiting: open.filter((p) => p.status === 'waiting' || p.waitingOn.trim()).length,
    deadlines: items.filter((i) => i.kind === 'deadline' && i.days <= 92).length,
    milestonesDone: projects.reduce((s, p) => s + p.milestones.filter((m) => m.done && m.completedAt && m.completedAt >= since).length, 0),
    noNextAction: open.filter((p) => ['active', 'waiting'].includes(p.status) && !p.nextAction.trim()).length,
  };
}
