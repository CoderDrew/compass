# Project Compass

A calm, personal command center for everything you're carrying — employment, Mindjax client work, software products, tabletop and creative projects, career development, and personal commitments.

**Its job is to help you decide what to work on, not to become another project.**

React + TypeScript + Vite + Tailwind, Lucide icons, Recharts for one chart. Hosted as a static site on GitHub Pages, with optional cloud sync through a free Supabase project so the same portfolio is available on all your devices.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (persistence, import/export, operations, selectors)
npm run build      # typecheck + production build into dist/
```

Requires Node 18+ (CI uses Node 22). For cloud sync locally, copy `.env.example` to `.env.local` and fill in your Supabase values.

## What's in v1

| View | What it answers |
| --- | --- |
| **Today** (dashboard) | What's due today, this week's focus, upcoming deadlines, what you're waiting on, what needs a look, and what you can safely ignore. Health counts are clickable filters. |
| **Portfolio** | The whole portfolio at a glance — by category (default), by status, or as a list. Waiting projects have a dashed amber edge; paused ones recede; critical ones get a red edge. Progress bars only appear where milestones or tasks make progress measurable. |
| **Project** | Click any project. Everything is click-to-edit. Next action is the most prominent field, with a one-click **Done**. Tasks, milestones, notes, links, related projects, and the project's activity log. |
| **Plan week** | Weekly capacity budget, focus projects, suggested allocations (added as *unscheduled* blocks — nothing is auto-scheduled), and a Mon–Sun board. Drag blocks onto days or use the day menu. |
| **Weekly review** | A 7-step, ~15-minute guided review. Every step can be skipped. Saving records the review in the activity log. |
| **Activity** | What changed in any given week — status changes, completed tasks and milestones, next-action updates, notes, and decisions. |
| **Data & settings** | Cloud sync sign-in and status, export/import JSON, automatic one-step backup, restore seed data, theme, capacity. |

Filters (search, category, status, priority, deadline, this week's focus, waiting, needs attention) are shared between the dashboard and the portfolio.

### Design rules baked in

- **Priority ≠ urgency.** Priority is a property of the project; urgency comes only from real dates.
- **No fabricated deadlines.** Genghis 2027 is stored as *February 2027* (month precision) because no day was given. Month-only dates are never shown as overdue mid-month.
- **Hobbies never nag.** Projects marked *Low pressure* (Drumming, Shadowdark monthly, Suno) never appear as overdue or "needs attention".
- **Ongoing commitments** (Antech, Mindjax, job search, recurring hobbies) never show a % complete.
- **Active ≠ this week.** Focus is chosen deliberately per week; Active projects aren't automatically obligations.
- Antech's 40 protected hours are shown separately and never counted against discretionary capacity.

## Your data, backups, and devices — read this

Every browser keeps a **working copy** in `localStorage`, so the app is fast and works offline.

**With cloud sync on** (signed in on *Data & settings*):

- Changes are saved to your Supabase database a moment after you make them. Other devices pick them up when the app opens, when you switch back to it, and every minute while it's on screen.
- Offline edits are kept locally and sent when you reconnect.
- If two devices both changed before syncing, the app **asks which copy to keep** — it never silently overwrites, and it doesn't merge. The copy you don't pick is saved as that browser's automatic backup.
- A brand-new browser that only has the starter data simply takes the cloud copy.
- Import, restore backup, and restore seed data all sync to your other devices.

**Without cloud sync** (not configured, or signed out), data stays in that one browser and clearing site data erases it.

Either way:

- **Back up:** *Data & settings → Export JSON* (a good habit at the end of each weekly review). Supabase's free tier has no point-in-time restore.
- **Imports are validated** before anything changes, and the current data is kept as a one-step automatic backup (*Restore automatic backup*).
- **Deleting** a project/task/milestone shows an **Undo** toast for a few seconds.
- If stored data ever can't be read, the original is preserved under a `project-compass:data:corrupt:*` key instead of being overwritten.
- Deploying a new version **does not** touch your data. The data has a `schemaVersion`; older data is migrated on load (see `MIGRATIONS` in `src/lib/storage.ts`).

## Cloud sync setup (Supabase, free tier)

One-time, about 10 minutes.

1. **Create a project** at [supabase.com](https://supabase.com) (free plan).
2. **Create the table:** *SQL Editor → New query*, paste [`supabase/schema.sql`](supabase/schema.sql), *Run*. It creates one `compass_data` table with row-level security so only you can read or write your row.
3. **Configure sign-in** — *Authentication*:
   - *Sign In / Providers → Email*: enabled (default).
   - *URL Configuration*: **Site URL** `https://<user>.github.io/<repo>/`; add `http://localhost:5173/` under **Redirect URLs** for local use.
   - Email templates can stay as they are. You sign in by opening the emailed link **in the same browser** you requested it from (on a phone, if your mail app opens links in its own built-in browser, use "Open in Safari/Chrome").
   - Optional: with custom SMTP configured (*Authentication → Emails → SMTP Settings*), you can add `<p>Your code: {{ .Token }}</p>` to the *Magic Link* template; the app also accepts that code, which works even when the link would open in a different browser.
4. **Copy the keys** — *Project Settings → API* (or *Connect*): the **Project URL** and the **anon / publishable** key. This key is meant to be public; row-level security is what protects your data. Never use the `service_role` / secret key in this app.
5. **Give them to the build:**
   - GitHub: *Settings → Secrets and variables → Actions → Variables* → add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then re-run the deploy workflow.
   - Local: copy `.env.example` to `.env.local` and fill in the same values, then restart `npm run dev`.
6. **Sign in:** open the app → *Data & settings → Cloud sync* → enter your email → open the emailed link in the same browser. Do this on your main device first (it uploads your data), then on each other device.
7. **Optional, recommended:** once you've signed in, turn off *Authentication → Sign In / Providers → Allow new users to sign up*, so nobody else can create an account on your project.

Notes:

- Supabase's built-in email sender is rate-limited (a few emails per hour). You stay signed in on each device, so you rarely need a new code.
- Free projects are **paused after about a week with no activity**; resume it from the Supabase dashboard. Your browser copies keep working meanwhile.

## Deploying to GitHub Pages

The app uses hash routing and a relative base (`base: './'`), so it works under any repository name without extra config.

1. Create a GitHub repository and push this project to the `main` branch.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main` (or run the workflow manually). `.github/workflows/deploy.yml` installs, runs tests, builds, and publishes `dist/`.
4. The site appears at `https://<user>.github.io/<repo>/`.

Note: a public repository makes the **code and seed dataset** (`src/data/seed.ts`) public, including project names. Your edits made in the app are not in the repo — they live in your browser and, with sync on, in your private Supabase table. If you'd rather not publish the seed details, use a private repo (GitHub Pages on private repos requires a paid plan) or trim `seed.ts` before pushing.

Manual alternative: `npm run build` and serve `dist/` from any static host.

## Project structure

```
src/
  data/        types.ts (schema), meta.ts (labels/colors), seed.ts (initial snapshot)
  lib/         dates.ts, storage.ts (persist/migrate/validate/import/export),
               ops.ts (pure data operations + activity logging), selectors.ts (attention,
               deadlines, filters, capacity), sync.ts (sync decisions), cloud.ts (Supabase calls),
               *.test.ts
  state/       store.tsx (React context + persistence), sync.tsx (cloud sync), router.ts, hooks.ts
  components/  Shell, SyncPanel, FilterBar, ProjectCard, ActivityList, NewProject, ui/ primitives
supabase/      schema.sql (table + row-level security)
  views/       Dashboard, Portfolio, ProjectDetail, Planner, Review, Activity, DataSettings
```

Data is kept separate from presentation: views call pure functions in `lib/ops.ts` through `apply(fn)`; all derived logic lives in `lib/selectors.ts` and is unit-tested.

### Changing the schema later

1. Bump `SCHEMA_VERSION` in `src/data/types.ts`.
2. Add a migration in `MIGRATIONS` (`src/lib/storage.ts`) keyed by the old version.
3. Add a test that migrates a sample of the old shape.

## Limitations (v1, by design)

- Single user. Sync keeps whole copies in step; it doesn't merge simultaneous edits from two devices (you choose which copy wins).
- Sync needs the Supabase project; without it the app is browser-only.
- No notifications, calendar sync, time tracking, AI features, or integrations.
- Activity log keeps the most recent 2,000 entries.
- Recurring blocks aren't auto-repeated; use **Copy last week** in the planner.
