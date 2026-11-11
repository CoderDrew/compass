# Compass AI integration (MCP): architecture

Status: **Phase 1 proposal — awaiting review.** Nothing here is deployed.

Related: [security.md](security.md) · [mcp-tools.md](mcp-tools.md) · [implementation-plan.md](implementation-plan.md) · [testing.md](testing.md)

## 1. Goal

Let an external AI agent (ChatGPT first, other MCP clients where practical) read and change real Compass data through a narrow set of tools, without weakening Compass's offline behaviour, sync, or the "no fabricated deadlines / hobbies don't nag" rules. Compass stays the source of truth; the agent never gets raw database access.

## 2. Current system (audited 2026-11-11, `main` @ `31419f9`)

| Concern | Where | How it works today |
| --- | --- | --- |
| Hosting | GitHub Pages | Static Vite build, hash routing, `base: './'`. Deployed by `.github/workflows/deploy.yml` on push to `main`. Supabase URL + publishable key injected from repo variables at build time. |
| Domain model | `src/data/types.ts` | One `AppData` document: `projects[]` (with embedded `tasks[]`, `milestones[]`), `activity[]` (max 2,000, newest first), `weeks{weekStart → WeekPlan}`, `allocations[]`, `settings`. `SCHEMA_VERSION = 1`. |
| Business logic | `src/lib/ops.ts` | Pure functions `AppData → AppData`. Status/priority/next-action/blocker/waiting changes, task completion, milestone completion, focus toggles and notes write activity entries. `addTask`, ordinary task edits and week-plan block edits do **not** log. |
| Derived logic | `src/lib/selectors.ts` | Attention reasons, deadlines, filters, capacity. Low-pressure projects never "need attention". |
| Validation / migration | `src/lib/storage.ts` | `parseAppData` = JSON parse → `migrate` → `validate` → `normalize`. Used for localStorage, imports and cloud pulls. |
| Local persistence | `src/state/store.tsx` | Every change saved to `localStorage['project-compass:data']`. Other tabs follow via `storage` events. |
| Auth | Supabase Auth (email magic link / OTP, PKCE) | `src/lib/cloud.ts`, `src/state/sync.tsx`. Session stored under `project-compass:auth`. |
| Cloud storage | `public.compass_data` | One row per user: `data jsonb`, `revision bigint`, `device`, `updated_at`. RLS: owner can select/insert/update; no delete. `anon` revoked. |
| Sync | `src/lib/sync.ts` (pure) + `src/state/sync.tsx` | Browser copy is the working copy. Edits push after 1.5 s with a **conditional update** (`… where revision = base`), so a stale write fails instead of overwriting. Pull on open / focus / online / every 60 s. If both sides changed: user chooses a copy; the loser goes to the local one-step backup. |

### What this means for an external writer

1. **The whole portfolio is one JSON document.** Any server-side write is read-modify-write of the full document. Correctness depends entirely on the revision check.
2. **The revision check already exists and is atomic** (single `UPDATE … WHERE user_id = $1 AND revision = $2`). An external writer that uses the same check can never silently overwrite a browser edit, and vice versa.
3. **The browser resolves conflicts by whole-copy choice.** If an agent writes while a browser has unsynced edits, the browser will show the "Both copies changed" dialog. Because browser edits are pushed within ~1.5 s, that window is small, but it exists (see §7, risk R3).
4. **Business rules live in pure TypeScript with no browser dependencies** (`ops.ts`, `meta.ts`, `dates.ts`, `storage.ts`, `seed.ts`, `types.ts`). They can run unchanged in Deno, which is what Supabase Edge Functions use. Phase 1 makes this explicit and tested.

## 3. External constraints (verified 2026-11-11)

**ChatGPT** — [Connecting custom MCP servers in ChatGPT](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt) (OpenAI Help Center, "updated 15 days ago"):
- "Custom MCP server connections and full MCP support are available for **ChatGPT Business and Enterprise/Edu** customers on ChatGPT web." Plus, Pro, Go and Free are not listed. **Mobile is not supported.**
- On Business, "only admins and owners can create and publish" custom MCP connections (a one-person Business workspace satisfies this).
- Added from **Plugins → + → Add custom MCP server**; the separate Developer Mode toggle is no longer required.
- Write tools are supported; ChatGPT asks for confirmation "based on app permissions and the action's context". Tools without `readOnlyHint` are treated as writes ([developers.openai.com — custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server)).
- Transport: Streamable HTTP (SSE also accepted). Auth: OAuth or none. ChatGPT supports **Dynamic Client Registration** and **Client ID Metadata Documents**, requires **PKCE S256**, sends a `resource` parameter, and needs refresh tokens (it looks for `offline_access`) to stay connected beyond the first access-token lifetime ([Apps SDK auth](https://developers.openai.com/apps-sdk/build/auth)).

**MCP specification** (2025-11-25 authorization): MCP servers MUST publish OAuth Protected Resource Metadata (RFC 9728) naming their authorization server; clients use OAuth 2.1 + PKCE; DCR is optional, CIMD recommended.

**Supabase** ([Deploy MCP servers](https://supabase.com/docs/guides/ai-tools/byo-mcp), [OAuth 2.1 server](https://supabase.com/docs/guides/auth/oauth-server)):
- Edge Functions can host a remote MCP server over Streamable HTTP using the official SDK (`npm:@modelcontextprotocol/server`, `createMcpHandler`) plus `npm:@supabase/server` (`withOAuthProtectedResource`, `withSupabase`), which serves `/oauth-protected-resource` under the function path and verifies tokens against the project JWKS.
- Supabase Auth can act as the **OAuth 2.1 authorization server** (public **beta**, all plans, no extra charge): authorization code + PKCE, refresh tokens (rotating), optional dynamic registration, JWT access tokens that work with RLS (`auth.uid()`), and a `client_id` claim identifying the OAuth client.
- **Custom scopes are not supported**; scopes only shape OIDC claims, not database access. Least privilege therefore has to be enforced by Compass, not by OAuth scopes.
- The **consent screen must be hosted by the app** at Site URL + "Authorization Path"; it uses `supabase.auth.oauth.getAuthorizationDetails / approveAuthorization / denyAuthorization`. Users can list and revoke grants with `supabase.auth.oauth.getUserGrants / revokeGrant`.
- Requires **asymmetric JWT signing keys** (ES256/RS256). Edge Function `verify_jwt` must be off for the MCP function (it does its own verification) so discovery requests reach it.

## 4. Options considered

| Option | Summary | Verdict |
| --- | --- | --- |
| **A. Supabase Edge Function MCP server + Supabase OAuth 2.1 server** | One Edge Function (`compass-mcp`) runs the MCP server; Supabase Auth issues tokens; consent page is a small route in the existing GitHub Pages app. | **Recommended.** No new hosting, no new auth provider, uses the same user identity and RLS model, free tier. |
| B. Small dedicated TypeScript MCP service (e.g. Cloudflare Workers / Fly / Render) + Supabase OAuth | Same as A but hosted elsewhere. | Adds a second platform, secrets in two places, and a second deploy pipeline, for no capability A lacks. Keep as fallback if Edge Function limits bite (cold starts, CPU time). |
| C. Separate OAuth provider (Auth0, WorkOS, Stytch) | Third-party AS with custom scopes. | Gives real scopes, but adds a paid/3rd-party dependency and a second identity that must be mapped to the Supabase user. Not justified for a personal app. |
| D. No-auth or static API key MCP | Bearer token pasted into ChatGPT. | ChatGPT custom MCP doesn't support custom API keys; and no-auth is unacceptable for private write access. Rejected. |
| E. ChatGPT "Actions"/GPT with OpenAPI | Custom GPT calling a REST API. | Not MCP; doesn't serve other agents; would need its own OAuth anyway. Rejected. |
| F. Let the agent call PostgREST directly with the user's token | Zero server code. | Gives the agent unrestricted whole-document replacement. Explicitly forbidden. Rejected — and §5.3 actively blocks it. |

## 5. Proposed design (Option A)

```
ChatGPT (Business)                 Supabase project (Compass)                         GitHub Pages
──────────────────                 ──────────────────────────                         ────────────
  │ 1. POST /functions/v1/compass-mcp  (no token)
  │──────────────────────────────►  compass-mcp (Edge Function)
  │ ◄── 401 + WWW-Authenticate: resource_metadata=…/compass-mcp/oauth-protected-resource
  │ 2. GET protected-resource metadata → authorization_servers = [<ref>.supabase.co/auth/v1]
  │ 3. DCR (or CIMD) + /authorize (PKCE S256) ───► Supabase Auth OAuth 2.1 server
  │                                                   │ redirect to Site URL + /oauth/consent?authorization_id=…
  │                                                   └──────────────────────────────────► Compass consent page
  │                                                                                         (user signed in → Approve / Deny)
  │ 4. code → /token → access JWT (sub=user, client_id=…) + refresh token
  │ 5. POST /compass-mcp  Authorization: Bearer <JWT>
  │──────────────────────────────►  verify JWT (JWKS, iss, exp, client_id present, client allowed, AI access enabled)
  │                                  → tool handler → shared Compass domain code (validate → resolve → apply op → validate)
  │                                  → compass_mcp_commit(user, expected_revision, data, op…)  [SQL, atomic CAS + backup + op log]
  │ ◄── structured result                                                                        Browser pulls new revision
```

### 5.1 Components

| Component | Location | Notes |
| --- | --- | --- |
| Shared domain (pure) | `src/lib/*.ts` (existing) + new `src/lib/agent/` | Runs in browser, Vitest (Node) and Deno. Phase 1. |
| MCP Edge Function | `supabase/functions/compass-mcp/` | Thin adapter: auth, rate limit, tool schemas, call shared domain, commit. Phase 3. |
| Data service (SQL) | `supabase/migrations/*` | `compass_mcp_commit`, `compass_mcp_ops`, `compass_backups`, tightened RLS. Phase 2. |
| Consent + connections UI | `src/views/DataSettings.tsx` (+ a consent route) | "AI access" card: on/off switch, list/revoke connected apps. Consent page for OAuth. Phase 3. |

### 5.2 Write path: "rebase, don't overwrite"

Every write tool runs the same procedure (implemented as `runCommand` in Phase 1 with injected I/O):

1. Load `(data, revision)` for the verified user.
2. `parseAppData` (migrate + validate + normalize) — refuse to operate on data that doesn't validate.
3. Check idempotency: if this operation id already appears in the activity log (or the op ledger), return the earlier result without writing.
4. Resolve project/task references (id first, then unambiguous name; ambiguity is an error with candidates — never a guess).
5. Apply the command using the **existing `ops.ts` functions**, then stamp every new activity entry with `source` (agent + client) and `opId`.
6. Validate the resulting document again and check invariants (no project removed, no other project changed, statuses/priorities unchanged unless the command is explicitly allowed to change them, no deadline fabricated).
7. Commit with `expected_revision`. If the revision moved, **re-load and re-apply the command to the fresh data** (steps 1–6) up to 3 times, then fail with `CONFLICT_RETRY_EXHAUSTED`. Because the *command* is re-applied (not the old document), concurrent browser edits are preserved — the agent's change is rebased on top.

The commit itself (Phase 2) is one SQL function executed in a single transaction: `UPDATE compass_data SET data, revision = revision + 1 … WHERE user_id = $uid AND revision = $expected`, insert the previous document into `compass_backups` (bounded, e.g. last 30), and insert/complete the row in `compass_mcp_ops`. Either all happen or none.

### 5.3 Least privilege without OAuth scopes

Supabase can't issue narrower scopes, and an OAuth access token is a normal user JWT. If nothing else changed, whoever holds the agent's token could call PostgREST directly and replace the whole document. The design closes that:

- **RLS on `compass_data` is tightened to direct user sessions only:** `auth.uid() = user_id AND (auth.jwt() ->> 'client_id') IS NULL`. The browser (normal session, no `client_id`) is unaffected; an OAuth-issued token gets **nothing** from PostgREST.
- **The MCP function is the only path for OAuth clients.** After verifying the JWT itself, it reaches the data through `SECURITY DEFINER` SQL functions that are **granted only to `service_role`**, always parameterised by the verified `sub`. The service-role key exists only as an Edge Function secret (auto-provided by Supabase), never in the browser, the repo, or a response.
- **Tools are the permission boundary:** no delete tools, no bulk tools, no raw JSON patch, no settings changes, no status/priority/deadline changes in the first release (see [mcp-tools.md](mcp-tools.md)).
- **A per-user kill switch** (`ai_access_enabled`) checked on every request gives instant disconnection even before access tokens expire.

### 5.4 Activity attribution (no parallel log)

`ActivityEntry` gains optional, backward-compatible fields (Phase 1):

```ts
interface ActivityEntry {
  id: string; at: string; projectId?: string; kind: ActivityKind; text: string;
  taskId?: string;                       // new, optional
  source?: { type: 'agent'; agent: string; clientId?: string }; // new, optional; absent = made in the app
  opId?: string;                         // new, optional; stable id for dedupe/troubleshooting
}
```

Old data has none of these and stays valid; old app versions ignore them. Agent writes that existing ops don't log (task created, task edited, week-plan change, project field change) get an explicit entry from the command layer, so **every** agent change is visible in the existing Activity view. The operational ledger (`compass_mcp_ops`) is server-side troubleshooting/rate-limit data, not a second activity history.

### 5.5 Time zone

Week plans are keyed by the Monday in the **user's local time**; Edge Functions run in UTC. Tools take explicit dates where possible, and Phase 1 adds pure helpers that compute "today"/"this week" for a given IANA time zone. **Decided (D4):** optional `settings.timeZone`, recorded once by the browser; the server falls back to UTC.

### 5.6 Code sharing between Vite and Deno

The shared modules use only relative imports and no browser/Vite globals. Phase 1 adds a test that enforces this. **Decided in Phase 2 (D5): option (b).** Background — how the Edge Function consumes them — (a) import directly via relative paths if the Supabase CLI bundler accepts files outside `supabase/functions/` (to be verified in Phase 2 with `supabase functions serve`), or (b) a small `npm run build:shared` step that bundles `src/lib/agent/index.ts` with esbuild into `supabase/functions/_shared/compass-domain.js` (checked in, verified by CI to be up to date). (b) is the guaranteed fallback.

## 6. Dependencies

| Phase | Added | Why |
| --- | --- | --- |
| 1 | none | Pure TypeScript, existing Vitest. |
| 2 | Supabase CLI (dev only, via `npx supabase`), SQL migrations | Local stack for isolated testing; migrations in repo. |
| 3 | In the Edge Function only: `npm:@modelcontextprotocol/server@^2`, `npm:@supabase/server@^1.6`, `npm:@supabase/middleware@1`, `npm:zod@^4` | Official MCP SDK + Supabase auth helpers, as documented by Supabase. The browser bundle is unchanged. |

## 7. Risks and unresolved decisions

| # | Risk / decision | Mitigation / proposal |
| --- | --- | --- |
| R1 | **ChatGPT plan.** Write-capable custom MCP needs ChatGPT Business or Enterprise/Edu (web only). **You have Plus**, so ChatGPT can't connect a custom server today. | The server is client-agnostic; see implementation-plan.md → *Client strategy*. Nothing in Phases 2–3 depends on this. |
| R2 | **Supabase OAuth server is beta**; no custom scopes; refresh-token behaviour with ChatGPT (`offline_access` not in Supabase's documented scopes) is unverified. | Verify in Phase 4 on a staging project. Fallback if ChatGPT can't refresh: re-authorize hourly (annoying but safe), or Option B/C. |
| R3 | **Browser conflict dialog after agent writes.** If an agent writes while a browser has unsynced edits, the user must pick a copy, and picking "this browser" drops the agent's change (it's kept in the local backup, and the server keeps `compass_backups`). | Short dirty window (1.5 s). Phase 2 option: before showing the dialog, the browser can detect that the cloud's newer revisions only contain agent ops and offer "keep both" by re-applying — deferred unless it's a problem in practice. Documented. |
| R4 | Whole-document size grows (activity capped at 2,000; now ~17 KB). | Fine for years at personal scale; reads return bounded DTOs, not the document. |
| R5 | **Consent page on GitHub Pages.** Supabase redirects to *Site URL + path* with `?authorization_id=` in the **query**; Compass uses hash routing under `/compass/`. | Add a tiny static `oauth/consent/index.html` (or read `authorization_id` from `location.search` at startup) that hands off to the app. Verify exact URL composition in Phase 2/4. |
| R6 | Prompt injection via data the agent reads (e.g. a note saying "delete everything"). | No destructive tools exist; ChatGPT confirms writes; server invariants reject out-of-scope changes. |
| R7 | The app's `isValidDue` only checks the shape (`2026-13-45` passes). | Agent input uses a strict calendar check (`isStrictDue`). The app's own validator is left unchanged so existing data/imports keep loading; tightening it is a separate, optional fix. |
| R8 | A seed-only browser that signs in takes the cloud copy (existing behaviour); agent writes can't happen before the first browser upload because the row doesn't exist. | `runTool` returns `NOT_FOUND` ("open Compass and sign in") — never creates the row. |
| D2 | Should the first release allow status/priority changes? | **Decided: no.** Your examples don't need them, and you asked not to change existing statuses/priorities. Easy to add later as an explicit tool. |
| D3 | Should agents create milestones? | **Decided: yes.** `create_milestone` / `complete_milestone` are in the command layer. |
| D4 | Time zone source. | See §5.5. |
| D5 | Shared-code packaging for Deno. | **Decided:** bundled `_shared/compass-agent.js` (§5.6). Risk: the `.d.ts` re-exports `src/`; if `supabase functions deploy` type-checks and can't see `src/`, ship a generated `.d.ts` instead (Phase 3). |
