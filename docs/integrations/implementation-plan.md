# Compass AI integration: implementation plan

Branch: `feature/mcp-integration` (never merged to `main` automatically). Each phase ends at a **review gate**: nothing in the next phase starts without your explicit go-ahead.

## Phase 1 — Architecture and shared foundation ✅ (this branch)

| Task | Output |
| --- | --- |
| Audit repo, data model, auth/persistence/sync flows | [architecture.md §2](architecture.md) |
| Research ChatGPT, MCP auth, Supabase OAuth/Edge Functions | [architecture.md §3](architecture.md) |
| Design + threat model + tool contracts | architecture.md, security.md, mcp-tools.md, testing.md |
| Make shared domain code runtime-neutral (Node/browser/Deno) | Explicit `.ts` relative imports in shared modules; portability test |
| Backward-compatible activity attribution | `ActivityEntry.taskId/source/opId` (optional) + validation |
| Command layer (no I/O) | `src/lib/agent/`: reference resolution, input validation, read queries, write commands, invariants, attribution, idempotency, time-zone helpers |
| Commit procedure with injected I/O | `runCommand(store, …)`: load → validate → apply → verify → CAS commit → bounded rebase retries |
| Tests | Unit tests for all of the above; existing suite unchanged and passing |

**Gate 1 (now):** you review the documents and decide D1–D5 (see below).

## Phase 2 — Secure Supabase data service ✅ (this branch, not applied anywhere)

| Planned | Delivered |
| --- | --- |
| Migrations directory + baseline | `supabase/migrations/20261111000000_baseline.sql` (= `schema.sql`, idempotent) |
| Backups, op log, AI settings tables | `…000100_ai_access.sql`: `compass_ai_settings`, `compass_backups` (last 30), `compass_mcp_ops` (90 days), RLS on all, browser-session-only policies |
| Server-only SQL functions | `compass_mcp_authorize` (kill switch, approved client, 60 req/min, 20 writes/min), `compass_mcp_read`, `compass_mcp_commit` (CAS + backup in one transaction, 5 MB cap), `compass_mcp_log`. `SECURITY DEFINER`, `search_path=''`, executable by `service_role` only |
| Tighten `compass_data` RLS | `…000200_restrict_compass_data_to_direct_sessions.sql`: tokens with a `client_id` claim get nothing |
| D5 spike | **Decided: bundled file.** `npm run build:shared` → `supabase/functions/_shared/compass-agent.js` (self-contained ESM + `.d.ts`); a test fails if it's stale |
| Data service code | `src/lib/agent/service.ts`: `supabasePortfolioStore`, `handleToolCall` (authorize → runTool → log), no supabase-js dependency |
| SQL tests | `supabase/tests/database.test.ts` — **PGlite** (real Postgres in-process) with Supabase's roles, default grants and `auth.uid()/auth.jwt()` emulated. Replaces the planned local Supabase stack because Docker isn't running here; Phase 4 re-verifies on the real staging project |
| "AI access" card | `src/components/AiAccessCard.tsx` in Data & settings: kill switch, approved assistants + Disconnect (allowlist removal + `auth.oauth.revokeGrant`), "not set up" state, time zone |
| D4 time zone | `settings.timeZone` (optional, validated); recorded once from the device when sync is idle; server falls back to UTC |

Notes:
- supabase-js 2.119 names the grant APIs `auth.oauth.listGrants()` and `revokeGrant({ clientId })` (the docs page says `getUserGrants`); the code uses the library's names.
- Clients get onto `allowed_client_ids` only through the Compass consent page (Phase 3), when you approve them.

**Gate 2 (now):** review migrations, tests and the card. Production database still untouched.

## Phase 3 — MCP server

1. `supabase/functions/compass-mcp/index.ts`: `createMcpHandler`, `withOAuthProtectedResource`, JWT verification (JWKS, issuer, `client_id`, allowlist, kill switch), per-request op id, structured logging.
2. Register the 9 tools from [mcp-tools.md](mcp-tools.md) (zod schemas generated from / checked against the Phase 1 validators), plus D3 additions if approved.
3. OAuth consent page: `/oauth/consent` hand-off into the app (R5), approve/deny with `supabase.auth.oauth.*`.
4. Small "via ChatGPT" label on agent-attributed activity entries (existing Activity list).
5. Tests: tool handlers against an in-memory store; MCP Inspector smoke test locally.

**Gate 3:** demo against local stack + MCP Inspector.

## Phase 4 — Staging integration

1. Staging Supabase project: enable OAuth 2.1 server + DCR, asymmetric signing keys, Site URL/Authorization Path, deploy function, apply migrations.
2. Staging build of the app (e.g. GitHub Pages preview path or local) pointing at staging.
3. Connect ChatGPT (if plan allows, D1) or another MCP client to staging; run the acceptance scenarios in [testing.md](testing.md): auth, refresh after 1 h, revoke, reads, writes, concurrent browser edit, conflict exhaustion, rate limit, duplicate requests, invalid data.

**Gate 4:** you review results and approve production rollout.

## Phase 5 — Production

Only with explicit approval:
1. Export a JSON backup of production data (you), apply migrations to production, enable OAuth server + signing keys, deploy function.
2. Merge the branch, deploy the app.
3. Connect ChatGPT; verify live sync; document connect/revoke steps in README.

## Actions needed from you

| When | Action |
| --- | --- |
| Gate 1 | Answer D1–D5 (below). |
| Before Phase 4 | Create a second free Supabase project, **compass-staging** (free plan allows 2 active projects). Don't enable anything yet. |
| Before Phase 3 (optional) | Start Docker Desktop if you'd like me to run the Edge Function locally with the Supabase CLI. |
| Phase 4 | In staging: Authentication → OAuth Server → enable + allow dynamic registration; JWT signing keys → migrate to asymmetric; set Site URL/Authorization Path. I'll give exact steps. |
| Phase 5 | Same in production, after exporting a backup. |

## Decisions (recorded 2026-11-11)

| # | Question | Decision |
| --- | --- | --- |
| D1 | ChatGPT plan | **ChatGPT Plus.** OpenAI's help center lists custom MCP servers (and write actions) only for Business and Enterprise/Edu. See "Client strategy" below. |
| D2 | Status/priority/deadline changes in v1 tools? | **No** — tools cannot change them (enforced by schemas and invariants). |
| D3 | Milestone tools? | **Yes** — `create_milestone` and `complete_milestone` added to the command layer (Phase 1). |
| D4 | Time zone | **Mountain Time.** Phase 2: the browser records its IANA zone (e.g. `America/Edmonton`/`America/Denver`, or `America/Phoenix` if no daylight saving) once in `settings.timeZone`; the server uses it for "today" and "this week". |
| D5 | Shared-code packaging for Deno | Delegated; settled by the Phase 2 spike (bundled `_shared` file is the fallback). |

## Client strategy (ChatGPT Plus)

The MCP server is standard (Streamable HTTP + OAuth 2.1), so it doesn't depend on which client connects. With Plus, ChatGPT itself can't connect a custom server today. Options, none of which change Phases 2–3:

1. **Use another MCP client that supports remote servers with OAuth and write tools** for day-to-day use and for Phase 4 testing — for example Claude Code or another desktop/IDE agent. Verify the specific client's current plan requirements before relying on it.
2. **Move to ChatGPT Business** when you want ChatGPT specifically (check OpenAI's current pricing and seat minimums).
3. **Watch for OpenAI expanding custom MCP to Plus**; the server will work unchanged.

Recommendation: continue with Phases 2–3; test Phase 4 with an MCP client you already have; decide on ChatGPT Business only if you want ChatGPT as the daily interface.
