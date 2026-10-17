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

| Method           | Path                         |
| ---------------- | ---------------------------- |
| GET              | `/api/projects`              |
| GET, POST        | `/api/tasks`                 |
| GET, PATCH       | `/api/tasks/:id`             |
| GET              | `/api/runs/:id/log?tail=100` |
| GET, POST, PATCH | `/api/routines`              |
| PATCH            | `/api/routines/:id`          |
| POST             | `/api/tick`                  |
| GET              | `/api/events?limit=50`       |
| GET, PUT         | `/api/settings`              |

Task lists accept `?status=ready&project=NPO`. Create a task with `{"project":"NPO","title":"Fix validation","status":"ready"}` and optional task fields such as `description`, `priority`, `role`, `worker`, and `depends_on` (an array of identifiers). Task paths accept identifiers or numeric database IDs. PATCH supports status, priority, title, description, worker, and numeric `sort` (positive sequence within priority). Dependency fields in database responses are JSON text.

Create routines with `name`, `cron`, `action`, and an object `payload`. PATCH `/api/routines` identifies an existing routine by `id` or `name`; the path variant also supports renaming. PUT settings accepts an object such as `{"max_parallel":3}`. Errors return `{ "error": "..." }` with status 400 or 404.

## Development

```sh
npm test
npm run typecheck
```

Vitest tests run offline against temporary SQLite databases and Git repositories, using executable fake workers and injected review runners. They cover adapters, ordering/dependencies, views, locks, lifecycle success/failure/retries, rate limits, timeout/lost processes, review, isolated merge/prune, CLI recovery, graceful daemon shutdown, routines, launchd plist generation, and HTTP operations. Tests are restricted to `tests/`; vendored Paperclip tests are excluded. Real worker CLIs are never needed.

See `NOTES.md` for implementation choices and delivery constraints.

Stop the daemon with `kill -TERM <pid>`; detached workers keep running and are reaped on the next start. Never kill the daemon’s process tree.

Reset retry accounting with `aam task edit <ID> --attempts 0` and replace feedback with `aam task edit <ID> --feedback-file feedback.txt`.
