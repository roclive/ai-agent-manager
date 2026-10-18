Manager review of AAM-4 — rejected. The 53 tests pass and most endpoints behave (CSRF 403s, ordering, dependency-cycle
rejection, routine cron validation, review/merge guards, detail payload). I ran the branch against a copy of the live DB and found
four real defects; fix all four and add a regression test for each:

1. **`GET /` returns 400 `{"error":"Invalid path"}` when `ui/dist` exists** — the app's front page cannot load.
   Cause: in the static handler, `resolve(root, "." + "/")` is `root` itself and `safeFile` requires `file.startsWith(root + sep)`.
   Fix: map `/` (and any directory) to `index.html`; keep rejecting paths that escape the root. Test: create a temp `ui/dist` with
   `index.html` + `assets/app-abc.js` and assert `/`, `/board` (SPA fallback), `/assets/app-abc.js` → 200 with the right types,
   `/api/nope` → 404 JSON, `/%2e%2e/x` and `/a/../../x` → never serve files outside dist.
2. **`/api/status` `daemon.running` is false almost always** (it only checks a live pid in `tick.lock`, which exists only during the
   few ms of a tick). Define: running = lock pid alive OR `last_tick_at` within the last 180 s. Also return `last_tick_age_s`.
   The daemon records `last_tick_at` on every tick (verify the scheduler path, not only `POST /api/tick`). Test with fake clock / injected now.
3. **SSE replays the whole events table on every new connection** (first message is event id 1). Fix: without `Last-Event-ID`
   (or `?since=`), start from the current max id and send only new events; with `Last-Event-ID: N` resume after N; support
   `?replay=K` to send the last K events first (default 0). Test: connect, insert 2 events, expect exactly those 2; reconnect with Last-Event-ID.
4. **Caching**: hashed files under `/assets/` should be `Cache-Control: public, max-age=31536000, immutable`; `index.html` and
   everything else `no-cache`. (Currently everything is `no-cache`.) Test the headers.

Also: `POST /api/tasks/:id/cancel` must only kill a pid whose run is still `running` AND whose process is alive (already mostly true) —
add a test using a fake long-running worker proving the process group is gone and the task is `blocked`; if such a test exists already, say so.
