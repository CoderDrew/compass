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

## Phase 2 — Secure Supabase data service

Prerequisites: Gate 1 approval; a **separate staging Supabase project** (free) so production is never touched.

1. Add Supabase CLI config (`supabase/config.toml`) and migrations directory; move `schema.sql` content into the first migration (no change to the live table).
2. Migration: `compass_backups`, `compass_mcp_ops`, `compass_ai_settings (user_id, ai_access_enabled default false, allowed_client_ids text[])`, RLS on all.
3. Migration: `compass_mcp_read(uid)`, `compass_mcp_commit(uid, expected_revision, data, op_id, tool, client_id, …)` — `SECURITY DEFINER`, CAS + backup (keep last 30) + op ledger + rate-limit check in one transaction; executable by `service_role` only.
4. Migration: tighten `compass_data` RLS to `client_id IS NULL` (browser sessions only). Verify the browser still syncs.
5. Decide D5 (shared-code packaging) with a `supabase functions serve` spike.
6. pgTAP or SQL-script tests against the **local** Supabase stack: CAS, conflict, backup pruning, rate limit, RLS denial for OAuth-style JWTs, no `anon` access.
7. Browser: "AI access" card in Data & settings (off by default; connected apps list with revoke via `getUserGrants`/`revokeGrant`). Small, existing design patterns.

**Gate 2:** review migrations and test results. Production database still untouched.

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
| Before Phase 2 | Create a second free Supabase project, e.g. **compass-staging** (free plan allows 2 active projects). Don't enable anything yet. |
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
