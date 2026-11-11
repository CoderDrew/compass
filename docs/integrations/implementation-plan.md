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

## Phase 3 — MCP server ✅ (this branch, not deployed)

| Planned | Delivered |
| --- | --- |
| Edge Function | `supabase/functions/compass-mcp/`: `index.ts` (Deno entry), `handler.ts` (routing, RFC 9728 metadata at `/.well-known/oauth-protected-resource` and `/oauth-protected-resource`, 401 `WWW-Authenticate: Bearer resource_metadata=…`, JWKS verification of issuer/audience/expiry/algorithm, `client_id` required, CORS), `server.ts` (official MCP SDK `@modelcontextprotocol/server` 2.4.0, `createMcpHandler`, Streamable HTTP, stateless legacy fallback), `deno.json` import map; `supabase/config.toml` sets `verify_jwt = false` for this function only |
| Tools | 11 tools from `src/lib/agent/mcp.ts` (schemas from the command layer, annotations: reads `readOnlyHint`, nothing destructive, closed world), server instructions (ask on ambiguity, never invent dates, milestones vs tasks, request_id) |
| Attribution | Approved client display name stored with the approval (`client_names`) and returned by `compass_mcp_authorize`; entries show "via Claude" in Activity |
| Consent page | `public/oauth/consent/index.html` forwarder → `#/oauth/consent` (`src/views/OAuthConsent.tsx`); survives the sign-in email round trip; warns on unknown return hosts and blocks non-HTTPS ones; approving adds the client to the allowlist and calls `approveAuthorization` |
| Tests | `supabase/tests/mcp.test.ts`: a real MCP client over Streamable HTTP → handler → server → command layer → SQL in PGlite (metadata, challenge, forged/expired/wrong-issuer/browser tokens, tool listing + annotations, reads/writes/duplicates, structured errors, kill switch, unapproved client). `src/lib/aiAccess.test.ts` for consent rules. Consent flow and label checked in the browser against a local stand-in, and the forwarder against the production build served under `/compass/` |

Not verified yet (needs Deno/Docker or the staging project): the function running in the Supabase Edge Runtime (import map, `@ts-self-types` resolution during deploy), Supabase's real OAuth server (DCR with Claude, consent redirect URL composition, refresh tokens).

**Gate 3 (now):** review. Next is Phase 4 on **compass-staging**.

## Phase 4 — Staging integration ✅ (compass-staging, 2026-11-11)

All acceptance checks passed with **Claude** (Claude Duet) as the client: OAuth connect + consent, reads, milestone completion, attributed notes, week focus, duplicate suppression, kill switch, refresh after one hour, disconnect. Details: [staging-setup.md](staging-setup.md).

**Gate 4 (now):** approve production rollout.

### Original plan

1. Staging Supabase project: apply migrations, enable OAuth 2.1 server + dynamic registration, asymmetric signing keys, Site URL + Authorization Path `/oauth/consent`, deploy the function (see README → *Connect an AI assistant*).
2. Staging build of the app (local `npm run dev` with staging `.env.local`) to sign in and approve.
3. Connect **Claude** (custom connector) — and optionally Meta Muse — to staging; run the acceptance scenarios in [testing.md](testing.md): auth, refresh after 1 h, revoke, reads, writes, concurrent browser edit, conflict exhaustion, rate limit, duplicate requests, invalid data.

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

## Client strategy

**Updated 2026-11-11: primary client is Claude; Meta Muse is a possible second.** ChatGPT Plus can't connect custom MCP servers, so ChatGPT is deferred.

| Client | Custom remote MCP | Auth fit | Status |
| --- | --- | --- | --- |
| **Claude** (custom connectors) | Yes — add the server URL as a custom connector; reported available on Free (1 connector), Pro, Max, Team, Enterprise ([Claude docs](https://claude.com/docs/connectors/custom/remote-mcp), [support](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)) | OAuth with dynamic client registration, or a pre-registered client id/secret under *Advanced settings*. Callback `https://claude.ai/api/mcp/auth_callback`, client name "Claude" | **Primary.** Fits the design unchanged |
| Meta Muse | Reported (custom connectors over streamable HTTP), but third-party sources disagree on OAuth; examples use API keys in headers ([guide](https://anythingmcp.com/guides/clients/muse)) | Uncertain — if Muse only supports header keys, it would need a separate, personal-access-token path (weaker; not planned) | Secondary; verify against Meta's own docs in Phase 4 |
| ChatGPT | Business/Enterprise/Edu only | OAuth | Deferred (Plus) |

Phase 3/4 adjustments for Claude: attribution label from the OAuth client name ("Claude"); consent page shows the client name and redirect URI; optionally restrict approvals to the Claude callback URL. "Claude Duet" was not found in public docs — assumed to use the same custom-connector mechanism; confirm in Phase 4.
