Setup artifacts must never be auto-committed.

Problem: `setup_cmd` (e.g. `ln -s <repo>/node_modules node_modules`) creates untracked paths in the worktree. A
`node_modules/` gitignore pattern does not match a symlink (it is a file), so finalize's `git add -A` committed the
symlink in NPO-1.

Fix in `src/core/worktree.ts`: before running `setup_cmd`, record `git status --porcelain --untracked-files=all`;
after it, every NEW untracked top-level path is appended (deduplicated) to the repo's common exclude file
(`git rev-parse --git-common-dir` + `/info/exclude`, resolved relative to the worktree when relative). Record an event
listing the excluded paths. Additionally, in finalize, before `git add -A`, never stage paths that are symlinks pointing
outside the worktree (use `git add -A -- . ':!<path>'` style pathspecs or unstage them after add) and add an event when
skipped.

Tests: integration test with a setup_cmd that creates a symlink to a dir outside the worktree and a fake worker that
edits a file — the resulting commit must contain the edit and not the symlink.
