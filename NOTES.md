# Implementation choices

- Task sequence numbers are per project. HTTP `sort` updates the task sequence used within priority ordering.
- Missing dependency identifiers remain unsatisfied. Rejected reviews block at max_attempts, as failed worker runs do.
- Merge uses a temporary integration worktree, preserving the project's main checkout. A target branch already checked out elsewhere is refused by Git.
- Configured setup/test/routine commands are trusted shell commands. Task and review text travel through files or direct process arguments, never interpolated into shell code.
- Opencode uses a tiny Node launcher to read prompt.md into a direct argv value; the detached shell wrapper never receives task text.
- This session cannot write the repository's `.git` directory. Milestone commits are preserved in `/tmp/aam-implementation.git` and exported to `aam-implementation.bundle` for import.
