# Phase 5: production rollout runbook

Production project: `hfyeacobsuxakoyvjwkm` (Compass). Live site: https://coderdrew.github.io/compass/.
Checked 2026-11-11 (read-only): signing key already ES256; OAuth server off; `compass-mcp` not deployed; `main` unchanged.

Nothing here runs without your explicit approval. Steps marked **you** need your credentials.

| # | Who | Step | Undo |
| --- | --- | --- | --- |
| 0 | you + Claude Code | **URL check on staging:** set staging Site URL to `http://localhost:5173/compass`, Claude Code requests an authorization and reads where Supabase redirects, then you set it back to `http://localhost:5173`. Confirms Supabase keeps `/compass` in the approval address. | Set Site URL back |
| 1 | you | **Back up:** live site → *Data & settings → Export JSON*. Keep the file. | — |
| 2 | you | `npx supabase db push --remote=hfyeacobsuxakoyvjwkm` (production DB password). Adds the AI tables/functions; limits `compass_data` to direct app sessions. Existing data untouched (tested). | Migrations only add objects; the RLS change can be reverted with the old policies in `supabase/schema.sql` |
| 3 | you | Dashboard → *Authentication → OAuth Server*: enable, allow dynamic client registration, Authorization Path `/oauth/consent` (adjusted if step 0 says so). Site URL stays `https://coderdrew.github.io/compass/`. | Disable the OAuth server |
| 4 | Claude Code | `npm run build:shared && npx supabase functions deploy compass-mcp --remote=hfyeacobsuxakoyvjwkm --no-verify-jwt --use-api --yes`, then smoke-test (metadata, 401 challenge, forged token). | Delete the function in the dashboard |
| 5 | Claude Code | Open a pull request `feature/mcp-integration → main`; you review and merge. Merging redeploys the site with the approval page and *AI assistants* card. | Revert the merge commit |
| 6 | you | Live site → *Data & settings → AI assistants* → turn on. In Claude: remove *Compass (staging)*, add custom connector **Compass** → `https://hfyeacobsuxakoyvjwkm.supabase.co/functions/v1/compass-mcp` → approve. | *Disconnect* / turn AI access off |
| 7 | you | Optional hardening: turn off *Allow new users to sign up* on both projects. | Turn it back on |

After step 6: ask Claude one read and one small write, and confirm "via Claude" in Activity on the live site.

## Log

| Date | Step | Result |
| --- | --- | --- |
| 2026-11-11 | 0 · URL check (staging) | Site URL `http://localhost:5173` → `/oauth/consent`; `…/compass` → `/compass/oauth/consent`; `…/compass/` → `/compass/oauth/consent` (no double slash). Production needs Authorization Path `/oauth/consent` with the existing Site URL. Test client "compass-url-check" left on staging (harmless). |
| 2026-11-11 | 1 · Backup | Done by you |
| 2026-11-11 | 2 · Migrations (production) | Applied by you. Verified: all 4 tables exist; `anon` denied (`42501`) on every table and on `compass_mcp_read`. Staging Site URL reverted. |
