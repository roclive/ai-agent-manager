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

默认两个并行 worker、45 分钟执行超时和人工审查。项目启用自动审查后默认使用 Codex，后台运行最长 300 秒；可通过 reviewer 设置选择 Claude。无法解析的输出会保留任务待审并记录事件。始终支持人工审查。

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

无人值守审查需启用项目的 `auto_review`；`reviewer` 选择 Codex（默认）或 Claude。未启用的项目继续等待人工审查。

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

## 夜间自动驾驶

所有项目默认关闭自动审查和自动驾驶，迁移不会启用已有项目。按项目开启：

```sh
aam project edit AAM --auto-review on --autopilot on --goal-file goal.txt --rank 10 --context-file context.md
aam autopilot status
aam daemon --interval 60
```

`--goal` 可直接设置目标（与 `--goal-file` 互斥）；共享上下文文件路径相对项目仓库，每次规划时读取并前置到新任务描述。优先级数值越小越先补充任务，同优先级项目轮流获得空位。依赖未完成的任务不会提升，受阻任务不影响其余工作。空队列且目标非空时生成 3–5 个小任务；成功规划至少间隔 20 分钟，失败后退避 30 分钟。

自动审查只处理明确启用的项目，不会合并或推送。测试失败直接拒绝；连续两次自动拒绝会阻塞任务。无法解析的审查输出重试一次；后台 reviewer 作业最长 300 秒，由后续 heartbeat 回收。审查按设置的并发数启动。每日预算按本机日期计算，默认审查 120 次、规划 10 次，可在设置页面或 CLI 调整：

```sh
aam settings set auto_review_daily_max 120
aam settings set planner_daily_max 10
aam settings set keep_awake 1
```

守护进程在 macOS 使用 `caffeinate -i -m -w <pid>` 保持唤醒，退出时释放。电池供电时合盖睡眠无法阻止，请保持开盖并连接电源。仪表盘「夜间自动驾驶」显示预算、提升数量、空闲时间及唤醒状态。

关闭时，对每个已启用项目执行以下命令；开关关闭后待回收的模型结果也不会应用：

```sh
aam project edit AAM --auto-review off --autopilot off
aam settings set auto_review_daily_max 0
aam settings set planner_daily_max 0
aam settings set keep_awake 0
```

全局 `review_mode` 保留为兼容设置；自动驾驶始终要求项目明确启用自动审查，其他项目仍需人工审查。

### 集成分支

项目默认关闭此功能。运行 `aam project edit KEY --integration on`，从基础分支创建
`aam/integration`；`--integration off` 关闭后保留分支。新任务从集成分支创建，审批通过后自动合入。
冲突会创建 P0「Resolve merge conflict」任务；原任务保持完成并显示「待集成」。
解决任务必须保留双方意图、运行项目测试并提交合并；同一原任务最多创建两个解决任务，超限后受阻并记录事件。
自动集成始终使用临时工作区，不修改基础分支。

只有显式执行 `aam project promote KEY --yes [--into main]`，或调用
`POST /api/projects/KEY/promote` 并提交 `{"confirm":true}`，才合并到配置的基础分支。
设置页可预览提交并确认合并。基础分支工作区存在未提交修改时拒绝操作；推广冲突会中止合并。

开启集成时，会按完成时间依次回填已有分支的完成任务，并输出已集成、待集成、跳过数量。
已是集成分支祖先的提交直接标记成功；存在未完成冲突解决任务的任务会跳过。
依赖任务必须完成且已集成，后续任务才会被派发；看板卡片提示等待原因。

每次 tick 会重试未集成的完成任务，使用带失效 PID 检测的
`<home>/integration.lock` 串行合并，避免 CLI 审批与 daemon 同时操作。
非冲突失败累计 5 次后记录 `integration_blocked` 并停止自动重试，需人工检查 Git 状态和错误事件；
修复后可在数据库将该任务的 `integration_attempts` 重置为 0，以恢复重试。
冲突继续走 P0 解决任务流程。

### Reviewer 登录健康检查

运行 `aam autopilot check`，使用自动驾驶相同的参数和最小环境调用所选 reviewer，
输出 ok/error 和结果前 200 字符，失败时退出码为 1。
daemon 启动时异步检查，健康时每 30 分钟、失败时每 2 分钟重查，不阻塞 tick；检查超时为 90 秒。
Codex 从 `last.md` 读取 `ok`；Claude JSON 中 `is_error:true` 即使退出码为 0 仍算失败。
检查失败或尚未检查时，不启动新审查和规划，也不消耗对应每日预算。
状态 API 和仪表盘显示检查时间、错误及暂停提示；失败记录限频的
`autopilot_paused`，恢复后记录 `autopilot_resumed`。
若提示未登录，请在运行 daemon 的同一用户环境中执行所选 CLI 的登录，再运行检查。
测试用 `AAM_FAKE_CODEX` / `AAM_FAKE_CLAUDE` 指向本地可执行脚本，无需真实模型调用。

Auto-review fills up to `auto_review_concurrency` slots in each heartbeat (default
3, configurable from 1–5 in Settings or `aam settings set auto_review_concurrency 3`).
Oldest waiting reviews run first, with project rank breaking ties. Daily budgets,
Reviewer health checks and test requirements still apply. Missing results expire after
360 seconds (300-second execution timeout plus wrapper grace); ETIMEDOUT retries become eligible after 20 seconds. Three consecutive
timeouts pause that task's reviews for 30 minutes without pausing other tasks.
Retries run on the next heartbeat after their delay; use a shorter daemon interval
if needed. Passed-test review diffs are capped at 30 KB; all changed names and diff
stats remain visible, and files larger than 20 KB on either side are listed by name
and size instead of inlined. Status/dashboard expose `waiting_for_review`; unfilled
worker capacity with waiting reviews emits `review_bottleneck` at most every 15 minutes.

### 自动驾驶审查模型

自动审查、规划和健康检查默认使用 `codex exec`，以只读模式读取仓库。
可通过设置页的「审查与规划模型」切换，或运行：

```sh
aam settings set reviewer codex
# 可选：使用 Claude
aam settings set reviewer claude
aam autopilot check
aam autopilot status
```

切换模型后需重新通过健康检查。Codex 使用当前用户的登录信息（支持
`CODEX_HOME`），与编码 worker 共享额度；触发额度限制后冷却 30 分钟再重试。
新安装默认每日自动审查上限为 120，规划上限为 10；已有配置保持原值。
健康失败时暂停 LLM 作业，每 2 分钟重查；健康时每 30 分钟重查。

## 编码执行器（coding executor）与审查者（reviewer）

- `coding_executor`（全局，默认 `auto`）、项目级 `coding_executor`、任务级 `executor`；解析顺序：任务 > 项目 > 全局 > `auto`。
  可选值：`auto`（按配额路由）、`codex`、`claude`（scripts/claude-worker.sh，sonnet）、`opencode`、`opencode-local`（本地 gemma4）、`pi`、`hermes`（Hermes Agent，未安装则下拉禁用并显示安装提示，aam 不会自动安装）。
- 所有自动路径（首次派发、自动审查驳回后重派、冲突解决任务、空闲补充/规划任务、重试）都在派发时解析该设置。
- 选定执行器限流时只冷却它自己（按执行器的熔断器），不会静默回退到 Codex；只有用户设置了 `executor_fallback`（逗号分隔列表）才会按列表回退，否则任务保持就绪等待。
- `reviewer` 是另一个独立设置：只决定自动审查/规划由谁执行，与编码执行器无关。
- 命令：`aam settings set coding_executor claude`、`aam task edit <ID> --executor pi`；API：`GET/PUT /api/executors`。
