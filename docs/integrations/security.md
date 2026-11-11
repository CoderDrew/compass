# Compass AI integration: security

Status: **Phase 1 proposal.** Scope: a single-user personal app. Controls are sized for that, not for multi-tenant SaaS.

## 1. Assets

| Asset | Where | Impact if compromised |
| --- | --- | --- |
| Portfolio document (`compass_data.data`) | Supabase Postgres | Personal/client project details exposed or destroyed. |
| Supabase session tokens (browser) | Browser localStorage | Full access to own row (as today). |
| OAuth access/refresh tokens (agent) | Held by ChatGPT / other MCP client | Whatever the MCP tools allow, until revoked/expired. |
| `service_role` key | Edge Function secret only | Full database access. Must never leave the server. |
| Backups (`compass_backups`), op ledger (`compass_mcp_ops`) | Supabase Postgres | Same sensitivity as the document. |

## 2. Trust boundaries

1. **Browser ↔ Supabase** (unchanged): user session JWT, RLS on `compass_data`.
2. **AI client ↔ MCP Edge Function**: OAuth 2.1 bearer token over HTTPS. The AI client is *semi-trusted*: it acts for the user but can be steered by prompt injection.
3. **MCP Edge Function ↔ Postgres**: server-side only; narrow `SECURITY DEFINER` functions executed with the service role, always keyed by the verified user id.
4. **User ↔ consent page**: the user approves a specific OAuth client while signed in to Compass.

## 3. Authentication

- **Authorization server:** Supabase Auth OAuth 2.1 server (beta). Authorization-code flow with **PKCE S256**, rotating refresh tokens, JWT access tokens (default 1 h).
- **Client registration:** Dynamic Client Registration enabled so ChatGPT can register itself (CIMD is not documented for Supabase; DCR is). To prevent random clients from being useful, the consent page shows the client name and redirect URI, and the MCP server keeps an **allowlist of approved client IDs** (stored server-side, managed from the "AI access" card). Unknown `client_id` → 403 even with a valid token. Optionally, DCR can be switched off again after ChatGPT has registered.
- **Resource server (MCP function):** on every request it
  1. requires `Authorization: Bearer`; otherwise `401` with `WWW-Authenticate: Bearer resource_metadata="…/compass-mcp/oauth-protected-resource"` (RFC 9728, MCP 2025-11-25);
  2. verifies signature against the project **JWKS** (asymmetric ES256/RS256 keys required; legacy HS256 rejected), `iss` = project auth issuer, `exp`, `aud` = `authenticated`;
  3. requires a `client_id` claim (i.e. an OAuth-issued token, not a stolen browser session token) that is on the allowlist;
  4. requires the user's `ai_access_enabled` flag to be on.
- **Token passthrough is forbidden:** the function never forwards the client's token to other services.
- **Gateway JWT check off** (`verify_jwt = false`) for this function only, because discovery requests are unauthenticated; the function performs the checks above itself. All other functions (none today) keep the default.

## 4. Authorization (least privilege)

Supabase OAuth scopes (`openid email profile phone`) don't restrict database access, and custom scopes aren't supported. Least privilege is enforced in three layers:

1. **Database:** `compass_data` RLS changes from `auth.uid() = user_id` to `auth.uid() = user_id AND auth.jwt() ->> 'client_id' IS NULL` for select/insert/update. OAuth tokens therefore cannot read or write the table through PostgREST at all. New tables (`compass_backups`, `compass_mcp_ops`, `compass_ai_settings`) have RLS on; browser sessions may read their own rows; nothing is writable by `anon`/`authenticated` except `compass_ai_settings` (own row, browser sessions only).
2. **Server functions:** `compass_mcp_read(uid)` and `compass_mcp_commit(uid, expected_revision, data, op…)` are `SECURITY DEFINER`, `SET search_path = ''`, `REVOKE ALL … FROM public, anon, authenticated`, `GRANT EXECUTE … TO service_role`. Only the Edge Function can call them, and it passes only the verified `sub`.
3. **Tools:** a fixed list (see [mcp-tools.md](mcp-tools.md)). No deletion, no bulk operations, no settings, no raw document/patch access, no SQL. Each tool validates input against a closed schema (unknown fields rejected, string lengths bounded) and the result is checked against **invariants** before commit:
   - no project, task, milestone, week plan or activity entry is removed;
   - only the target project/task/week is changed;
   - `status`, `priority`, `deadline` unchanged (first release);
   - the result passes `validate()`;
   - activity entries added by the command are all attributed (`source`, `opId`).

The browser keeps full control (it uses the normal session path).

## 5. Revocation and disconnection

| Mechanism | Effect | Speed |
| --- | --- | --- |
| "AI access" switch off in Data & settings (`ai_access_enabled = false`) | Every MCP request rejected with 403 | Immediate |
| Remove a client from the allowlist | That client rejected | Immediate |
| `supabase.auth.oauth.revokeGrant(clientId)` from the "Connected apps" list | Deletes that client's refresh tokens; no new access tokens | Access token remains valid ≤ 1 h — covered by the two checks above |
| Disconnect inside ChatGPT (Plugins) | ChatGPT forgets tokens | Immediate on ChatGPT's side |
| Rotate JWT signing key (Supabase dashboard) | All tokens everywhere invalid | Emergency only; signs out browsers too |

## 6. Input / output validation

- Inputs: closed schemas, bounded lengths (titles ≤ 200, text ≤ 4,000), enums for statuses/kinds, `YYYY-MM-DD` / `YYYY-MM` dates validated with the app's own `isValidDue`, week starts must be Mondays. References resolve by id first; name lookups never guess (ambiguity → error with candidates).
- The stored document is re-validated with `parseAppData` on read; tools refuse to run on invalid data rather than "repairing" it.
- Outputs: bounded DTOs (e.g. max 50 projects, max 200 activity entries, notes truncated) rather than the raw document; no tokens, ids of other users, or internal errors/stack traces in responses. Errors use stable codes (see mcp-tools.md).

## 7. Rate limiting and logging

- **Rate limit** (server-side, per user): e.g. 60 requests/min and 20 writes/min, counted from `compass_mcp_ops` inside the commit/read functions; over limit → `RATE_LIMITED` with retry hint. Supabase's platform limits apply on top.
- **Operational log** (`compass_mcp_ops`): op id, user id, client id, tool, args hash, outcome, error code, revision before/after, duration, timestamp. **No document content and no tokens.** Retained 90 days (scheduled cleanup or manual). Edge Function logs carry the op id only.
- **Activity log:** user-visible attribution in the existing Activity view (see architecture §5.4).

## 8. Threat model (STRIDE-lite)

| Threat | Example | Controls |
| --- | --- | --- |
| Spoofing | Someone registers their own OAuth client via DCR and phishes a consent | Consent page shows client name + redirect URI; client allowlist; sign-ups disabled on the project; `ai_access_enabled` off by default |
| Spoofing | Stolen browser session token used against MCP | `client_id` claim required |
| Tampering | Leaked OAuth token used to overwrite the whole document via PostgREST | RLS denies OAuth tokens on `compass_data`; writes only via tool-shaped commands |
| Tampering | Prompt-injected agent tries mass changes | No bulk/delete tools; invariants; ChatGPT write confirmations; rate limit; backups |
| Repudiation | "Who changed this?" | Activity entries carry `source` + `opId`; op ledger |
| Information disclosure | Agent reads more than needed | Bounded DTOs; no settings/backups exposed; only the user's own row reachable |
| Information disclosure | Service-role key leak | Lives only in Edge Function secrets; never logged or returned; not in repo/CI |
| Denial of service | Runaway agent loop | Per-user rate limit; bounded retries; idempotency |
| Elevation of privilege | Agent changes statuses/deadlines it shouldn't | Field allowlists per tool + invariant checks |
| Data loss | Concurrent write overwrites newer data | Atomic revision CAS; rebase-and-retry; `compass_backups` before every agent write |

## 9. Credential handling rules

- Never commit `.env.local`, service keys, tokens, or OAuth client secrets. `.gitignore` already excludes `*.local`.
- The browser build only ever receives the **publishable** key (already public by design).
- The service-role key is read inside the Edge Function from `Deno.env` (provided automatically by Supabase); it is never set as a GitHub variable.
- Staging and production are separate Supabase projects; tests never point at production.
- Phase 4 tests use throwaway test users on the staging project.

## 10. Residual risks accepted for a personal app

- Supabase OAuth server is beta.
- Access tokens can't be revoked individually; mitigated by server-side checks.
- ChatGPT itself (and OpenAI's handling of tool results) is outside our control; only data the tools return leaves Supabase.
