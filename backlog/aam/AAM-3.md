Robustness fixes found while running aam for real.

1. `lost` runs must not burn attempts. Today a run becomes `lost` when its pid is dead and there is no `exit_code`
   file (e.g. the worker wrapper was killed along with its parent's process tree). Two such runs blocked a task
   whose code was actually passing tests. Change finalize for `lost`:
   - do NOT increment `attempts`; increment a new column `lost_count` (migration: add column default 0);
   - still auto-commit worktree changes and run `test_cmd` (record test_exit_code), keep feedback = test tail;
   - if tests pass and the worktree has commits ahead of base → task `in_review` (event "lost run recovered");
   - else task back to `ready`; if `lost_count >= 3` → `blocked` with blocker "worker repeatedly lost".
2. Make the wrapper more robust: in `wrapper.sh`, ignore SIGHUP (`trap '' HUP`) before running the worker and write
   the worker's pid to `<run_dir>/worker.pid`. On reap, consider the run alive if either the wrapper pid or the
   worker pid is alive.
3. launchd plist must not pin the versioned node path (`/opt/homebrew/Cellar/node/26.5.0/bin/node` breaks on
   `brew upgrade node`). Prefer `/opt/homebrew/bin/node` when it exists, else `process.execPath`.
4. `aam launchd status` should also report `launchctl print gui/<uid>/com.aam.daemon` "last exit code" and, when it is
   78 and the repo is under ~/Desktop, ~/Documents or ~/Downloads, print a hint that macOS privacy protection blocks
   launchd jobs there (grant Full Disk Access to the node binary or move the repos).
5. Add `aam task edit <ID> --attempts N` and `--feedback-file f` so the manager doesn't need raw SQL.
6. Document in README: stop the daemon with `kill -TERM <pid>` (workers keep running); never kill its process tree.

Tests for 1, 2 (fake worker that is SIGKILLed), 3 and 5.
