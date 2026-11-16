# Agent deletes, block edits and restore — design

Date: 2026-11-15 · Status: proposed

## Intent

Drew re-plans his week from his phone through an agent (Claude Duet). On 2026-11-15 the agent added a
ContractIQ block but could not delete the obsolete Thursday deploy block or retitle Friday's block, so the
change had to be finished on the website. Goal: everyday upkeep of tasks, milestones and the week plan can be
done entirely through the agent, without switching to the app.

## Goals

- Agents can **remove and edit existing week-plan blocks** (title, hours, day, project, kind; unschedule).
- Agents can **delete tasks** and **delete milestones**, on any project, not only things agents created.
- Every agent delete is **recoverable from the same chat** ("undo that").

## Non-goals

- Status, priority and deadline changes stay off-limits (DECISIONS #7 otherwise stands).
- Deleting projects, weeks, activity or journal entries.
- A restore screen in the app (can come later; the snapshot makes it possible).
- Changing how deletes work in the app itself.

## Anti-goals

- A delete that silently loses data with no trace.
- A prompt-injected or misheard request that wipes many things in one unconfirmed call.

## Approaches considered

- **A. Delete and log.** Smallest. Deleted items are gone; retyping a task with notes is painful.
- **B. Delete, log, and keep a snapshot in the log entry, plus a restore tool.** ← **Picked by Drew.** No new
  data area; snapshots age out with the 2,000-entry activity cap.
- **C. "Recently deleted" area with an app restore screen.** Most complete, but adds UI and a new data section
  for a website Drew is trying not to need.

## Design

**Data.** `ActivityEntry` gains optional `deleted?: { type: 'task' | 'milestone' | 'block'; projectId?: string;
weekStart?: string; item: Task | Milestone | PlanBlock }`. `validate()` accepts it; older data is unaffected.

**Tools.**
- `delete_task { project, task, request_id? }` → `deleteTask`, logs `Deleted task: <title>` with snapshot.
  `task` is resolved the same way `update_task` resolves it (id or title, AMBIGUOUS_REFERENCE on ties).
- `delete_milestone { project, milestone, request_id? }` → `deleteMilestone`, same pattern.
- `update_week_plan` gains `remove_blocks: string[]` (block ids, ≤ 10) and
  `update_blocks: [{ id, title?, hours?, day? (number | null = unschedule), project? (null = none), kind? }]`
  (≤ 10). Removals log `Removed block "<title>"` with snapshot; edits log `Changed block "<title>": …`.
  Block ids come from `get_week_plan`. One call can re-plan a whole week.
- `restore_deleted { activity_id, request_id? }` re-inserts the snapshot with its original id. Fails with
  NOT_FOUND if the entry has no snapshot, and NOT_ALLOWED if the item already exists or its project/week is
  gone. Logs `Restored <type>: <title>`.

**Guard rails.**
- Invariants: `Scope` gains `removeTaskIds`, `removeMilestoneIds`, `removeBlockIds`. Only the named ids may
  disappear, and each must have a matching new activity entry carrying its snapshot. Everything else in
  `checkInvariants` is unchanged (frozen project fields, other projects/weeks untouched, activity append-only).
- Restore: scope allows exactly one item to be added back.
- MCP annotations: `delete_task`, `delete_milestone` and `update_week_plan` get `destructiveHint: true` so
  clients confirm them. `restore_deleted` stays non-destructive.
- Server instructions: replace "Nothing can be deleted" with: deletes are recoverable with restore_deleted;
  only delete what the user asked for, by id.

**Docs.** Update DECISIONS #7 (and add a new decision entry), architecture R6 and §5.3, mcp-tools.md,
README tool list. Regenerate `supabase/functions/_shared/compass-agent.js` with `npm run build:shared`.

## Left to the builder

- Exact wording of log lines and tool descriptions.
- Test layout (follow `src/lib/agent/*.test.ts` and `supabase/tests/mcp.test.ts`).
- Deploying the edge function is a separate step Drew runs.
