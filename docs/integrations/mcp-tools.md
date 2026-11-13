# Compass MCP tools: contracts

Status: **Phase 1 — decisions recorded.** 13 tools (D3 approved; journal tools added in DECISIONS #14). The command layer behind these tools (`src/lib/agent/`) is implemented and tested in Phase 1; the MCP wiring is Phase 3.

## Conventions

- **References.** Every tool that targets a project accepts `project` as either a stable id (`"starfall"`, `"p-…"`) or a name. Resolution order: exact id → exact name (case-insensitive) → unique normalised match (punctuation/space-insensitive, then "starts with", then "contains"). More than one match → `AMBIGUOUS_REFERENCE` with up to 5 candidates `{id, name}`. No match → `NOT_FOUND` with up to 3 closest names. Tasks resolve the same way **within the resolved project**.
- **Dates.** `YYYY-MM-DD` or month-only `YYYY-MM`, validated with the app's `isValidDue`. Week starts must be a Monday (`YYYY-MM-DD`). Tools never invent a date the user didn't give.
- **Idempotency.** Each write accepts an optional `request_id` (string ≤ 64). The server derives `opId` = `request_id` or a hash of `(tool, canonical args)` within a 10-minute window. If an activity entry with that `opId` already exists, the tool returns `{ ok: true, duplicate: true, … }` and writes nothing.
- **Attribution.** Every write adds at least one activity entry with `source: { type: 'agent', agent, clientId }` and `opId`.
- **Annotations.** Read tools: `readOnlyHint: true, destructiveHint: false, openWorldHint: false`. Write tools: `readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true` (idempotent via `request_id`/op hash).
- **Limits.** Strings: titles ≤ 200 chars, text ≤ 4,000. Unknown fields → `INVALID_INPUT`.

## Error model

Errors are returned as tool results with `isError: true` and a structured body:

```json
{ "ok": false, "error": { "code": "AMBIGUOUS_REFERENCE", "message": "…", "candidates": [{ "id": "…", "name": "…" }] } }
```

| Code | Meaning | Agent should |
| --- | --- | --- |
| `INVALID_INPUT` | Schema/format violation (bad date, too long, unknown field, nothing to change) | Fix arguments |
| `NOT_FOUND` | Project/task not found (`suggestions` included) | Ask the user |
| `AMBIGUOUS_REFERENCE` | More than one match (`candidates` included) | Ask the user which one |
| `NOT_ALLOWED` | Change outside the tool's permitted fields / invariant violated | Explain; don't retry |
| `CONFLICT_RETRY_EXHAUSTED` | Data kept changing during 3 rebase attempts | Retry later |
| `DATA_INVALID` | Stored document fails validation; nothing done | Tell the user to open Compass |
| `RATE_LIMITED` | Too many requests (`retryAfterSeconds`) | Wait |
| `UNAUTHORIZED` / `FORBIDDEN` | Token invalid / AI access disabled / client not allowed | Reconnect |
| `INTERNAL` | Unexpected; `opId` included for troubleshooting | Report |

## Read tools

### `list_projects`
Input: `{ status?: Status[], category?: CategoryId[], focus_only?: boolean, needs_attention?: boolean, stale_days?: number (1–365), query?: string, limit?: 1–50 (default 50) }`
Output: `{ weekStart, projects: [{ id, name, category, status, priority, nextAction, nextActionDue?, deadline?, lastActivity, daysSinceActivity, inFocus, attention: string[], openTasks, lowPressure }] , total }`
Notes: archived projects excluded unless requested by status. `stale_days` answers "what hasn't received attention recently" using `lastActivity`; low-pressure projects are flagged as such rather than nagged.

### `get_project`
Input: `{ project: string }`
Output: project fields (description, phase, milestone, nextAction, blockers, waitingOn, notes ≤ 4,000 chars, links), `tasks[]` (id, title, status, priority, due, effort), `milestones[]`, last 20 activity entries, `inFocus`.

### `get_activity`
Input: `{ since?: date, until?: date, project?: string, kinds?: ActivityKind[], limit?: 1–200 (default 50) }`
Output: `{ entries: [{ id, at, kind, text, projectId?, projectName?, taskId?, source? }] }` newest first.

### `get_week_plan`
Input: `{ week_start?: Monday date }` (default: current week in the user's time zone)
Output: `{ weekStart, focus: [{id, name}], blocks: [{ id, kind, title, projectId?, day?, hours }], plannedHours, capacityHours, notes, reviewedAt? }`

### `get_journal`
Input: `{ since?: date, until?: date, limit?: 1–200 (default 50) }`. `since` defaults to 6 days before today, in the user's time zone.
Output: `{ since, until?, total, entries: [{ id, day, at, author ('user' | agent name), text, starred?, projects?: [{id, name}] }] }`, newest day first.
Returns **only** agent summaries and notes the user starred. Other user notes are private and never returned.

## Write tools

### `add_journal_summary`
Post a short end-of-work summary to the user's daily journal.
Input: `{ text: string (1–4,000), projects?: string[] (≤ 5, id or name), day?: date (default today; not in the future, ≤ 7 days back), request_id? }`
Effect: `addJournalEntry` with `source` and `opId` stamped on the journal entry; no activity entry is added. Invariants allow only appending agent-attributed, unstarred entries: existing entries can't change. At most 30 agent summaries per day (`NOT_ALLOWED`). Duplicate detection also checks journal `opId`s.
Output: `{ ok, entry: { id, day, at, author, text, projects? }, duplicate? }`

### `add_activity`
Log progress, notes or decisions ("Log today's Starfall progress …").
Input: `{ project?: string, kind?: 'note' | 'decision' (default 'note'), text: string (1–4,000), request_id? }`
Effect: `recordEntry` (existing op) → touches the project's `lastActivity`.
Output: `{ ok, entry: { id, at, kind, text, projectId? }, duplicate? }`

### `create_task`
Input: `{ project: string, title: string, priority?: Priority, due?: date, effort?: string (≤ 40), notes?: string, request_id? }`
Effect: `addTask` + activity entry "Added task: …" (`kind: 'task'`, `taskId`).
Rejects a duplicate open task with the same title in that project (`NOT_ALLOWED`, returns the existing task) unless it's the same `opId`.
Output: `{ ok, task: { id, title, status, priority, due? }, projectId }`

### `update_task`
Input: `{ project: string, task: string, status?: 'todo' | 'doing' | 'done', title?, priority?, due?: date | null, effort?: string | null, notes?: string | null, request_id? }`
Effect: `updateTask` (sets/clears `completedAt`, logs completion) + an activity entry for other changes.
Output: `{ ok, task, changed: string[] }`

### `update_project`
Input: `{ project: string, next_action?: string, next_action_due?: date | null, blockers?: string, waiting_on?: string, phase?: string, milestone?: string, description?: string, append_notes?: string, complete_next_action?: boolean, request_id? }`
Not allowed (first release): `status`, `priority`, `deadline`, `category`, `name`, flags, links, related projects (decision D2).
Effect: `updateProject` / `completeNextAction`; `append_notes` appends a dated paragraph (never replaces notes). Logs every change.
Output: `{ ok, project: { id, name, nextAction, … }, changed: string[] }`

### `update_week_plan`
Input: `{ week_start?: Monday date, add_focus?: string[], remove_focus?: string[], notes?: string, append_notes?: string, add_blocks?: [{ title, project?, kind?: BlockKind (default 'focus'), hours: 0.25–12, day?: 0–6 }] (≤ 10), request_id? }`
Effect: `toggleFocus` (only when the state actually changes), `addBlock`. Blocks without `day` stay **unscheduled** (Compass never auto-schedules). Logs focus changes (existing) and block/notes changes (new entry, `kind: 'focus'`).
Not allowed: removing or moving existing blocks (no deletion in the first release).
Output: `{ ok, week: <get_week_plan output>, changed: string[] }`

### `create_milestone`
Input: `{ project: string, title: string, target_date?: date, description?: string (≤ 4,000), request_id? }`
Effect: `addMilestone` + activity entry "Added milestone: …" (`kind: 'milestone'`). No target date unless the user gave one; month-only (`2027-02`) allowed. Rejects a duplicate open milestone title (`NOT_ALLOWED`).
Output: `{ ok, projectId, milestone: { id, title, done, targetDate? } }`

### `complete_milestone`
Input: `{ project: string, milestone: string, done?: boolean (default true), request_id? }`
Effect: `updateMilestone` (sets/clears `completedAt`, logs completion); reopening logs "Reopened milestone: …". Already in the requested state → `INVALID_INPUT`.
Output: `{ ok, projectId, milestone: { id, title, done, targetDate?, completedAt? } }`
Note: "Mark the Starfall playtesting task complete" refers to the milestone *Physical playtesting round*; `update_task` reports that a milestone matches, and the agent uses this tool.
