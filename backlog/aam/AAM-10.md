Autopilot hardening: integration gaps found in AAM-9 review + Claude login health check. (00-ui-context.md rules apply; mostly backend.)

A. **Dependents must wait for integration.** `dependenciesDone()` (src/core/dispatch.ts) today only checks `status=done`. For a project with `integration_branch` set, a dependency counts as done only when
   `status=done AND integrated=1` (a done task whose merge is pending/conflicted must not release its dependents: they would branch from an integration tip that lacks its code). Dashboard/Kanban already show 「待集成」; add the
   waiting reason to the dependent's card tooltip. Tests: dependent stays blocked-by-dependency until integrated, then becomes dispatchable.
B. **Backfill when turning integration on.** `setIntegration(on)` creates `aam/integration` from base, but tasks that are already `done` (their code lives only on `aam/<ID>` branches) are not in it, so new tasks branched from integration miss
   their work (concrete case: SB-1/TM-1 done before the flag). On enable: collect the project's done tasks that have a branch, order by completion time (`updated_at`), set `integrated=0`, and integrate each one in that order using the same
   `integrate()` (conflicts create resolve tasks exactly like at approval time; a task with an open resolve task is skipped). Emit one `integration` event summarising counts. Also make `project edit --integration on` print the summary.
   Tasks that were integrated by dependency merging before (their commits are ancestors of the integration tip) must be detected with `git merge-base --is-ancestor` and marked `integrated=1` without a new merge.
C. **Reconcile / retry.** Add a tick step (cheap, every tick): for integration-enabled projects, every `done` task with a branch, `integrated=0` and no open resolve task is retried through `integrate()` (idempotent; a failed attempt due to a busy
   integration worktree or a transient git error is just retried next tick; keep a counter in an `integration_attempts` column and after 5 failed non-conflict attempts add event `integration_blocked` and leave it for a human).
   Serialize integrations with a lock (`<home>/integration.lock`, stale-pid aware) because manual CLI approvals can run concurrently with the daemon.
D. **Rename the promote event** emitted by `promote()` (integration→base) to `integration_promote` so it is not counted as an idle-refill `promote` in `autopilot_status.promotions_today`.
E. **Claude login health check.** The reviewer/planner run `claude -p` with a minimal env. A missing login ("Not logged in · Please run /login", exit 0 but `is_error:true`) silently turned every review into an error before AAM-8's USER/LOGNAME fix.
   Add `aam autopilot check` (runs a tiny real `claude -p` call with the same flags/env as the autopilot, prints ok/error and the first 200 chars of the result) and run the same check inside the daemon at start and every 30 minutes
   (async, never blocking the tick); store `claude_ok`, `claude_checked_at`, `claude_error` in settings; `GET /api/status.autopilot` exposes them; the dashboard 「夜间自动驾驶」 card shows a red line when not ok; while not ok the autopilot
   does NOT start new review/plan jobs (saves the daily budget) and adds an `autopilot_paused` event (rate-limited to once per 30 min). When it recovers add `autopilot_resumed`. Env override `AAM_FAKE_CLAUDE` for tests (the fake prints `{"result":"ok","is_error":false}` or an error variant).
   Treat JSON with `is_error:true` as failure even when exit status is 0.
F. Tests for each item (temp git repos + fake worker + fake claude). README (Chinese) for B/C/E. Do NOT enable integration or autopilot on any project; do not call the real claude in tests.
