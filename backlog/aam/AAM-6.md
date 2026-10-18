UI pages: task detail drawer, backlog, dashboard, routines (heartbeat/scheduled tasks), activity, settings.
Depends on AAM-4 (API) and AAM-5 (shell + Kanban); both are merged into your branch. Reuse their components/hooks.

1. **Task drawer** (`/board?task=ID` and `/backlog?task=ID`, a right-hand Sheet like Paperclip's issue detail): editable title,
   description (markdown textarea with preview via a small renderer — react-markdown is fine), status select, priority, role, worker,
   depends_on (multi-select of identifiers), max_attempts; read-only: branch, worktree path, attempts, lost_count, blocker, feedback.
   Tabs: 概览 | 运行记录 | 日志 | 审查.
   - 运行记录: list of runs (worker, status badge, started/ended, duration, exit/test codes, summary).
   - 日志: run selector + log viewer (monospace, auto-scroll, "tail N" selector, auto-refresh every 2 s while the run is running,
     toggle worker log / test log).
   - 审查 (only meaningful when in_review): show `diff_stat`, last worker message (`last_message`), test result, and buttons
     「批准」「驳回」(with a note textarea → POST review), 「合并到集成分支」(input: target branch, not the base branch),
     plus 「立即运行」「取消运行」 with confirm dialogs.
   - Event timeline for the task at the bottom of 概览.
2. **Backlog** (`/backlog`): table/list grouped by status (collapsible), columns: ID, title, priority, role, worker, status, deps, updated.
   Inline quick edit of priority/status/worker via dropdowns, multi-select + bulk "move to ready/backlog/cancelled", sorting, filters
   (project/status/text), "新建任务" button.
3. **总览** (`/`, adapt Paperclip Dashboard + MetricCard): cards — running workers (task, worker, elapsed, link), tasks by status
   (counts + mini bar), review queue (in_review list with quick approve/reject), blocked list with blockers, cooldown banner
   (countdown) when `cooldown_until` is in the future, daemon state, last tick time + 「立即心跳」button (POST /api/tick), recent events feed (live via SSE).
4. **定时任务 / Routines** (`/routines`, adapt Paperclip Routines list + create dialog): list with name, action (heartbeat|create_task|shell),
   cron + human-readable description (use `cronstrue` or a tiny helper; Chinese if easy), next run, last run, enable toggle,
   「立即运行」, edit and delete (confirm). Create/edit dialog with cron presets (每5分钟, 每小时, 每天 07:00, 每周一 09:00, custom) and
   validation errors from the server; payload editors per action: create_task (project, title, description, priority, role, worker),
   shell (cmd, cwd — show a warning banner that shell routines run with your user's privileges), heartbeat (no payload).
   Expand a routine to see its last 20 firings.
5. **活动** (`/activity`): paginated/infinite event log with filters by kind/task/project, live updates.
6. **设置** (`/settings`): form for max_parallel (1–6), worker_timeout_min, default_worker, review_mode (manual|claude), cooldown
   (show/clear `cooldown_until`), plus a read-only "项目" table (key, repo path, base branch, test cmd) with an edit dialog (PATCH /api/projects/:key).
7. Empty/loading/error states everywhere (Skeleton, EmptyState, toast on errors). Keyboard: `c` new task, `/` focus search, `g b` board.
8. Tests: drawer edit → PATCH payloads, review approve/reject calls, routine create validation + payload building, cron helper,
   dashboard cooldown countdown, backlog bulk actions. Keep all tests offline (mock fetch).
9. Update `ui/README.md`. At the end run `cd ui && npm run build` and report bundle size.
