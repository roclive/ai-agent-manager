Manager review of AAM-3 — rejected (good work; two changes needed).

1. launchd plist must not reference ~/Desktop (or any TCC-protected folder) in keys that launchd's xpcproxy opens
   before node starts. With the repo on ~/Desktop the job died with `last exit code = 78: EX_CONFIG` and an empty log
   even after node got Full Disk Access; it only started after the manager hand-edited the installed plist to:
   - `WorkingDirectory` = the user's home directory (aam only needs AAM_HOME at runtime, which stays absolute);
   - `StandardOutPath` / `StandardErrorPath` = `~/Library/Logs/aam/daemon.log` (create the dir on install).
   Generate exactly that. Keep AAM_HOME = repo.home. Update the exit-78 hint text to say: grant Full Disk Access to
   the node binary (print the resolved real path of the node used, via realpathSync) AND that the plist already keeps
   its cwd/logs outside protected folders. Make `aam launchd status` also print the log path. Update README
   (daemon log location) and tests for the plist content.

2. Lost-run recovery is too loose: `git rev-list --count base..HEAD > 0` is true for any retried task whose branch
   already has commits from earlier attempts, so a lost run that changed nothing would go to review. Record the
   worktree HEAD sha at dispatch (new `runs.start_sha` column, idempotent migration) and treat a lost run as
   recovered only if, after the auto-commit, HEAD != start_sha and tests pass. Test: retried task with prior commits +
   lost run that changes nothing → back to `ready` (lost_count+1), not `in_review`.

Note: the installed plist at ~/Library/LaunchAgents/com.aam.daemon.plist is live — do not run `aam launchd install`
or touch launchctl in tests; tests must write plists to a temp path only.
