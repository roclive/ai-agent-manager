Integration branch + automatic conflict-resolution tasks (so parallel work never stalls the pipeline overnight).

Problem observed tonight: BIB-4 depended on BIB-2 and BIB-5; both edited `bible/cli.py` (each registered its own sub-command). aam merged the dependency branches into the new task's branch,
hit a conflict, and marked BIB-4 `blocked` ("dependency merge conflict: BIB-5") until the manager resolved it by hand in the project's main. Parallel tasks in the same repo will do this constantly
(CLI registries, READMEs, package files). Today the only way forward is a human. Fix it structurally.

1. **Per-project integration branch** (migration: `projects.integration_branch TEXT DEFAULT ''`; empty = feature off, default for existing projects; `aam project edit <KEY> --integration on|off` creates
   `aam/integration` from the base branch). When on: new task branches start from the integration branch tip (not from base), so every approved task is already inside; dependency merging becomes a no-op
   safety net (keep the existing code for projects with the feature off).
2. **Auto-merge on approval** (manual `aam review approve`, API, and the future auto-review): merge `aam/<ID>` into the integration branch in a temporary worktree (reuse `merge()` logic, never the base branch, never the user's checkout).
   Clean → event `integrate` and done. Conflict → abort the merge and **create a conflict-resolution task** `Resolve merge conflict: <ID> into integration` (project same, priority P0, role any, worker same as the original,
   `status=ready`, description = original title, the list of conflicting files, the conflict hunks (truncated), and instructions: "In this worktree (branched from the current integration tip) run `git merge aam/<ID>`, resolve every
   conflict keeping BOTH sides' intent (registries/imports: union; docs: keep both sections), run the project tests, leave the merge COMMITTED"). The original task stays `done`; mark it with `integrated=false` and show it in the UI as
   「待集成」. When the resolve task is approved its branch fast-forwards/merges cleanly into integration (it already contains the integration tip) → mark the original `integrated=true`. Guard against loops (max 2 resolve tasks per original, then
   `blocked` with a clear blocker and an event).
   The worker's own commit step must allow a merge commit left by the worker (aam currently commits only dirty files; if the worktree is mid-merge/has a merge commit, keep it).
3. **Never touch base**: integration → base is a human action. Add `POST /api/projects/:key/promote` + CLI `aam project promote <KEY> [--into main]` that fast-forwards/merges the integration branch into the base branch ONLY when
   the user runs it (CLI requires `--yes`; the API requires `{"confirm":true}`), refusing if the base checkout has uncommitted changes, and the UI Settings project row gets a「合并集成分支到 main」button with a confirm dialog showing the commits that will land.
4. **UI**: Kanban cards/backlog rows show 「待集成」 / 「冲突解决中」 badges; the project row shows integration branch status (ahead-of-base commit count). Dashboard shows tasks done but not integrated.
5. **Tests** (temp git repos + fake worker): two tasks editing the same file → second approval creates a resolve task; resolving it integrates both; third-party edits; loop guard; base branch untouched; feature-off projects behave exactly as before;
   promote guard rails. Update README (Chinese section「集成分支」).
Do NOT enable the feature on any existing project (the manager does that). Never push.
