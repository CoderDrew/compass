// Post-conditions every agent write must satisfy before it may be committed. These are
// the server-side guard rails behind the narrow tool contracts: no deletions, no changes
// outside the target, no status/priority/deadline edits in the first release.

import type { AppData, Project } from '../../data/types.ts';
import { validate } from '../storage.ts';
import { stableStringify } from '../sync.ts';
import { fail } from './errors.ts';

export interface Scope {
  /** The one project the command may change. */
  projectId?: string;
  /** The one week plan the command may change. */
  weekStart?: string;
  /** Projects whose `lastActivity`/`updatedAt` may be touched (e.g. focus changes). */
  touchProjectIds?: string[];
}

/** Fields an agent may never change on any project in this release. */
export const FROZEN_PROJECT_FIELDS = ['id', 'name', 'category', 'status', 'priority', 'deadline', 'deadlineLabel', 'type', 'ongoing', 'limited', 'lowPressure', 'relatedIds', 'repoUrl', 'websiteUrl', 'weeklyHours', 'createdAt'] as const;

const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);
const withoutTouch = (p: Project) => ({ ...p, lastActivity: '', updatedAt: '' });

export function checkInvariants(before: AppData, after: AppData, scope: Scope): void {
  const problems: string[] = [];

  for (const k of ['schemaVersion', 'seededAt', 'settings', 'allocations'] as const)
    if (!same(before[k], after[k])) problems.push(`${k} must not change`);

  // Projects: none added or removed; only the target may change.
  const afterById = new Map(after.projects.map((p) => [p.id, p]));
  if (after.projects.length !== before.projects.length) problems.push('projects must not be added or removed');
  for (const b of before.projects) {
    const a = afterById.get(b.id);
    if (!a) {
      problems.push(`project ${b.id} must not be removed`);
      continue;
    }
    if (b.id === scope.projectId) {
      for (const f of FROZEN_PROJECT_FIELDS) if (!same(b[f], a[f])) problems.push(`${b.name}: ${f} must not change`);
      const tasksAfter = new Set(a.tasks.map((t) => t.id));
      if (b.tasks.some((t) => !tasksAfter.has(t.id))) problems.push(`${b.name}: tasks must not be removed`);
      const msAfter = new Set(a.milestones.map((m) => m.id));
      if (b.milestones.some((m) => !msAfter.has(m.id))) problems.push(`${b.name}: milestones must not be removed`);
    } else if (scope.touchProjectIds?.includes(b.id)) {
      if (!same(withoutTouch(b), withoutTouch(a))) problems.push(`${b.name} must not change`);
    } else if (!same(b, a)) {
      problems.push(`${b.name} must not change`);
    }
  }

  // Weeks: none removed; only the target week may change.
  for (const [k, w] of Object.entries(before.weeks)) {
    if (!after.weeks[k]) problems.push(`week ${k} must not be removed`);
    else if (k !== scope.weekStart && !same(w, after.weeks[k])) problems.push(`week ${k} must not change`);
    else if (k === scope.weekStart) {
      const ids = new Set(after.weeks[k].blocks.map((x) => x.id));
      if (w.blocks.some((x) => !ids.has(x.id))) problems.push(`week ${k}: blocks must not be removed`);
    }
  }
  for (const k of Object.keys(after.weeks)) if (!before.weeks[k] && k !== scope.weekStart) problems.push(`week ${k} must not be created`);

  // Activity: existing entries unchanged; only the oldest may roll off at the 2,000 cap.
  const afterIds = new Set(after.activity.map((e) => e.id));
  const added = after.activity.filter((e) => !before.activity.some((x) => x.id === e.id)).length;
  const removed = before.activity.filter((e) => !afterIds.has(e.id));
  if (removed.length > added || removed.some((e) => before.activity.indexOf(e) < before.activity.length - added))
    problems.push('activity history must not be removed');
  const beforeById = new Map(before.activity.map((e) => [e.id, e]));
  if (after.activity.some((e) => beforeById.has(e.id) && !same(beforeById.get(e.id), e))) problems.push('existing activity must not change');

  problems.push(...validate(after));
  if (problems.length) fail('NOT_ALLOWED', `Change rejected: ${problems[0]}`, { details: problems });
}
