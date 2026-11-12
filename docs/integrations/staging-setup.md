# Phase 4: staging setup checklist

Staging project: **compass-staging** (`<staging-ref>`). Production (`<production-ref>`) is not touched in this phase.

Staging app = your local dev server (`npm run dev:staging`, http://localhost:5173) pointed at staging. Supabase sends AI-approval requests to that local page, which works because it opens in your own browser.

## 1. Supabase dashboard (staging project) — you

| Where | Setting |
| --- | --- |
| Authentication → URL Configuration | **Site URL** `http://localhost:5173` · **Redirect URLs** add `http://localhost:5173/**` |
| Authentication → OAuth Server | **Enable** the OAuth 2.1 server · **Allow dynamic client registration** on · **Authorization Path** `/oauth/consent` |
| Project Settings → JWT Keys | Nothing to do — staging already signs with ES256 (verified) |

## 2. Terminal — you (these need your credentials)

```bash
npx supabase login
```

```bash
npx supabase db push --remote=<staging-ref>
```

The second command asks for the staging **database password** (the one you chose when creating the project). It applies the three migrations in `supabase/migrations/`.

## 3. Deploy the MCP function — Claude Code (after you've logged in)

```bash
npm run build:shared
npx supabase functions deploy compass-mcp --project-ref <staging-ref> --no-verify-jwt --use-api
```

Endpoint: `https://<staging-ref>.supabase.co/functions/v1/compass-mcp`

## 4. Staging app — you

1. Copy `.env.staging.example` to `.env.staging.local` and paste the staging **publishable** key (Project Settings → API Keys).
2. `npm run dev:staging`, open http://localhost:5173 → *Data & settings* → sign in to cloud sync with your email (this uploads your local test data to staging).
3. *AI assistants* → turn on AI access.

## 5. Connect Claude — you

Claude → *Settings → Connectors → Add custom connector* → name `Compass (staging)`, URL from step 3. Claude opens Supabase's sign-in, which sends you to `http://localhost:5173/oauth/consent` → **Approve** → back to Claude.

## 6. Acceptance scenarios

See [testing.md](testing.md#acceptance-criteria-phase-4-staging). Results get recorded in implementation-plan.md (Gate 4).

## Progress log

| Date | Step | Result |
| --- | --- | --- |
| 2026-11-11 | Dashboard settings, login, `db push` | Done by you |
| 2026-11-11 | OAuth server metadata | Live: DCR endpoint, PKCE S256, `offline_access` advertised (refresh tokens available) |
| 2026-11-11 | Function deploy (`--use-api`) | Deployed; runs in Edge Runtime |
| 2026-11-11 | Smoke test | Metadata 200 with staging issuer; unauthenticated → 401 + `resource_metadata` challenge; forged token → 401 `invalid_token` |
| 2026-11-11 | Tables & grants on real Supabase | All 4 tables exist; `anon` gets `42501` on every table and on `compass_mcp_read` |
| 2026-11-11 | Claude connected (OAuth: DCR → Supabase authorize → Compass consent → Claude) | Works |
| 2026-11-11 | Scenario: "everything I'm working on this week" | Correct portfolio summary from `list_projects`/`get_week_plan` |
| 2026-11-11 | Scenario: "Mark the Starfall playtesting task complete" | Claude recognised it as a milestone; `complete_milestone`; entry attributed "Claude" |
| 2026-11-11 | Scenario: "Log today's Starfall progress …" | One note on Starfall, attributed "Claude"; tasks correctly left open |
| 2026-11-11 | Scenario: "What projects haven't received attention recently?" | Correct answer: staging data was seeded today, so nothing is stale yet |
| 2026-11-11 | Scenario: "Move Lighthouse into this week's focus" (via connector) | Added once; week 2026-11-09 computed in Mountain time |
| 2026-11-11 | Duplicate request (same `request_id`) | Second call `duplicate: true`, nothing written |

### Manual checks (done by you, 2026-11-11) — all passed

- [x] Compass in your browser shows the Claude changes in *Activity* as "via Claude".
- [x] Turning **AI access off** → Claude's next request is refused; back on → works.
- [x] Still connected after the first hour (refresh token).
- [x] *Disconnect* in *AI assistants* → Claude must re-approve.

Observation: Claude noted that Compass's 12 h/week discretionary capacity doesn't match the 15–20 h you give the AI program. That's a setting you can change in *Data & settings* (agents can't change settings by design).
