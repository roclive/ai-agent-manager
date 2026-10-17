Manager review fixes for aam (from Claude's code review). Fix all three, add tests for each, keep `npm test` and `npm run typecheck` green.

1. Workers cannot commit. Codex's `workspace-write` sandbox blocks writes to `.git` (a worktree's git dir lives in the
   main repo's `.git/worktrees/`). Change the worker prompt in `src/workers/index.ts`: tell the worker NOT to run
   `git commit`/`git add` — aam commits for it — and to end with a short summary. In `src/core/finalize.ts`, use the
   first non-empty line of `<run_dir>/last.md` (if present, max 72 chars) as the commit subject:
   `<ID>: <summary line>`; fall back to `aam: <ID> <title>`. Put the full last.md in the commit body (truncate 4 KB).

2. Dependent tasks don't get dependency code. In `ensureWorktree` (`src/core/worktree.ts`), when creating a NEW branch
   for a task with `depends_on`, after `worktree add` merge each dependency branch `aam/<dep>` (that exists) into it with
   `git merge --no-edit`. On conflict: `git merge --abort`, remove the new worktree and branch, and throw a clear error
   so dispatch marks the task `blocked` with blocker "dependency merge conflict: <dep>" (not a retry loop). For an
   EXISTING branch on retry, merge any dependency branch commits not yet contained (`git merge-base --is-ancestor`).
   Record an event per merge.

3. Rate-limit false positives. `rateLimited()` currently scans the whole worker log tail for
   `/usage limit|rate limit|429|quota/i`, so ordinary code or test output containing those words pauses all
   workers for 30 min. Only treat as rate limited when the worker exit code is non-zero (or missing) AND the match
   appears in an error-ish line: for codex JSON logs, events with `"type":"error"` or `"type":"turn.failed"` (or
   lines containing `"error"` keys); for plain text, lines matching `/\b(error|ERROR|Error)\b/`. Use stricter patterns:
   `/usage limit|rate[ _-]?limit(ed)?|\b429\b|quota exceeded|insufficient_quota/i`.

Also: `dispatch()` errors from ensureWorktree should mark the task `blocked` with the error text (currently the task
stays `ready` and will retry forever every tick). Add an event.
