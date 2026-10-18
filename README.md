# aam — AI Agent Manager

`aam` connects a persistent local task queue to Codex and opencode workers. Each task gets a Git branch and worktree. Heartbeats dispatch work, collect exit codes, commit changes, run project tests, and queue successful work for review. Claude Code acts as the manager: plan tasks, promote them, inspect results, and approve or reject work.

Requires Node.js 22 or newer, npm, Git, and an installed/authenticated worker CLI (`codex` or `opencode`). Use a current Node 22 release or newer for the development tools. SQLite uses `better-sqlite3`; installing it may require native build tools if a prebuilt binary is unavailable.

## Quickstart

Run manager commands from this repository. The project being worked on can live elsewhere and must already have a commit, a base branch, and Git author identity configured.

```sh
npm ci
export PATH="$PWD/bin:$PATH"

aam init
aam project add --key NPO --name npocut --repo /absolute/path/to/npocut \
  --base main --test 'npm test' --setup 'npm ci'

aam task add --project NPO --title 'Add input validation' \
  --desc 'Validate empty inputs and add regression coverage.' \
  --priority P1 --role backend --ready

aam tick
```

The first tick starts an available worker and returns. A later tick reaps it and runs tests:

```sh
aam task list
aam tick
aam task show NPO-1
aam logs NPO-1 --tail 100
```

Every command also works as `npm run aam -- <args>` or `./bin/aam <args>`. For longer descriptions, use `--desc-file /path/to/task.md` on task creation. Creation defaults to `backlog`; `--ready` promotes immediately. You can change state with `aam task move NPO-1 ready --note 'Ready to implement'`.

## Review and integration

Successful runs enter `in_review`. Inspect the task, branch diff, and test output before deciding:

```sh
aam task show NPO-1
git -C /absolute/path/to/npocut diff main...aam/NPO-1
# Test output is in .aam/runs/<run-id>/test.log.
```

```sh
aam review NPO-1 approve --note 'Diff and tests checked'
# Or: aam review NPO-1 reject --note 'Add a regression test for empty input'

git -C /absolute/path/to/npocut branch aam/integration main
aam merge NPO-1 --into aam/integration
aam worktree prune NPO-1
```

Merge requires an approved task and an existing non-base branch. It uses a temporary integration worktree, so the main checkout stays unchanged. Git refuses a target already checked out elsewhere. Pruning keeps the task branch and refuses to discard uncommitted changes. No command pushes.

`--depends NPO-1,NPO-2` gates dispatch until every listed task is `done`. Dependencies do not merge code into later task branches: each new task branch starts at the configured base. Plan integration and task descriptions accordingly.

## Continuous operation

```sh
aam daemon --interval 60
```

The daemon ticks immediately and then every interval, and schedules enabled cron routines. `init` creates a `heartbeat` routine every five minutes. SIGINT/SIGTERM stop the daemon while detached workers keep running; the next tick or daemon instance collects their results.

```sh
aam routine list
aam routine add --name nightly-tests --cron '0 2 * * *' \
  --action create_task \
  --payload '{"project":"NPO","title":"Run nightly test sweep","role":"testing","status":"ready"}'
aam routine add --name health --cron '0 * * * *' --action shell \
  --payload '{"cmd":"git status --short","cwd":"/absolute/path/to/npocut"}'
aam routine disable health
aam routine enable health
```

Cron uses the local timezone. Routine changes are reconciled at each daemon interval. Shell routines execute configured trusted commands and record output in events.

On macOS:

```sh
aam launchd install          # write and print plist; does not load it
aam launchd install --load   # also launchctl load
aam launchd status
aam launchd uninstall
```

The plist lives at `~/Library/LaunchAgents/com.aam.daemon.plist`, includes absolute Node/tsx paths, and runs from the user's home directory with absolute `AAM_HOME`. Output goes to `~/Library/Logs/aam/daemon.log` (the directory is created on install), keeping cwd and logs outside macOS privacy-protected folders. It includes `/opt/homebrew/bin` and `~/.local/bin` in PATH. Reinstall after moving the manager or changing the Node installation.

## Settings, recovery, and files

```sh
aam settings get
aam settings set max_parallel 2
aam settings set worker_timeout_min 45
aam settings set default_worker opencode
aam settings set review_mode claude
```

Defaults: two parallel workers, a 45-minute worker timeout, Codex, and manual review. Claude review mode invokes `claude -p` synchronously with a two-minute timeout. It parses the JSON verdict from Claude's `result`; an invalid response leaves the task in review and records an event. Manual review is always available.

A failed worker or failed project test increments attempts and retries up to `max_attempts` (default three), then blocks the task. Rejection also consumes an attempt. Worker logs indicating a usage/rate/quota limit return the task to `ready` without consuming an attempt and pause dispatch for 30 minutes. The next prompt includes feedback. Worktrees and branches are reused on retry; setup runs once per new worktree.

`aam run NPO-1` dispatches a backlog/ready task immediately, ignoring capacity. `--force` additionally bypasses dependencies. It still refuses duplicate running workers and respects cooldown.

Storage defaults to `./.aam`; set `AAM_HOME` to choose another location. Use the same value for all manager commands.

| Location                      | Contents                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `<home>/aam.db`               | Projects, tasks, runs, routines, events, settings                                       |
| `<home>/tick.lock`            | Heartbeat owner PID, with stale-owner recovery                                          |
| `<home>/worktrees/<key>/<ID>` | Task worktree on `aam/<ID>`                                                             |
| `<home>/runs/<run-id>/`       | `prompt.md`, `wrapper.sh`, `worker.log`, `exit_code`, optional `last.md` and `test.log` |
| `<home>/../BACKLOG.md`        | Tasks grouped by project and state; last 20 completed tasks                             |
| `<home>/../PROGRESS.md`       | Running work, cooldown, last 50 events                                                  |

Generated Markdown is overwritten each tick. `aam logs ID --run N` selects a database run ID; the default is the latest run. Setup, test, and shell routine commands are trusted shell configuration. Task text is passed through prompt files or direct process arguments.

## Claude Code as manager

Claude Code should read `BACKLOG.md` and `PROGRESS.md`, create focused tasks with acceptance criteria, assign priorities and dependencies, and promote tasks to `ready`. Workers perform implementation in their worktrees.

On each manager wake-up, run `aam tick`, inspect `aam task show ID`, the branch diff, and the run's test log. Approve finished work, or reject with specific actionable feedback. For blocked tasks, revise the scope or worker and move back to `ready` when appropriate. Choose non-base integration branches explicitly. The existing `CLAUDE.md`, when present, provides the manager's local operating instructions.

For unattended review, choose `review_mode=claude`; otherwise the daemon waits for the manager to review successful work.

## Local HTTP API

```sh
aam serve --port 3199
```

The JSON API binds only to `127.0.0.1`.

Non-GET API requests require `X-AAM: 1`, or an Origin/Referer from localhost/127.0.0.1 on the server port. Vite CORS is allowed only on port 5174 (localhost and 127.0.0.1), with `X-AAM` support. Errors are JSON `{ "error": "..." }` (400/403/404).

| Method | Path | Purpose |
| --- | --- | --- |
| GET, POST | `/api/projects` | Project counts/running totals; create project |
| PATCH | `/api/projects/:key` | Name, existing Git repo_path, base_branch, test_cmd, setup_cmd |
| GET, POST | `/api/tasks` | Filter by status/project; create task |
| GET, PATCH | `/api/tasks/:id` | Detail with runs/events/diff_stat/last_message; edit task |
| POST | `/api/tasks/:id/review` | `{verdict: "approve" or "reject", note}` |
| POST | `/api/tasks/:id/run` | Dispatch immediately, `{force?: boolean}` |
| POST | `/api/tasks/:id/merge` | `{into: "integration"}`; refuses base branch |
| POST | `/api/tasks/:id/cancel` | Kill worker group, fail run, block task |
| GET | `/api/runs?status=&task=&limit=50` | Newest runs with task/project and elapsed_s |
| GET | `/api/runs/:id/log?tail=100` | Worker log |
| GET | `/api/runs/:id/test-log?tail=100` | Test log |
| GET | `/api/status` | Live tick lock or heartbeat within 180s; daemon.last_tick_age_s, cooldown, concurrency, task counts |
| GET | `/api/stream` | SSE new `events` rows with IDs; Last-Event-ID or ?since=N resumes; ?replay=K replays the last K (default 0); ping every 20s |
| GET, POST, PATCH | `/api/routines` | List/create; legacy edit by id/name |
| PATCH, DELETE | `/api/routines/:id` | Edit or delete routine |
| POST | `/api/routines/:id/run` | Fire immediately |
| GET | `/api/routines/:id/runs` | Last 20 firings |
| POST | `/api/tick` | Run heartbeat |
| GET | `/api/events?limit=50` | Recent events |
| GET, PUT | `/api/settings` | Read/update settings |

Create tasks with `{project: "NPO", title: "Fix validation", status: "ready"}` (JSON keys must be quoted). Task paths accept identifiers or numeric IDs. PATCH supports status, priority, title, description, worker, role, max_attempts, depends_on (identifier array), and finite numeric sort_order. The deprecated sort alias maps to sort_order; seq remains unchanged. Lists sort by status (backlog, ready, in_progress, in_review, done, blocked, cancelled), sort_order, priority. Dependencies must exist and cannot introduce cycles. Moving blocked tasks to ready clears blocker and retains feedback. Dependency arrays remain JSON text in responses.

Routines require name, valid cron, action (heartbeat/create_task/shell), and object payload. Responses include next_run_at (null when disabled); PATCH accepts enabled, cron, name, payload and action. Firings are recorded independently of routine name. Settings PUT accepts an object such as `{"max_parallel":3}`.

The server serves ui/dist with SPA fallback for non-API GETs, content types, and immutable hashed assets. Before the UI is built it displays “UI not built — run npm run ui:build”. UI package commands: `npm run ui:install`, `npm run ui:build`, `npm run ui:dev`.

## Development

```sh
npm test
npm run typecheck
```

Vitest tests run offline against temporary SQLite databases and Git repositories, using executable fake workers and injected review runners. They cover adapters, ordering/dependencies, views, locks, lifecycle success/failure/retries, rate limits, timeout/lost processes, review, isolated merge/prune, CLI recovery, graceful daemon shutdown, routines, launchd plist generation, and HTTP operations. Tests are restricted to `tests/`; vendored Paperclip tests are excluded. Real worker CLIs are never needed.

See `NOTES.md` for implementation choices and delivery constraints.

Stop the daemon with `kill -TERM <pid>`; detached workers keep running and are reaped on the next start. Never kill the daemon’s process tree.

Reset retry accounting with `aam task edit <ID> --attempts 0` and replace feedback with `aam task edit <ID> --feedback-file feedback.txt`.

运行 `aam launchd install --load` 可安装并加载两个常驻服务：
`com.aam.daemon` 负责调度，`com.aam.ui` 提供 http://127.0.0.1:3199 的网页界面。
先运行 `cd ui && npm run build` 构建网页。UI 日志位于
`~/Library/Logs/aam/ui.log`。`aam launchd status` 显示两个服务的状态、PID 和上次退出码；
`aam launchd uninstall` 卸载两者。不加 `--load` 时仅写入 plist。
