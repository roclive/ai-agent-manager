Auto-review throughput: reviews are the bottleneck of the overnight pipeline. (00-ui-context.md rules apply; backend task.)

Observed: with 3 Codex slots finishing tasks every few minutes, `startAutopilot()` launches ONE reviewer job at a time (a pending job blocks new ones) and at most one per 60 s. Six tasks sat in `in_review`
while two worker slots idled (dependents wait for `done`, so nothing could be promoted either). Fix:

1. **Concurrency**: setting `auto_review_concurrency` (default 3, range 1–5, shown on the Settings page and in `autopilot status`): launch reviews for all eligible `in_review` tasks of `auto_review` projects until
   that many jobs are pending, in the SAME tick (no per-minute throttle). Keep: per-task retry limits, the daily budget (`auto_review_daily_max`), the Claude-health gate, test-must-pass rule, and "two rejects → blocked".
   Per-task: never two concurrent reviews of the same task. Order: oldest `in_review` first, then project `autopilot_rank`.
2. **Expiry**: a pending job without a result is currently treated as timed out after 300 s; keep, but when it expires with ETIMEDOUT retry that task after 20 s (not 60 s) and count it as one failure; after 3 consecutive
   timeouts for the same task pause only that task's auto-review for 30 min (event `review_error`), not the whole autopilot.
3. **Also review faster for tiny diffs**: skip nothing automatically, but truncate the prompt's diff to 30 KB for tasks whose test run passed and add the `git diff --stat` + names-only list so the model still sees every file touched
   (large crawled/generated data files must never be inlined: skip diffs of files > 20 KB and list them by name and size).
4. **Pipeline idle detector**: if there are free worker slots AND tasks waiting for review AND all free slots could not be filled by promotion, emit event `review_bottleneck` (at most once per 15 min) with the counts, and expose
   `waiting_for_review` in `/api/status.autopilot` and the dashboard card.
5. Tests with the fake claude (parallel launches up to the limit, same-task exclusivity, budget, health gate, timeout retry/backoff, bottleneck event). README note. Never call the real claude in tests; do not change project flags.
