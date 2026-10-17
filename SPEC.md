# aam — AI Agent Manager (spec)

Claude Code is the **manager** (plans, writes tasks, reviews). Local coding CLIs
(**Codex** via `codex exec`, **opencode** via `opencode run`) are **workers**.
`aam` is the glue: persistent task queue, git-worktree isolation, dispatch,
automatic tests, heartbeat/cron scheduling, and Markdown views for humans/Claude.
No Paperclip server is involved. Paperclip (MIT, in `vendor/paperclip`, gitignored)
is only a source of UI components later.

## Stack
- Node >= 22, TypeScript (ESM), `tsx` for running, `vitest` for tests.
- SQLite via `better-sqlite3`. DB file: `<home>/aam.db`, where `<home>` is `$AAM_HOME`
  or `./.aam` (relative to cwd of the manager repo).
- CLI via `commander`. Cron via `croner`. HTTP via `hono` + `@hono/node-server`.
- Entry: `bin/aam` -> `src/cli.ts`. `npm run aam -- <args>` must also work.

## Data model (tables)
- `projects(id, key UNIQUE, name, repo_path, base_branch default 'main', test_cmd, setup_cmd, created_at)`
  `key` like `NPO`, used for identifiers.
- `tasks(id, project_id, identifier UNIQUE e.g. NPO-7, seq, title, description,
  status, priority, role, worker, depends_on JSON array of identifiers, attempts,
  max_attempts default 3, branch, worktree_path, feedback, blocker, created_at, updated_at)`
  - status: `backlog | ready | in_progress | in_review | done | blocked | cancelled`
  - priority: `P0 | P1 | P2 | P3`; role: `backend | frontend | testing | any`
  - worker: `codex | opencode` (default from settings, default `codex`)
- `runs(id, task_id, worker, pid, status running|succeeded|failed|timeout|lost|rate_limited,
  started_at, ended_at, exit_code, test_exit_code, log_path, last_message_path, summary)`
- `routines(id, name UNIQUE, cron, action heartbeat|create_task|shell, payload JSON, enabled, last_run_at)`
- `events(id, ts, task_id nullable, kind, message)` — append-only activity log.
- `settings(key PRIMARY KEY, value)` — `max_parallel` (2), `worker_timeout_min` (45),
  `default_worker` (codex), `review_mode` (`manual` | `claude`), `cooldown_until` (ISO or empty).

## Lifecycle
1. Manager (Claude) creates tasks (`aam task add ...`) as `backlog`, promotes to `ready`.
2. **Heartbeat tick** (idempotent, guarded by a lock file `<home>/tick.lock` with stale-pid detection):
   a. **Reap**: for each `running` run, if pid not alive -> finalize (see 3). If over timeout -> kill process group, status `timeout`.
   b. **Cooldown**: if `cooldown_until` in future, skip dispatch.
   c. **Dispatch**: pick `ready` tasks ordered by priority then seq, whose `depends_on` are all `done`,
      until running count == `max_parallel`. For each: create worktree, spawn worker **detached**
      (own process group, stdout/stderr -> log file), insert run, status `in_progress`.
   d. **Review** (only if `review_mode=claude`): for each `in_review` task without a pending review,
      run `claude -p` (see Review) synchronously with a timeout; apply verdict.
   e. **Export** `BACKLOG.md` and `PROGRESS.md` into `<home>/..` (the manager repo root) — see Views.
3. **Finalize a run** (when worker process ended): read exit code from `<run_dir>/exit_code`
   (the spawned wrapper writes it). Detect rate/usage limit in the log tail
   (`/usage limit|rate limit|429|quota/i`) -> run `rate_limited`, task back to `ready`
   (attempts unchanged), set `cooldown_until` = now + 30 min, event `cooldown`.
   Otherwise: commit any uncommitted changes in the worktree (`aam: <ID> <title>`), run
   project `test_cmd` in the worktree (capture to `<run_dir>/test.log`).
   - worker exit 0 and tests pass (or no test_cmd) -> run `succeeded`, task `in_review`.
   - else -> run `failed`, `attempts++`, `feedback` = last 80 lines of test/worker log;
     task `ready` if attempts < max_attempts else `blocked` with `blocker` text.
4. Review verdict `approve` -> task `done`; `reject` -> task `ready`, `feedback` = notes, `attempts++`.
   Manual: `aam review <ID> approve|reject --note "..."`.
5. **Never** push, never merge into `base_branch`, never modify the project's main checkout.
   Approved branches stay as `aam/<ID>`; `aam merge <ID> --into <branch>` merges into a
   non-base integration branch only (refuse if target == base_branch).

## Worktrees
- Path: `<home>/worktrees/<projectKey>/<ID>`; branch `aam/<ID>` from `base_branch`.
- Reuse existing worktree/branch on retry (do not recreate). Run `setup_cmd` once on creation if set.
- `aam worktree prune <ID>` removes worktree (keeps branch).

## Worker adapters (`src/workers/*.ts`)
Interface: `{ name; command(ctx): { cmd: string, args: string[], stdinFile?: string } }`.
Prompt is written to `<run_dir>/prompt.md`. Run dir: `<home>/runs/<runId>/`.
- **codex**: `codex exec --json -C <wt> -s workspace-write -c approval_policy="never"
  -c sandbox_workspace_write.network_access=true --skip-git-repo-check -o <run_dir>/last.md -`
  with prompt on stdin.
- **opencode**: `opencode run --format json --dir <wt> "$(cat prompt.md)"` (pass prompt as arg).
- Spawn through a tiny sh wrapper so exit code is persisted even if aam dies:
  `sh -c '<cmd> < prompt > log 2>&1; echo $? > exit_code'` (properly quoted, no shell injection
  from task text — prompt only travels via file).
- `AAM_FAKE_WORKER=<path>` env overrides every adapter with that executable (for tests):
  called as `<path> <worktree> <promptFile>`.

### Worker prompt template
Includes: project name, task ID/title/description, role, acceptance = tests via `test_cmd`,
previous `feedback` if any, rules: work only in this worktree, commit with message
`<ID>: <summary>`, do not push, do not touch files outside the worktree, write a short
summary of what changed at the end.

## Review (`review_mode=claude`)
`claude -p --output-format json "<prompt>"` with cwd = worktree, prompt containing task,
`git diff <base>...aam/<ID> --stat` + truncated diff (≤ 60 KB), test result. Must answer with
JSON `{"verdict":"approve"|"reject","notes":"..."}` (parse the `result` field, find first JSON object).
Unparseable -> leave `in_review`, add event.

## Views (generated, overwritten each tick)
- `BACKLOG.md`: per project, sections by status (in_progress, ready, in_review, blocked, backlog, done[last 20]),
  each line `- [P1] NPO-7 Title (worker, attempts n/3) — blocker/feedback first line`.
- `PROGRESS.md`: last 50 events, currently running runs with elapsed time, cooldown status.

## Scheduler
- `aam daemon [--interval 60]`: loop calling tick every interval seconds, plus `croner` jobs for
  enabled `routines`. Default routine created by `aam init`: `heartbeat` every 5 min (`*/5 * * * *`).
  `create_task` routine payload = task fields (creates a new task each fire, e.g. nightly test sweep).
  `shell` routine payload = `{cmd, cwd}`; log output to events.
- Graceful SIGINT/SIGTERM. Workers keep running (detached); next daemon start reaps them.
- `aam launchd install|uninstall|status`: writes `~/Library/LaunchAgents/com.aam.daemon.plist`
  (KeepAlive, RunAtLoad, stdout/stderr to `<home>/daemon.log`, absolute node + tsx paths,
  WorkingDirectory = manager repo, PATH including /opt/homebrew/bin and ~/.local/bin). `install`
  prints the plist and only calls `launchctl load` with `--load`.

## CLI
```
aam init
aam project add --key NPO --name npocut --repo <path> [--base main] [--test "<cmd>"] [--setup "<cmd>"]
aam project list
aam task add --project NPO --title ... [--desc ... | --desc-file f] [--priority P1] [--role backend] [--worker codex] [--depends NPO-1,NPO-2] [--ready]
aam task list [--status ready] [--project NPO] [--json]
aam task show <ID>          # includes runs and recent events
aam task move <ID> <status> [--note ...]
aam task edit <ID> [--title|--desc|--priority|--worker|--depends]
aam run <ID>                # dispatch now regardless of max_parallel (still respects deps unless --force)
aam tick                    # one heartbeat
aam daemon [--interval 60]
aam review <ID> approve|reject [--note ...]
aam merge <ID> --into <branch>
aam logs <ID> [--run N] [--tail 100]
aam routine add --name n --cron "..." --action heartbeat|create_task|shell [--payload json]
aam routine list | enable <name> | disable <name>
aam settings get|set <key> [value]
aam serve [--port 3199]      # HTTP API, 127.0.0.1 only
aam launchd install|uninstall|status
```

## HTTP API (`aam serve`, for the future Kanban UI)
JSON, bind 127.0.0.1. `GET /api/projects`, `GET /api/tasks?status=&project=`, `POST /api/tasks`,
`PATCH /api/tasks/:id` (status/priority/title/description/worker/sort), `GET /api/tasks/:id`
(with runs+events), `GET /api/runs/:id/log?tail=`, `GET/POST/PATCH /api/routines`,
`POST /api/tick`, `GET /api/events?limit=`, `GET/PUT /api/settings`.

## Tests (vitest)
- Unit: DB repo functions, priority/deps ordering, view rendering, rate-limit detection, adapter command building.
- Integration: temp dir with a temp git repo + `AAM_FAKE_WORKER` script that edits a file and exits 0
  (and a failing variant). Cover: dispatch -> finalize -> in_review; failure -> retry -> blocked after
  max_attempts; rate-limit -> cooldown; max_parallel respected; deps respected; review approve/reject; merge
  refuses base branch.
- `npm test` must pass offline and must never call real codex/opencode/claude.
