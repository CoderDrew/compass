// Core domain types for Project Compass.
// Dates are ISO strings. A "due" value may be a full day (YYYY-MM-DD) or a
// month-only value (YYYY-MM) when only the month is known — e.g. a convention
// in "February 2027". We never invent a day that wasn't provided.

export const SCHEMA_VERSION = 1;

export type CategoryId = 'employment' | 'business' | 'software' | 'creative' | 'career' | 'personal';

export type Status = 'active' | 'maintain' | 'review' | 'waiting' | 'parked' | 'completed' | 'archived';

export type Priority = 'critical' | 'high' | 'medium' | 'low';

export type TaskStatus = 'todo' | 'doing' | 'done';

/** YYYY-MM-DD or YYYY-MM */
export type DueString = string;

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  due?: DueString;
  /** Free-form effort estimate, e.g. "2h", "30m", "half day". */
  effort?: string;
  completedAt?: string;
  notes?: string;
}

export interface Milestone {
  id: string;
  title: string;
  targetDate?: DueString;
  done: boolean;
  completedAt?: string;
  description?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  category: CategoryId;
  status: Status;
  priority: Priority;
  /** e.g. "Client project", "Hobby", "Ongoing employment" */
  type: string;
  phase: string;
  /** Free-text description of the current milestone / focus. */
  milestone: string;
  nextAction: string;
  nextActionDue?: DueString;
  /** A real, externally fixed deadline. Never fabricated. */
  deadline?: DueString;
  deadlineLabel?: string;
  lastActivity: string;
  blockers: string;
  waitingOn: string;
  /** Estimated weekly hours, only when known. */
  weeklyHours?: number;
  notes: string;
  repoUrl?: string;
  websiteUrl?: string;
  relatedIds: string[];
  /** Ongoing commitments (employment, recurring hobbies) don't show % progress. */
  ongoing?: boolean;
  /** "Active, limited allocation" — deliberately capped effort. */
  limited?: boolean;
  /** Low-pressure: hobbies never show as overdue or "needs attention". */
  lowPressure?: boolean;
  tasks: Task[];
  milestones: Milestone[];
  createdAt: string;
  updatedAt: string;
}

export type ActivityKind =
  | 'status'
  | 'priority'
  | 'task'
  | 'milestone'
  | 'note'
  | 'decision'
  | 'next-action'
  | 'blocker'
  | 'waiting'
  | 'project'
  | 'focus'
  | 'review';

/** Who made a change, when it wasn't made directly in the app. Absent = made in Compass itself. */
export interface ActivitySource {
  type: 'agent';
  /** Human-readable integration name, e.g. "ChatGPT". */
  agent: string;
  /** OAuth client id of the integration, when known. */
  clientId?: string;
}

export interface ActivityEntry {
  id: string;
  at: string;
  projectId?: string;
  /** Task the entry is about, when it concerns a single task. */
  taskId?: string;
  kind: ActivityKind;
  text: string;
  /** Set for changes made by an external integration (optional; older data has none). */
  source?: ActivitySource;
  /** Stable operation id shared by all entries from one external operation (dedupe/troubleshooting). */
  opId?: string;
}

export type BlockKind = 'fixed' | 'deadline' | 'session' | 'recurring' | 'focus';

export interface PlanBlock {
  id: string;
  kind: BlockKind;
  title: string;
  projectId?: string;
  /** 0 = Monday … 6 = Sunday; undefined = not yet placed on a day. */
  day?: number;
  hours: number;
}

export interface WeekPlan {
  /** ISO date (YYYY-MM-DD) of the Monday starting the week. */
  weekStart: string;
  focusProjectIds: string[];
  blocks: PlanBlock[];
  notes: string;
  reviewedAt?: string;
}

export interface AllocationSuggestion {
  id: string;
  label: string;
  projectIds: string[];
  blocks: number;
  kind: BlockKind;
  /** Protected employment hours are tracked outside discretionary capacity. */
  protected?: boolean;
  hours?: number;
}

export interface Settings {
  theme: 'dark' | 'light' | 'system';
  /** Discretionary hours available each week outside employment. */
  weeklyCapacity: number;
  /** Protected employment hours, shown separately from capacity. */
  employmentHours: number;
  /** Default length of a focus block in hours. */
  blockHours: number;
  /** IANA time zone (e.g. "America/Edmonton") used by integrations for "today" and "this week". */
  timeZone?: string;
}

export interface AppData {
  schemaVersion: number;
  projects: Project[];
  activity: ActivityEntry[];
  weeks: Record<string, WeekPlan>;
  allocations: AllocationSuggestion[];
  settings: Settings;
  seededAt: string;
}
