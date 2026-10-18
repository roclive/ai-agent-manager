UI package scaffold + app shell + Kanban board (copied/adapted from Paperclip).

Create `ui/` (own `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/`). Dev server on port 5174 proxying `/api`
and `/api/stream` to `http://127.0.0.1:3199`; production build to `ui/dist` with relative-safe asset paths served from `/`.

1. **Scaffold**: Vite + React 19 + TypeScript + Tailwind v4 + radix-ui + @dnd-kit + @tanstack/react-query + react-router-dom 7 +
   lucide-react + cva/clsx/tailwind-merge + vitest/jsdom/@testing-library. Scripts: `dev`, `build`, `test`, `typecheck`.
   Install with `npm install --cache /tmp/aam-npm-cache` in `ui/`; commit the lockfile (`ui/package-lock.json`).
2. **Design system**: copy Paperclip's theme tokens/base styles into `ui/src/index.css` and the shadcn-style primitives
   (`components/ui/*` listed in the shared context) + `lib/utils.ts`. Light/dark following system preference with a toggle in the
   sidebar footer (persist in localStorage, try/catch).
3. **App shell** (adapt Paperclip `Layout`/`Sidebar`/`BreadcrumbBar`): left sidebar with project switcher (dropdown: 全部项目 +
   each project with its colour dot and running count), nav items: 总览 (/), 看板 (/board), 待办 (/backlog), 定时任务 (/routines),
   活动 (/activity), 设置 (/settings); top breadcrumb; responsive (sidebar collapses to a sheet on narrow screens).
   A small footer showing daemon state / cooldown from `/api/status` (poll 10 s). Routes for the pages not built yet
   (总览/待办/定时任务/活动/设置) render an `EmptyState` placeholder "即将推出" — AAM-6 fills them in.
4. **API client**: `ui/src/lib/api.ts` — typed fetch wrapper (adds `X-AAM: 1` to mutating requests), `types.ts` with Task, Project, Run,
   Routine, Event, Status per the API in AAM-4 (`/api/tasks`, `/api/projects`, `/api/status`, `/api/events`, PATCH task) — AAM-4 is
   being built in parallel; code against the contract in `backlog/aam/AAM-4.md` but make the board work with the CURRENT API too
   (tasks list, PATCH status). react-query hooks in `ui/src/lib/queries.ts`. An SSE hook `useEventStream()` that invalidates
   task/run queries on `events` messages, with graceful fallback to 5 s polling if `/api/stream` is not available.
5. **Kanban board** (`/board`), adapt `KanbanBoard.tsx`: columns 待办池 backlog / 就绪 ready / 进行中 in_progress / 待审查 in_review /
   受阻 blocked / 完成 done (+ collapsed 已取消). Cards show identifier, title, priority icon, worker badge (codex/opencode),
   role, attempts n/max, dependency chips, blocker warning, a pulsing "running" indicator with elapsed time for tasks with a running run.
   Drag & drop between columns and reordering within a column (optimistic update; PATCH `{status}` and `{sort_order}` — computed as the
   midpoint between neighbours; until AAM-4 lands, send `sort`); rejected with a toast when the server says "Task has a running worker";
   revert on error. Column header "+" opens a minimal "新建任务" dialog (title, description, priority, role, worker, project) → POST /api/tasks.
   Filters: project (from sidebar), text search, worker, priority. Clicking a card navigates to `/board?task=<ID>` (the drawer is AAM-6;
   here show a simple Sheet with title/description/status so the click does something).
6. Tests (vitest): column grouping & ordering, drag-end handler produces the right PATCH (unit-test the handler, not the pointer events),
   optimistic revert on error, api client adds the header, StatusIcon/PriorityIcon render, theme toggle persistence.
7. Root `.gitignore`: add `ui/node_modules/`, `ui/dist/`. Add `ui/README.md` (dev/build instructions) and `ui/THIRD_PARTY_NOTICES.md`.

Verify yourself: `cd ui && npm run build` succeeds and `ui/dist/index.html` exists; run the dev server briefly with a fake API
(or the real `aam serve` if AAM-4 is present) and make sure the board renders (use curl/jsdom, no browser available to you).
