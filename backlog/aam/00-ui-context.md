# Shared context for aam UI tasks (AAM-4..6)

Goal: give aam a web UI modelled on Paperclip's (https://github.com/paperclipai/paperclip, MIT licence): sidebar layout,
Kanban board with drag & drop, backlog list, task detail drawer, Routines (scheduled tasks / heartbeat) page,
dashboard, settings. The user asked to COPY Paperclip's UI code rather than invent it.

A shallow clone of Paperclip is at `/Users/zhangdapeng/Desktop/ai-agent-manager/vendor/paperclip` (gitignored, read-only for you —
do not modify it, do not import from it at runtime; copy files into `ui/src/` and adapt).
Useful sources there (paths under `vendor/paperclip/ui/src/`):
- `components/KanbanBoard.tsx` (dnd-kit board), `components/StatusIcon.tsx`, `components/PriorityIcon.tsx`
- `components/ui/*` (shadcn-style: button, card, badge, dialog, sheet, select, tabs, input, textarea, tooltip,
  dropdown-menu, scroll-area, separator, skeleton, toggle-switch, command)
- `components/Layout.tsx`, `components/Sidebar.tsx`, `components/BreadcrumbBar.tsx`, `components/EmptyState.tsx`,
  `components/MetricCard.tsx`, `components/PageSkeleton.tsx`
- `pages/Routines.tsx` (1482 lines — take the list/toggle/create-dialog ideas, not the whole thing), `pages/Dashboard.tsx`
- `index.css` (3422 lines — copy only the theme tokens/base layer and classes your copied components use),
  `lib/utils.ts` (`cn`), `motion-tokens.css`
Paperclip's UI stack (use the same): React 19, Vite, Tailwind CSS v4 (`@tailwindcss/vite`), radix-ui, @dnd-kit/*,
@tanstack/react-query, react-router-dom 7, lucide-react, class-variance-authority, clsx, tailwind-merge, cmdk, vitest.

Copying rules:
- Paperclip's components import `@paperclipai/shared` types, its API client, i18n, router wrappers and many sibling
  components. Do NOT copy those dependencies wholesale: replace types with aam's local types (`ui/src/lib/types.ts`),
  replace its router wrapper with plain `react-router-dom`, drop i18n/plugins/agents/companies concepts, and delete code paths
  you don't need. Keep the look and interaction (spacing, colours, dark/light tokens, kanban columns/cards).
- Keep an MIT attribution file `ui/THIRD_PARTY_NOTICES.md` (Paperclip copyright + licence text) and a header comment
  `// Adapted from paperclipai/paperclip (MIT)` in each copied file.
- Domain mapping: Paperclip "issue" = aam task; "agent" = worker (`codex` | `opencode`); "routine" = aam routine;
  "company" = aam project (switcher in the sidebar header, with an "All projects" option).

aam facts:
- Repo root = `/Users/zhangdapeng/Desktop/ai-agent-manager` (this worktree is a copy). Backend in `src/` (TypeScript, hono, SQLite via better-sqlite3).
  Read `SPEC.md` and `src/server.ts`, `src/db/index.ts` first.
- Task statuses: backlog | ready | in_progress | in_review | done | blocked | cancelled. Priorities P0..P3.
  Roles backend|frontend|testing|any. Workers codex|opencode. Runs: running|succeeded|failed|timeout|lost|rate_limited.
- `aam serve [--port 3199]` serves the HTTP API on 127.0.0.1. The UI is a separate package in `ui/` built to `ui/dist`
  and served by `aam serve` at `/` (see AAM-4). Dev: `cd ui && npm run dev` (Vite proxies `/api` to 127.0.0.1:3199).
- npm cache: the sandbox cannot write to the default cache; always use `npm install --cache /tmp/aam-npm-cache` (inside `ui/`).
  Do not run `npm audit fix`. Commit nothing (aam commits for you). Never touch `~/Library/LaunchAgents` or run launchctl.
- Tests must be offline and fast. UI: vitest + @testing-library/react + jsdom. `cd ui && npm test` and `cd ui && npm run typecheck`
  must pass in addition to root `npm test` / `npm run typecheck`.
- The test command aam runs after you finish is: root `npm test && npm run typecheck`, plus, if `ui/node_modules` exists,
  `cd ui && npm test && npm run typecheck`.
- UI text: Chinese labels by default with English fallback is NOT needed — use Chinese for UI copy (the user reads Chinese),
  keep identifiers/statuses in English where they are data values (display them with Chinese labels via a mapping).
