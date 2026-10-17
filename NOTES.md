# Implementation choices

- Task sequence numbers are per project. HTTP `sort` updates the task sequence used within priority ordering.
- Missing dependency identifiers remain unsatisfied. Rejected reviews block at max_attempts, as failed worker runs do.
- Merge uses a temporary integration worktree, preserving the project's main checkout. A target branch already checked out elsewhere is refused by Git.
- Configured setup/test/routine commands are trusted shell commands. Task and review text travel through files or direct process arguments, never interpolated into shell code.
- Opencode uses a tiny Node launcher to read prompt.md into a direct argv value; the detached shell wrapper never receives task text.
- This session cannot write the repository's `.git` directory. Milestone commits are preserved in `/tmp/aam-implementation.git` and exported to `aam-implementation.bundle` for import.
- Numeric HTTP task IDs and human identifiers are both accepted. Identifier allocation uses existing identifier suffixes, so changing `sort` does not cause collisions.
- Tests are explicitly restricted to `tests/` to exclude the ignored vendored Paperclip source. Test process guards reject real AI CLI invocations.
- Setup/test commands have bounded execution times; shell routines and Claude reviews have a two-minute bound. Timeout/lost worker runs consume an attempt and follow the normal retry/block policy.
- Cron routines are loaded and reconciled at each daemon interval; missed occurrences while the daemon is stopped are not replayed.
- HTTP task creation uses `{project: "KEY", title, ...taskFields}`; dependency arrays are stored as JSON text in SQLite responses. Run selection (`logs --run`) uses the database run ID. Pruning refuses dirty worktrees rather than discarding uncommitted files.
