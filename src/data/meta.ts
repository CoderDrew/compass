import type { BlockKind, CategoryId, Priority, Status, TaskStatus } from './types.ts';

export const CATEGORIES: { id: CategoryId; label: string; short: string }[] = [
  { id: 'employment', label: 'Employment', short: 'Work' },
  { id: 'business', label: 'Mindjax / Business', short: 'Mindjax' },
  { id: 'software', label: 'Software Products', short: 'Software' },
  { id: 'creative', label: 'Tabletop & Creative', short: 'Creative' },
  { id: 'career', label: 'Career & Education', short: 'Career' },
  { id: 'personal', label: 'Personal / Maintenance', short: 'Personal' },
];

export const categoryLabel = (id: CategoryId) => CATEGORIES.find((c) => c.id === id)?.label ?? id;

export const STATUSES: { id: Status; label: string; hint: string }[] = [
  { id: 'active', label: 'Active', hint: 'Currently receiving deliberate effort' },
  { id: 'maintain', label: 'Maintain', hint: 'Ongoing; needs periodic attention' },
  { id: 'waiting', label: 'Waiting', hint: 'Blocked on a decision, response, or event' },
  { id: 'review', label: 'Review', hint: 'Worth revisiting; not scheduled' },
  { id: 'parked', label: 'Parked', hint: 'Deliberately paused' },
  { id: 'completed', label: 'Completed', hint: 'Finished or delivered' },
  { id: 'archived', label: 'Archived', hint: 'History only' },
];

export const statusLabel = (s: Status) => STATUSES.find((x) => x.id === s)?.label ?? s;

/** Dot colors for statuses — deliberately restrained. */
export const STATUS_DOT: Record<Status, string> = {
  active: 'bg-accent',
  maintain: 'bg-teal-400',
  waiting: 'bg-amber-400',
  review: 'bg-violet-400',
  parked: 'bg-zinc-400 dark:bg-zinc-500',
  completed: 'bg-emerald-500',
  archived: 'bg-zinc-300 dark:bg-zinc-700',
};

export const PRIORITIES: { id: Priority; label: string }[] = [
  { id: 'critical', label: 'Critical' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];

export const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
export const STATUS_RANK: Record<Status, number> = {
  active: 0, waiting: 1, maintain: 2, review: 3, parked: 4, completed: 5, archived: 6,
};

export const TASK_STATUSES: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'In progress' },
  { id: 'done', label: 'Done' },
];

export const BLOCK_KINDS: { id: BlockKind; label: string; hint: string }[] = [
  { id: 'focus', label: 'Focus block', hint: 'Flexible deep-work block' },
  { id: 'session', label: 'Work session', hint: 'Proposed session for a project' },
  { id: 'recurring', label: 'Recurring', hint: 'Regular responsibility' },
  { id: 'fixed', label: 'Appointment', hint: 'Fixed time commitment' },
  { id: 'deadline', label: 'Deadline', hint: 'Due on this day' },
];

export const blockKindLabel = (k: BlockKind) => BLOCK_KINDS.find((b) => b.id === k)?.label ?? k;

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
