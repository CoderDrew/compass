# Project Compass

A calm, personal command center for everything you're carrying — employment, Mindjax client work, software products, tabletop and creative projects, career development, and personal commitments.

**Its job is to help you decide what to work on, not to become another project.**

React + TypeScript + Vite + Tailwind, Lucide icons, Recharts for one chart. No backend, no accounts, no external services. Data lives in your browser.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (persistence, import/export, operations, selectors)
npm run build      # typecheck + production build into dist/
```

Requires Node 18+ (CI uses Node 20).

## What's in v1

| View | What it answers |
| --- | --- |
| **Today** (dashboard) | What's due today, this week's focus, upcoming deadlines, what you're waiting on, what needs a look, and what you can safely ignore. Health counts are clickable filters. |
| **Portfolio** | The whole portfolio at a glance — by category (default), by status, or as a list. Waiting projects have a dashed amber edge; paused ones recede; critical ones get a red edge. Progress bars only appear where milestones or tasks make progress measurable. |
| **Project** | Click any project. Everything is click-to-edit. Next action is the most prominent field, with a one-click **Done**. Tasks, milestones, notes, links, related projects, and the project's activity log. |
| **Plan week** | Weekly capacity budget, focus projects, suggested allocations (added as *unscheduled* blocks — nothing is auto-scheduled), and a Mon–Sun board. Drag blocks onto days or use the day menu. |
| **Weekly review** | A 7-step, ~15-minute guided review. Every step can be skipped. Saving records the review in the activity log. |
| **Activity** | What changed in any given week — status changes, completed tasks and milestones, next-action updates, notes, and decisions. |
| **Data & settings** | Export/import JSON, automatic one-step backup, restore seed data, theme, capacity. |

Filters (search, category, status, priority, deadline, this week's focus, waiting, needs attention) are shared between the dashboard and the portfolio.

### Design rules baked in

- **Priority ≠ urgency.** Priority is a property of the project; urgency comes only from real dates.
- **No fabricated deadlines.** Genghis 2027 is stored as *February 2027* (month precision) because no day was given. Month-only dates are never shown as overdue mid-month.
- **Hobbies never nag.** Projects marked *Low pressure* (Drumming, Shadowdark monthly, Suno) never appear as overdue or "needs attention".
- **Ongoing commitments** (Antech, Mindjax, job search, recurring hobbies) never show a % complete.
- **Active ≠ this week.** Focus is chosen deliberately per week; Active projects aren't automatically obligations.
- Antech's 40 protected hours are shown separately and never counted against discretionary capacity.

## Your data, backups, and devices — read this

> **Data is stored in this browser's `localStorage` only. It does not sync between computers, browsers, or devices.** Clearing site data erases it.

- **Back up:** *Data & settings → Export JSON* (a good habit at the end of each weekly review).
- **Move to another device/browser:** export on the old one, *Import JSON* on the new one.
- **Imports are validated** before anything changes, and the current data is kept as a one-step automatic backup (*Restore automatic backup*).
- **Deleting** a project/task/milestone shows an **Undo** toast for a few seconds.
- If stored data ever can't be read, the original is preserved under a `project-compass:data:corrupt:*` key instead of being overwritten.
- Deploying a new version **does not** touch your data: it stays in the browser under the same site origin. The data has a `schemaVersion`; older data is migrated on load (see `MIGRATIONS` in `src/lib/storage.ts`).

> ⚠️ Data is per-origin. `http://localhost:5173` (dev) and `https://<you>.github.io` (deployed) have **separate** storage. Use export/import to move between them.

## Deploying to GitHub Pages

The app uses hash routing and a relative base (`base: './'`), so it works under any repository name without extra config.

1. Create a GitHub repository and push this project to the `main` branch.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main` (or run the workflow manually). `.github/workflows/deploy.yml` installs, runs tests, builds, and publishes `dist/`.
4. The site appears at `https://<user>.github.io/<repo>/`.

Note: a public repository makes the **code and seed dataset** (`src/data/seed.ts`) public, including project names. Your edits made in the app are not in the repo — they live only in your browser. If you'd rather not publish the seed details, use a private repo (GitHub Pages on private repos requires a paid plan) or trim `seed.ts` before pushing.

Manual alternative: `npm run build` and serve `dist/` from any static host.

## Project structure

```
src/
  data/        types.ts (schema), meta.ts (labels/colors), seed.ts (initial snapshot)
  lib/         dates.ts, storage.ts (persist/migrate/validate/import/export),
               ops.ts (pure data operations + activity logging), selectors.ts (attention,
               deadlines, filters, capacity), data.test.ts
  state/       store.tsx (React context + persistence), router.ts (hash routes), hooks.ts
  components/  Shell, FilterBar, ProjectCard, ActivityList, NewProject, ui/ primitives
  views/       Dashboard, Portfolio, ProjectDetail, Planner, Review, Activity, DataSettings
```

Data is kept separate from presentation: views call pure functions in `lib/ops.ts` through `apply(fn)`; all derived logic lives in `lib/selectors.ts` and is unit-tested.

### Changing the schema later

1. Bump `SCHEMA_VERSION` in `src/data/types.ts`.
2. Add a migration in `MIGRATIONS` (`src/lib/storage.ts`) keyed by the old version.
3. Add a test that migrates a sample of the old shape.

## Limitations (v1, by design)

- Single user, single browser; no sync, accounts, or backend.
- No notifications, calendar sync, time tracking, AI features, or integrations.
- Activity log keeps the most recent 2,000 entries.
- Recurring blocks aren't auto-repeated; use **Copy last week** in the planner.
