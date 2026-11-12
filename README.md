# Compass

A personal project-portfolio dashboard with a secure MCP server, so an AI assistant such as Claude can read and update the portfolio without ever getting raw database access.

Compass answers one question: *what should I work on this week?* It tracks projects, tasks, milestones, a weekly plan and an activity log, and it keeps hard rules: priority is not urgency, deadlines are never invented, and hobbies never nag.

The repository ships with **fictional demo data** (`src/data/seed.ts`). Your real data lives in your browser and, with sync on, in your own Supabase project. It never goes into the repo.

## Architecture

```
Browser (React SPA on GitHub Pages)
  │  localStorage working copy, works offline
  │  Supabase Auth session (email magic link, PKCE)
  ▼
Supabase Postgres ── compass_data (one JSON document per user, revision-checked)
  ▲                  compass_backups, compass_mcp_ops, compass_ai_settings
  │  SECURITY DEFINER functions, executable by service_role only
  │
compass-mcp Edge Function (Deno, MCP over Streamable HTTP)
  ▲  OAuth 2.1 bearer token (Supabase Auth OAuth server)
  │
Claude (custom connector)
```

| Part | Where | What it does |
| --- | --- | --- |
| **Frontend** | `src/` | React + TypeScript + Vite + Tailwind. Static build on GitHub Pages with hash routing. Views: Today, Portfolio, Project, Plan week, Weekly review, Activity, Data & settings, plus the OAuth consent screen. |
| **Domain logic** | `src/lib/ops.ts`, `selectors.ts`, `storage.ts` | Pure functions over one `AppData` document: changes, activity logging, attention rules, validation and schema migration. No browser dependencies, so the same code runs in Deno. |
| **Agent layer** | `src/lib/agent/` | Tool schemas, name resolution, invariants and a conflict-safe `runTool`. Bundled into `supabase/functions/_shared/compass-agent.js` by `npm run build:shared`. A test fails if the bundle is stale. |
| **Sync** | `src/lib/sync.ts`, `src/state/sync.tsx` | The browser copy is the working copy. Edits are pushed with a conditional update (`where revision = base`), so a stale write fails instead of overwriting. If both sides changed, you choose which copy to keep. |
| **Database** | `supabase/migrations/` | Tables, row-level security and the server-only functions `compass_mcp_authorize`, `compass_mcp_read`, `compass_mcp_commit` and `compass_mcp_log`. |
| **MCP server** | `supabase/functions/compass-mcp/` | Supabase Edge Function that verifies the caller, runs one tool, and commits through the server-only functions. |

### MCP tools (11)

| Read | Write |
| --- | --- |
| `list_projects` — filter by text, category, status, focus, stale | `add_activity` — log progress, a note or a decision |
| `get_project` — one project with tasks and milestones | `create_task` |
| `get_activity` — activity log by project and date range | `update_task` — rename, reprioritise, finish or reopen |
| `get_week_plan` — focus, blocks and capacity for a week | `update_project` — next action, blockers, waiting-on, notes |
| | `update_week_plan` — change focus projects, add time blocks and notes |
| | `create_milestone` |
| | `complete_milestone` |

Full contracts: [docs/integrations/mcp-tools.md](docs/integrations/mcp-tools.md).

## How agent access is secured

The agent is treated as semi-trusted: it acts for you but can be steered by prompt injection. Details: [docs/integrations/security.md](docs/integrations/security.md).

- **OAuth 2.1 with PKCE.** Supabase Auth is the authorization server. Claude registers through dynamic client registration and you approve it on Compass's own consent page while signed in.
- **Token checks on every call.** The function verifies the JWT against the project's JWKS (asymmetric keys only), checks issuer, expiry and audience, and requires a `client_id` claim that is on your approved-client allowlist. A browser session token is rejected.
- **A kill switch.** AI access is off until you turn it on in *Data & settings → AI assistants*. Disconnecting a client takes effect immediately.
- **No direct table access for agents.** Row-level security on `compass_data` refuses any token that carries a `client_id`, so an OAuth token cannot use the REST API. Agents reach data only through `SECURITY DEFINER` functions granted to `service_role`, always keyed by the verified user id.
- **The service-role key stays on the server.** It exists only as an Edge Function secret supplied by Supabase. It is never in the browser, the repo, or a response.
- **Narrow tools.** No deletion, no bulk operations, no settings, no raw SQL or document access. Inputs are validated against closed schemas, and tools cannot change status, priority or deadlines.
- **Invariants before every commit.** A write may change only the targeted project and must not remove tasks, milestones or history.
- **Safe writes.** Each commit is a revision check plus backup (last 30 kept) plus op-ledger entry in one transaction. A `request_id` makes retries idempotent. Limits: 60 requests and 20 writes per minute, 5 MB document cap.
- **Attribution.** Every agent change appears in Activity as "via Claude".

## Run it locally

Requires Node 18+ (CI uses Node 22).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit, database (PGlite) and MCP tests
npm run build      # typecheck + production build into dist/
```

The app works offline in one browser with no backend. For cloud sync, copy `.env.example` to `.env.local` and fill in your Supabase URL and publishable key.

## Set up cloud sync (Supabase)

1. Create a Supabase project.
2. Apply the database: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
3. *Authentication → URL Configuration*: set **Site URL** to where the app is hosted, and add `http://localhost:5173/` as a redirect URL.
4. Copy the **Project URL** and the **publishable (anon)** key into `.env.local`, or into GitHub *Settings → Secrets and variables → Actions → Variables* as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Never use the service-role key in the app.
5. Sign in from *Data & settings → Cloud sync*. Then turn off *Allow new users to sign up* so nobody else can create an account.

## Connect Claude (MCP)

Try this on a staging project first: [docs/integrations/staging-setup.md](docs/integrations/staging-setup.md).

1. *Authentication → OAuth Server*: enable it, allow dynamic client registration, and set **Authorization Path** to `/oauth/consent`. Use an asymmetric JWT signing key (ES256 or RS256).
2. Deploy the function: `npm run build:shared && npx supabase functions deploy compass-mcp --no-verify-jwt`. The function does its own token checks, so the gateway check is off for this function only.
3. In Compass, turn on *Data & settings → AI assistants*.
4. In Claude, add a custom connector with the URL `https://<ref>.supabase.co/functions/v1/compass-mcp` and approve it when Compass asks.

## Deploy the frontend

`.github/workflows/deploy.yml` installs, tests, builds and publishes `dist/` to GitHub Pages on every push to `main`. In the repo, set *Settings → Pages → Source* to **GitHub Actions**. The app uses hash routing and a relative base, so it works under any repository name.

## Docs

- [docs/DECISIONS.md](docs/DECISIONS.md): key design decisions, including the planned weekly-review agent
- [docs/integrations/](docs/integrations/architecture.md): MCP architecture, security, tool contracts, testing and rollout notes

## Limitations

- Single user. Sync keeps whole copies in step and does not merge simultaneous edits.
- The MCP server depends on Supabase's OAuth 2.1 server, which is in beta.
- The activity log keeps the most recent 2,000 entries.
