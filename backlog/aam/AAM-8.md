Overnight autopilot: the user wants the workers to keep going all night without a human. Today the pipeline stalls in three places:
(a) a finished task waits in `in_review` until a human approves, which blocks every dependent task; (b) when the queue is empty nobody plans more work;
(c) the Mac may sleep. Fix all three — but ONLY for projects that opt in, because this aam is shared with other people/sessions whose in_review tasks must never
be auto-approved or auto-reworked.

Read SPEC.md, `src/core/review.ts` (a `review_mode=claude` path already exists), `src/core/tick.ts`, `src/core/dispatch.ts`, `src/db/index.ts`.

1. **Per-project flags** (idempotent migration on `projects`): `auto_review INTEGER DEFAULT 0`, `autopilot INTEGER DEFAULT 0`, `goal TEXT DEFAULT ''`,
   `autopilot_rank INTEGER DEFAULT 100` (lower = served first). CLI: `aam project edit <KEY> [--auto-review on|off] [--autopilot on|off] [--goal-file f | --goal text] [--rank n]`.
   API: `PATCH /api/projects/:key` accepts them; `GET /api/projects` returns them. Settings page (ui/): add the three fields to the project edit dialog
   (checkbox 自动审查, checkbox 自动驾驶, textarea 项目目标, number 优先级) and show badges on the project table. Global `review_mode` stays as the default for projects with `auto_review=0`
   (i.e. manual); auto_review projects are reviewed automatically regardless of the global mode.
2. **Auto review** (tick step, only for `auto_review=1` projects): for each `in_review` task without a pending review, run the Claude reviewer
   (`claude -p --output-format json`, cwd = the worktree, `--permission-mode plan` or equivalent read-only; find the right flags with `claude --help`; timeout 240 s, argv array — never a shell string).
   Prompt: task title/description (≤ 6 KB), test command + exit status + last 60 lines of test log, `git diff --stat base...branch`, and the diff (≤ 60 KB, truncated with a note), the
   project's rules ("local work only, never push; tests must pass; no secrets; scope matches the task"). It must answer ONLY JSON `{"verdict":"approve"|"reject","notes":"..."}`.
   Rules the code enforces regardless of the model: tests must have passed (`test_exit_code` 0 or no test_cmd) else auto-reject without calling the model; approve → `done`
   (never merge anything); reject → `ready` with `feedback = notes`, attempts+1; unparseable output → retry once, then leave `in_review` and add an event; two consecutive auto
   rejects of the same task → `blocked` with blocker "auto-review rejected twice: <notes>". Budget settings (settings table, shown on the Settings page):
   `auto_review_daily_max` (default 80), counted per local day; when exhausted leave tasks in_review and add one event per hour. Use at most 1 reviewer call per tick per 60 s so the
   heartbeat stays responsive (run the reviewer detached/async, never block the tick loop for minutes). Env `AAM_FAKE_CLAUDE=<script>` overrides the claude binary for tests
   (called with the prompt on stdin, prints JSON).
3. **Idle refill / promotion**: after dispatch in each tick, `free = max_parallel - running`. If `free > 0` and fewer than `free` dispatchable `ready` tasks exist, promote
   `backlog` tasks (dependencies all `done`) from `autopilot=1` projects to `ready`: ordered by `autopilot_rank`, then round-robin by least-recently-dispatched project, then priority, then sort_order;
   at most `free` promotions per tick; event `promote` ("idle refill: ID"). Never promote tasks of projects without `autopilot`. `blocked` tasks are skipped (they never starve other tasks).
4. **Planner**: for an `autopilot=1` project with a non-empty `goal` whose queue is drained (no backlog/ready/in_progress/in_review tasks) and no planner run in the last 20 minutes, run `claude -p --output-format json`
   with: the goal, README head (≤ 4 KB), `git log --oneline -25`, file tree depth 2 (≤ 120 lines), titles of the last 40 done tasks, and rules: "return 3–5 NEW small tasks (each completable by a coding agent in 10–25 minutes, each
   with testable acceptance criteria and a test requirement), dependencies only on tasks you return, no deployment/push/network-publishing, do not repeat done work, stay inside the project goal". Output JSON
   `{"tasks":[{"title","description","priority":"P2"|"P3","role":"backend|frontend|testing|any","depends_on":[0-based indexes into this list]}]}`. Validate strictly (types, ≤ 5 tasks, title/description lengths), create them as `backlog`
   with the project's shared context file content if one is configured (`projects.context_file` — add this optional column + `--context-file` on `project edit`; its text is prepended to every planner-created task description), event
   `plan` listing the new IDs. Budget `planner_daily_max` (default 10). On failure: event + 30-minute backoff per project. The planned tasks are then picked up by the promotion step above.
5. **Keep awake**: the daemon starts `caffeinate -i -m -w <daemon pid>` once (if `/usr/bin/caffeinate` exists, setting `keep_awake`=1 default) so idle sleep does not suspend workers while it runs; restart it if it dies;
   record `keep_awake_pid` in status. (Lid-closed sleep on battery cannot be prevented — document it.)
6. **Observability**: `GET /api/status` gains `autopilot: {auto_reviews_today, auto_review_max, planner_runs_today, planner_max, promotions_today, idle_since?, caffeinate: bool}`; the dashboard shows a
   「夜间自动驾驶」card with these numbers, plus `aam autopilot status` CLI. Add an `idle` event (at most once per 30 min) when nothing is running, nothing is ready and nothing can be promoted or planned, stating why
   (e.g. "all autopilot projects are blocked / budgets exhausted").
7. **Safety**: auto-review and planner only ever read repos and write aam's DB; they never push, merge into the base branch, or delete. Child processes get a clean env (PATH + HOME only).
8. Tests (offline, fake claude + fake worker): auto-review approve/reject/unparseable/failed-tests/two-rejects/budget; non-opted-in project is never touched; promotion order and per-tick cap, deps respected, blocked skipped;
   planner validation (bad JSON, too many tasks, cycles), backoff, budget; caffeinate spawn mocked; status payload. README section「夜间自动驾驶」(Chinese) explaining flags, budgets and how to turn everything off.
Do NOT enable any flag on any existing project in code or migrations (the manager does that after review).
