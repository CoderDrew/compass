# Design decisions

Key decisions behind Compass, taken from the code and the integration decision log ([implementation-plan.md](integrations/implementation-plan.md)). Each entry is marked **Built** or **Planned**.

## App and data

### 1. One JSON document per user, synced with a revision check — Built
The whole portfolio is one `AppData` document (`src/data/types.ts`). The browser copy is the working copy, kept in `localStorage` so the app works offline. Cloud writes use a conditional update (`… where revision = base`), so a stale write fails instead of silently overwriting.
**Why:** a single-user app doesn't need row-level merging, and an atomic revision check is enough for correctness.
**Trade-off:** no merge. If two devices both changed, the user picks which copy to keep, and the other copy becomes the one-step local backup.

### 2. Business rules as pure functions — Built
All changes go through pure `AppData → AppData` functions in `src/lib/ops.ts`; derived views live in `src/lib/selectors.ts`. Neither depends on the browser.
**Why:** the rules are easy to unit-test, and the same code runs unchanged in the Deno Edge Function.

### 3. Priority is not urgency; no invented dates; hobbies never nag — Built
Urgency comes only from real dates. A deadline given only as a month is stored as `YYYY-MM` and never shown as overdue mid-month. Projects marked low-pressure never show as overdue or "needs attention".
**Why:** the dashboard exists to reduce pressure and support deliberate choices, not to manufacture urgency.

### 4. Static hosting on GitHub Pages — Built
Vite build, hash routing and a relative base, deployed by GitHub Actions. Supabase URL and publishable key are injected at build time from repository variables.
**Why:** free, no server to run, and works under any repository name.

## AI agent access (MCP)

### 5. Supabase Edge Function MCP server with Supabase's OAuth 2.1 server — Built
One Edge Function (`compass-mcp`) hosts the MCP server. Supabase Auth issues tokens, and the consent screen is a route in the existing app.
**Alternatives rejected:** a separate host (a second platform and secret store for no extra capability), a third-party identity provider (paid, and a second identity to map), a static API key or no auth (unacceptable for write access), and letting the agent call the REST API directly (unrestricted document replacement).

### 6. Least privilege enforced by Compass, not OAuth scopes — Built
Supabase OAuth does not support custom scopes, so access is limited in three layers: row-level security that refuses OAuth tokens on the data table, `SECURITY DEFINER` functions executable only by `service_role`, and a fixed set of narrow tools with closed input schemas. Every write is checked against invariants before commit.
**Why:** the agent is semi-trusted. It acts for the user but can be steered by prompt injection.

### 7. No status, priority or deadline changes through tools (D2) — Built
Tools cannot change status, priority or deadlines, and nothing can be deleted. Schemas and invariants both enforce this.
**Why:** these are the judgment calls the dashboard exists to protect. They stay with the user.

### 8. Milestone tools (D3) — Built
`create_milestone` and `complete_milestone` were added, bringing the server to 11 tools. A request like "mark the playtesting task complete" is redirected to the milestone when one matches.

### 9. User time zone for "today" and "this week" (D4) — Built
The browser records its IANA time zone once in `settings.timeZone`. The server uses it for date math and falls back to UTC.
**Why:** an agent running in UTC would otherwise log late-evening work against the wrong day or week.

### 10. Shared code bundled for Deno (D5) — Built
`npm run build:shared` bundles the agent layer into `supabase/functions/_shared/compass-agent.js`, and a test fails if the bundle is stale.
**Why:** one source of truth for rules in both the browser and the Edge Function.

### 11. Idempotent, attributed, backed-up writes — Built
Each commit runs a revision check, saves a backup (last 30 kept), records an op-ledger entry and checks rate limits in one transaction. A `request_id` makes retries safe. Every agent change appears in Activity as "via <assistant>".
**Why:** an AI client may retry or repeat itself, and every change must be traceable and recoverable.

### 12. Claude as the primary MCP client (D1, revised) — Built
The plan started with ChatGPT, but custom MCP servers in ChatGPT need a Business or Enterprise plan. Claude's custom connectors support remote MCP with OAuth and dynamic client registration, so Claude became the primary client.

## Planned

### 13. Weekly-review agent (LangGraph, TypeScript) — Planned, not built
A LangGraph (TypeScript) agent that runs the weekly review with a human approval step:

1. **Gather:** read the week's activity, projects and week plan through the MCP read tools.
2. **Flag:** find stale projects (no recent activity, excluding low-pressure ones) and active projects missing a next action.
3. **Draft:** propose specific changes, such as a next action, a note, or focus for the coming week.
4. **Pause for approval:** stop and show the draft. Nothing is written until the user approves, edits or rejects each change.
5. **Apply:** make only the approved writes, through the existing MCP write tools, so every safeguard above still applies.
6. **Trace:** record every step (inputs, tool calls, drafts, approvals and results) so a run can be inspected and replayed.

**Why:** the review is the most valuable recurring workflow in Compass, and it's a good fit for an agent that drafts while a person decides. Using the MCP tools rather than direct database access keeps the agent inside the same permissions as any other client.
