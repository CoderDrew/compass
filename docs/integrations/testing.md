# Compass AI integration: testing strategy

## Principles

- Business rules are tested once, in the shared pure modules, with Vitest. Servers are thin adapters tested for wiring, auth and error mapping.
- No test ever touches the production Supabase project. Database tests run against the **local Supabase stack** (Phase 2) or the **staging project** (Phase 4) with throwaway users.
- Every tool has: a happy-path test, a validation-failure test, a not-found/ambiguous test, and an idempotency test (writes).

## Layers

| Layer | Tooling | Phase | What it proves |
| --- | --- | --- | --- |
| Domain / command layer | Vitest (`src/lib/agent/*.test.ts`) | 1 | Resolution, validation, read DTOs, write effects, invariants, attribution, idempotency, time zones |
| Commit procedure | Vitest with in-memory store that injects conflicts | 1 | CAS, rebase-and-retry preserves concurrent edits, bounded retries, no write on failure |
| Portability | Vitest import scan | 1 | Shared modules import only relative `.ts` files; no `window`, `localStorage`, `import.meta.env`, React |
| Existing app | Vitest (existing 31 tests) + `tsc` + `vite build` + browser smoke | every phase | Nothing regresses; offline + sync unchanged |
| SQL functions & RLS | Vitest + PGlite with Supabase roles/JWT emulated (`supabase/tests/database.test.ts`); re-checked on staging in Phase 4 | 2 | CAS atomicity, backups, op ledger, rate limit, OAuth tokens denied on `compass_data`, `anon` denied, functions not callable by `authenticated` |
| MCP adapter | Vitest: real MCP client ↔ handler ↔ PGlite (`supabase/tests/mcp.test.ts`); Edge Runtime itself in Phase 4 | 3 | 401 + resource metadata, JWT checks, kill switch, allowlist, tool schemas, error mapping |
| End-to-end | ChatGPT (or other MCP client) on staging | 4 | Acceptance scenarios below |

## Phase 1 test inventory

`src/lib/agent/agent.test.ts` and `src/lib/agent/run.test.ts` cover:

- **Resolution:** by id; case-insensitive name; punctuation-insensitive; prefix/contains; ambiguity returns candidates; not-found returns suggestions; task resolution scoped to project.
- **Validation:** unknown fields rejected; required fields; length limits; enum values; due-date format; week start must be Monday; empty updates rejected.
- **Reads:** `list_projects` filters (status, focus, stale days, needs-attention, query), archived hidden by default, low-pressure never in needs-attention; `get_project` bounded; `get_activity` date/project/kind filters, newest first; `get_week_plan` defaults to the user's week in a given time zone.
- **Writes:** each tool's effect, generated activity entries carry `source` + `opId` (+ `taskId`), existing completion logging reused (`completedAt` set/cleared), `append_notes` never replaces, focus toggles only when state changes, blocks without day stay unscheduled.
- **Invariants:** command cannot remove entities, change other projects, or change status/priority/deadline; violations → `NOT_ALLOWED`.
- **Idempotency:** same `opId` twice → second is `duplicate: true` and the document is unchanged; duplicate open-task title rejected.
- **Commit procedure:** success path; one conflict then success with the concurrent edit preserved; repeated conflicts → `CONFLICT_RETRY_EXHAUSTED` with no partial write; invalid stored data → `DATA_INVALID`; duplicate detected after a rebase.
- **Activity schema:** old entries without new fields still validate; malformed `source`/`opId` rejected.

## Phase 2 test inventory

`supabase/tests/database.test.ts` (17) and `supabase/tests/shared-bundle.test.ts` (3):
- Migrations apply on a fresh project, re-run safely, and leave existing `compass_data` rows untouched.
- RLS: browser sessions keep access to their own row only; tokens with `client_id` can't read/update/insert `compass_data`; `anon` gets nothing; AI settings only editable by the owner's browser session; backups/op log read-only.
- Grants: `compass_mcp_*` functions not executable by `authenticated` (browser or OAuth) — only `service_role`.
- `compass_mcp_commit`: atomic CAS, conflict on stale revision, backup of the previous document, 30-backup pruning, rejects non-object documents.
- `compass_mcp_authorize`: off by default, approved client required, 60/min and 20 writes/min limits, old entries expire.
- `handleToolCall` end to end: refusal is logged; attributed write visible to the browser; duplicate detection; rebase over a browser save mid-request; time zone from settings; user isolation.
- Shared bundle is current, self-contained and runs as a module.
- Mutation check performed: removing the RLS-tightening migration makes the OAuth test fail.

## Acceptance criteria (Phase 4, staging)

1. Claude (custom connector) connects via OAuth with PKCE; consent page shows the client; deny works.
2. Still connected after the first access token expires (refresh works) — or the limitation is documented.
3. Each example request from the brief produces the right change, visible in Compass's Activity view with "via Claude" attribution:
   - "Log today's Starfall progress: …" → one note on Starfall.
   - "Show me everything I'm working on this week." → week plan + focus projects.
   - "Mark the Starfall playtesting task complete." → task done, completion logged; ambiguity → asks.
   - "Add a new milestone to Tablebook." → (if D3) milestone with no invented date.
   - "What projects haven't received attention recently?" → stale list, hobbies not nagged.
   - "Move Lighthouse into this week's focus." → focus added once.
   - "Update my AI career development project with today's progress." → note/next action.
4. Browser open with unsynced edits while the agent writes → no silent loss: either agent rebases (server) or the browser asks (client), and the losing copy is recoverable.
5. Repeating the same request (same `request_id`) changes nothing the second time.
6. Turning off "AI access" makes the next request fail with `FORBIDDEN`; revoking the grant prevents refresh.
7. A token from the agent cannot read or write `compass_data` through PostgREST directly.
8. Rate limit triggers on a scripted burst; no partial writes.
9. Existing app: offline edit → reconnect → sync still works; import/export unchanged.

## Commands

```bash
npm test            # all unit tests
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + production build
```
