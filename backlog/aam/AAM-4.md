Backend API for the UI (`src/server.ts`, `src/db/index.ts`, new `src/api/*` modules as you see fit).

Current API: GET /api/projects, GET/POST /api/tasks, GET/PATCH /api/tasks/:id, GET /api/runs/:id/log, GET/POST/PATCH
/api/routines, POST /api/tick, GET /api/events, GET/PUT /api/settings. Note PATCH currently overloads `seq` for ordering — fix that.

Add / change (all JSON, 127.0.0.1 only, errors as `{error}` with proper 4xx):
1. **Ordering**: new column `tasks.sort_order REAL` (idempotent migration; backfill = seq). `PATCH /api/tasks/:id` accepts
   `sort_order` (number) instead of overloading `seq`; keep `sort` as a deprecated alias mapping to `sort_order`.
   `GET /api/tasks` returns tasks ordered by status column order then `sort_order`, then priority. Also accept PATCH of
   `depends_on` (array of identifiers, validated to exist, no self/cycles), `role`, `max_attempts`.
   Moving a task to `ready` from `blocked` resets `blocker`; moving to `ready` keeps `feedback`.
2. **Projects**: `GET /api/projects` returns each project plus `counts: {status: n}`, `running: n`. `POST /api/projects`,
   `PATCH /api/projects/:key` (name, repo_path must be an existing git repo, base_branch, test_cmd, setup_cmd).
3. **Task actions**: `POST /api/tasks/:id/review {verdict:"approve"|"reject", note}` (same logic as `aam review`),
   `POST /api/tasks/:id/run {force?:boolean}` (dispatch now), `POST /api/tasks/:id/merge {into}` (same guard: refuse base branch),
   `POST /api/tasks/:id/cancel` (kill running worker process group, mark run failed "cancelled by user", task -> blocked
   with blocker "cancelled", event). `GET /api/tasks/:id` also returns `diff_stat` (git diff --stat base...branch, or null)
   and the last run's `last_message` (contents of last.md, ≤ 8 KB).
4. **Runs**: `GET /api/runs?status=&task=&limit=` (newest first, joined with task identifier/title/project key, `elapsed_s`).
   `GET /api/runs/:id/log?tail=N` keep; add `GET /api/runs/:id/test-log?tail=N`.
5. **Status**: `GET /api/status` → `{ now, daemon:{running,pid?,last_tick_at}, cooldown_until, running_runs, max_parallel,
   counts_by_status, review_pending }`. Record `last_tick_at` in settings on each tick. `daemon.running` = whether
   `launchctl`/lock indicates a live daemon (use the existing tick lock file pid check; do not shell out to launchctl in tests).
6. **Live updates**: `GET /api/stream` Server-Sent Events: emits `event: events` with new rows from the `events` table
   (poll the DB every 1 s server-side, send `id`/Last-Event-ID so reconnects don't repeat) plus `event: ping` every 20 s.
7. **Routines**: `POST /api/routines` validate cron with croner (reject invalid), `PATCH /api/routines/:id` (enabled, cron,
   name, payload), `DELETE /api/routines/:id`, `POST /api/routines/:id/run` (fire now), `GET /api/routines/:id/runs`
   (last 20 firings from events). Expose `next_run_at` (computed with croner) in routine JSON.
8. **Static UI**: `aam serve` serves `ui/dist` at `/` with SPA fallback (non-/api GET → index.html), correct content types,
   immutable cache for hashed assets; if `ui/dist` is missing return a small HTML page "UI not built — run npm run ui:build".
   Add root scripts: `ui:install` (`cd ui && npm install --cache /tmp/aam-npm-cache`), `ui:build`, `ui:dev`.
9. **Security** (server only listens on 127.0.0.1 but a browser page on another origin could still hit it): for every
   non-GET request require header `X-AAM: 1` OR an `Origin`/`Referer` whose host is 127.0.0.1/localhost on the server's port;
   otherwise 403. Add CORS only for `http://127.0.0.1:5174`/`http://localhost:5174` (the Vite dev server) incl. the `X-AAM` header.
   Reject path traversal in any file-serving code.
10. Tests (vitest, no network, fake worker): each new endpoint incl. 403 cases, ordering, dependency cycle rejection,
    cancel kills a fake long-running worker, SSE delivers a new event, static serving + SPA fallback, cron validation.
11. Docs: README "HTTP API" section listing all endpoints.

Do not create the `ui/` package in this task (AAM-5 does). The static-serving code must work when `ui/dist` is absent.
