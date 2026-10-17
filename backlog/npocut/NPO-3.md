Add `kb_autogen.py`: autonomous generation for new or changed OntoKB items.

- Reads library (live or `--from-json`). For each item computes `content_hash` = sha256 of
  title + summary + key_points + render options.
- State file `kb_out/autogen_state.json`: `{id: {hash, status: done|failed, outputs:[...], error, updated_at, attempts}}`.
  Atomic write (tmp + rename). File lock (`kb_out/.autogen.lock`, stale after 2 h) so overlapping cron runs don't collide.
- Generates (via kb_video functions, not subprocess) for items that are new, changed, or failed with attempts < 3.
  Options: `--limit N` (default 3 per run), `--kinds article,youtube` filter, `--formats landscape,vertical`
  (default both), `--dry-run` (print plan, no render), `--force <id>`.
- When OntoKB is unreachable: exit code 0 with a clear "ontokb offline, skipped" message (cron-friendly), unless `--strict`.
- Writes `kb_out/index.html`: a simple static gallery listing each generated video (title, duration, links to mp4s, source url).
- Prints a one-line JSON summary at the end: `{"generated":n,"skipped":n,"failed":n}`.
- Tests `tests/test_kb_autogen.py` (fake TTS, tiny size, tmp out dir): first run generates, second run skips, changed
  summary regenerates, failure recorded and retried, lock prevents concurrent run, offline behavior, dry-run renders nothing.
