# Agent Deletes, Block Edits and Restore — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents can delete tasks and milestones, remove and edit week-plan blocks, and restore anything they deleted.

**Architecture:** New write tools in `src/lib/agent/tools.ts` reuse the existing `ops.ts` delete functions. Each delete writes an activity entry carrying a `deleted` snapshot. `checkInvariants` allows removal only of ids named in the scope and only with a matching snapshot. `restore_deleted` re-inserts a snapshot by activity id.

**Tech Stack:** TypeScript, Vitest, esbuild bundle for the Supabase Edge Function (Deno).

**Spec:** `docs/superpowers/specs/2026-11-15-agent-deletes-design.md`

## Global Constraints

- Status, priority, deadlines (all `FROZEN_PROJECT_FIELDS`) stay unchangeable by agents.
- No deleting projects, weeks, activity or journal entries.
- `remove_blocks` and `update_blocks` take at most 10 items each.
- `delete_task`, `delete_milestone` and `update_week_plan` get `destructiveHint: true`; all other tools keep `false`.
- Restored items keep their original id.
- `supabase/functions/_shared/compass-agent.js` is regenerated with `npm run build:shared` (stale-bundle test enforces it).

## Review Focus

1. Removing a block id that isn't in the week → NOT_FOUND naming the id, nothing changed.
2. The same block id in both `remove_blocks` and `update_blocks` → INVALID_INPUT.
3. Restoring twice → second call NOT_ALLOWED ("already exists"), not a duplicate item.
4. Restoring a task whose project was deleted in the app → NOT_ALLOWED, nothing changed.
5. A tool that removes an item without the snapshot entry (a future bug) → invariant rejects the write.

---

### Task 1: Snapshot type, validation and invariants

**Files:**
- Modify: `src/data/types.ts` (`ActivityEntry`)
- Modify: `src/lib/storage.ts` (activity validation, ~line 89)
- Modify: `src/lib/agent/invariants.ts`
- Test: `src/lib/agent/invariants.test.ts` (create)

**Interfaces:**
- Produces: `ActivityEntry.deleted?: DeletedSnapshot` where
  `type DeletedSnapshot = { type: 'task'; projectId: string; item: Task } | { type: 'milestone'; projectId: string; item: Milestone } | { type: 'block'; weekStart: string; item: PlanBlock }` (exported from `types.ts`).
- Produces: `Scope.removeTaskIds?: string[]`, `Scope.removeMilestoneIds?: string[]`, `Scope.removeBlockIds?: string[]`, `Scope.restore?: boolean`.

- [ ] **Step 1: Write failing tests** in `invariants.test.ts`:
  - `rejects removing a task not named in scope` → `checkInvariants` throws NOT_ALLOWED "tasks must not be removed".
  - `allows removing a named task when a new activity entry snapshots it` → no throw.
  - `rejects a named removal without a snapshot entry` → throws "must be snapshotted" (Review Focus 5).
  - Same allow/reject pair for a milestone and for a block.
  - `validate accepts an activity entry with a deleted snapshot and rejects a malformed one` (`deleted: { type: 'nope' }`).
- [ ] **Step 2:** `npx vitest run src/lib/agent/invariants.test.ts` → FAIL.
- [ ] **Step 3:** Implement. In `checkInvariants`, a removed task/milestone/block id is allowed only if it is in the matching `Scope.remove*Ids` **and** a new activity entry (not in `before`) has `deleted.item.id === id` of the right type. Every other check is unchanged. In `storage.ts`, `deleted` is optional; when present it must be an object with `type` in `task|milestone|block`, an object `item` with string `id`, and string `projectId` (task/milestone) or `weekStart` (block).
- [ ] **Step 4:** Run tests → PASS; `npm test` → all pass.
- [ ] **Step 5:** Commit `feat(agent): deletion snapshots and scoped-removal invariants`.

### Task 2: `delete_task` and `delete_milestone`

**Files:**
- Modify: `src/lib/agent/tools.ts`, `src/lib/agent/mcp.ts` (TITLES, annotations, instructions)
- Test: `src/lib/agent/delete-tools.test.ts` (create)

**Interfaces:**
- Consumes: `deleteTask`, `deleteMilestone` from `ops.ts`; `resolveProject`, `resolveTask`, `resolveMilestone`; `DeletedSnapshot`.
- Produces: tools `delete_task { project, task, request_id? }` and `delete_milestone { project, milestone, request_id? }`, results `{ projectId, deleted: { id, title }, activityId }`.

- [ ] **Step 1: Write failing tests** (use `runTool` + `memoryPortfolioStore(seed())`, pattern from `run.test.ts`):
  - `delete_task removes the task and logs "Deleted task: <title>" with a snapshot and agent source`.
  - `delete_task by ambiguous title → AMBIGUOUS_REFERENCE, nothing changed`.
  - `delete_milestone removes it and logs "Deleted milestone: <title>"`.
  - `repeating with the same request_id is a duplicate`.
  - In `mcp.ts` tests: `delete_task`, `delete_milestone`, `update_week_plan` have `destructiveHint: true`, others `false`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement both tools. Scope `{ projectId, removeTaskIds: [id] }` / `{ projectId, removeMilestoneIds: [id] }`; return `taskId` for task deletes. Activity `kind: 'task'` / `'milestone'`. In `mcp.ts`: add TITLES "Delete task", "Delete milestone"; set `destructiveHint` from a `DESTRUCTIVE` name set; replace the instruction line "Status, priority and deadlines cannot be changed through this integration. Nothing can be deleted." with "Status, priority and deadlines cannot be changed through this integration. Deleted tasks, milestones and week-plan blocks can be brought back with restore_deleted; only delete what the user asked for, by id." Update `supabase/tests/mcp.test.ts` tool-name list.
- [ ] **Step 4:** Run → PASS; `npm test` → all pass.
- [ ] **Step 5:** Commit `feat(agent): delete_task and delete_milestone tools`.

### Task 3: Remove and edit week-plan blocks

**Files:**
- Modify: `src/lib/agent/tools.ts` (`UpdateWeekInput`, `update_week_plan`)
- Test: `src/lib/agent/delete-tools.test.ts`

**Interfaces:**
- Consumes: `removeBlock`, `updateBlock` from `ops.ts`.
- Produces: `update_week_plan` inputs `remove_blocks?: string[]` (≤ 10, block ids) and
  `update_blocks?: { id: string; title?: string; hours?: number (0.25–12); day?: number (0–6); unschedule?: boolean; project?: string | null; kind?: BlockKind }[]` (≤ 10).

- [ ] **Step 1: Write failing tests:**
  - `re-plans a week in one call`: add a block, then one call removes it and retitles another → block gone, title changed, log has "Removed block" (with snapshot) and "Changed block".
  - `unknown block id → NOT_FOUND naming the id, nothing changed` (Review Focus 1).
  - `same id in remove_blocks and update_blocks → INVALID_INPUT` (Review Focus 2).
  - `day and unschedule together → INVALID_INPUT`; `unschedule: true` clears `day`; `project: null` clears `projectId`.
  - `an update that changes nothing is not counted as a change`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement: process `update_blocks` then `remove_blocks` after existing steps; scope `{ weekStart, removeBlockIds }`. Change the description sentence "Existing blocks can't be removed here." to "Remove or edit existing blocks by id (ids come from get_week_plan)."
- [ ] **Step 4:** Run → PASS; `npm test` → all pass.
- [ ] **Step 5:** Commit `feat(agent): remove and edit week-plan blocks`.

### Task 4: `restore_deleted`

**Files:**
- Modify: `src/lib/agent/tools.ts`, `src/lib/agent/mcp.ts` (TITLES "Restore deleted item"), `src/lib/agent/invariants.ts` (restore scope)
- Test: `src/lib/agent/delete-tools.test.ts`

**Interfaces:**
- Consumes: `DeletedSnapshot`; `Scope.restore`.
- Produces: tool `restore_deleted { activity_id, request_id? }`, result `{ restored: { type, id, title }, projectId? , weekStart? }`.

- [ ] **Step 1: Write failing tests:**
  - `restores a deleted task with its original id and logs "Restored task: <title>"`.
  - Same for a milestone and a block.
  - `restoring twice → NOT_ALLOWED "already exists"` (Review Focus 3).
  - `activity entry without a snapshot → NOT_FOUND`.
  - `project deleted since → NOT_ALLOWED, nothing changed` (Review Focus 4; delete the project with `deleteProject` via `store.externalWrite`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Tasks/milestones are appended to the project's list; blocks to the week (create nothing: if the week is missing, NOT_ALLOWED). Scope `{ projectId }` or `{ weekStart }` plus `restore: true`; invariants already allow additions, so `restore` only needs to be accepted. Mention `restore_deleted` in its description: "Bring back a task, milestone or week-plan block an agent deleted, using the activity id from the delete result or get_activity."
- [ ] **Step 4:** Run → PASS; `npm test` → all pass.
- [ ] **Step 5:** Commit `feat(agent): restore_deleted tool`.

### Task 5: Bundle, docs, full verification

**Files:**
- Regenerate: `supabase/functions/_shared/compass-agent.js` (+ `.d.ts` if the script writes one)
- Modify: `docs/DECISIONS.md` (#7 amended; new #15 "Agent deletes with restore"), `docs/integrations/architecture.md` (§5.3 line 111, R6), `docs/integrations/mcp-tools.md` (new tools, `update_week_plan` inputs), `README.md` (tool list)

- [ ] **Step 1:** `npm run build:shared` → writes the bundle without errors.
- [ ] **Step 2:** `npm test` and `npm run typecheck` → all pass, including `supabase/tests/shared-bundle.test.ts`.
- [ ] **Step 3:** Update the docs listed above; tool count goes from 13 to 16.
- [ ] **Step 4:** Commit `docs: agent deletes, block edits and restore` (bundle included).
