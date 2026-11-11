# Phase 4: staging setup checklist

Staging project: **compass-staging** (`nwadkhsvsdaodsmrbcfb`). Production (`hfyeacobsuxakoyvjwkm`) is not touched in this phase.

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
npx supabase db push --remote=nwadkhsvsdaodsmrbcfb
```

The second command asks for the staging **database password** (the one you chose when creating the project). It applies the three migrations in `supabase/migrations/`.

## 3. Deploy the MCP function — Claude Code (after you've logged in)

```bash
npm run build:shared
npx supabase functions deploy compass-mcp --project-ref nwadkhsvsdaodsmrbcfb --no-verify-jwt --use-api
```

Endpoint: `https://nwadkhsvsdaodsmrbcfb.supabase.co/functions/v1/compass-mcp`

## 4. Staging app — you

1. Copy `.env.staging.example` to `.env.staging.local` and paste the staging **publishable** key (Project Settings → API Keys).
2. `npm run dev:staging`, open http://localhost:5173 → *Data & settings* → sign in to cloud sync with your email (this uploads your local test data to staging).
3. *AI assistants* → turn on AI access.

## 5. Connect Claude — you

Claude → *Settings → Connectors → Add custom connector* → name `Compass (staging)`, URL from step 3. Claude opens Supabase's sign-in, which sends you to `http://localhost:5173/oauth/consent` → **Approve** → back to Claude.

## 6. Acceptance scenarios

See [testing.md](testing.md#acceptance-criteria-phase-4-staging). Results get recorded in implementation-plan.md (Gate 4).
