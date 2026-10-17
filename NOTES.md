# Implementation choices

- Task sequence numbers are per project. HTTP `sort` updates the task sequence used within priority ordering.
- Missing dependency identifiers remain unsatisfied. Rejected reviews block at max_attempts, as failed worker runs do.
- Merge uses a temporary integration worktree, preserving the project's main checkout. A target branch already checked out elsewhere is refused by Git.
- Configured setup/test/routine commands are trusted shell commands. Task and review text travel through files or direct process arguments, never interpolated into shell code.
- Opencode uses a tiny Node launcher to read prompt.md into a direct argv value; the detached shell wrapper never receives task text.
- This session cannot write the repository's `.git` directory. Milestone commits are preserved in `/tmp/aam-implementation.git` and exported to `aam-implementation.bundle` for import.
- Numeric HTTP task IDs and human identifiers are both accepted. Identifier allocation uses existing identifier suffixes, so changing `sort` does not cause collisions.
- Tests are explicitly restricted to `tests/` to exclude the ignored vendored Paperclip source. Test process guards reject real AI CLI invocations.
- Setup/test commands have bounded execution times; shell routines and Claude reviews have a two-minute bound. Timeout runs consume an attempt. Lost runs increment lost_count instead; passing tests (or no configured tests) plus HEAD differing from the SHA captured at dispatch recover to review, otherwise retry until the third loss blocks the task. Recovery takes precedence over the loss threshold. Lost feedback is the test tail. Existing runs without a start SHA cannot establish recovery and retry conservatively.
- Cron routines are loaded and reconciled at each daemon interval; missed occurrences while the daemon is stopped are not replayed.
- HTTP task creation uses `{project: "KEY", title, ...taskFields}`; dependency arrays are stored as JSON text in SQLite responses. Run selection (`logs --run`) uses the database run ID. Pruning refuses dirty worktrees rather than discarding uncommitted files.

- Manager review fixes supersede the original spec: aam commits worker changes from last.md (summary line capped at 72 characters, body at 4096 UTF-8 bytes); workers leave changes uncommitted. Dependency merges precede setup, skip missing/contained branches, and abort conflicts; only newly created branches/worktrees are removed on conflict. Preparation errors block dispatch without consuming worker attempts. Rate-limit detection requires a failed/unknown exit and an error-bearing log line.
