UI polish found while browser-testing AAM-6, plus an always-on service for the UI. Shared UI context (00-ui-context.md) applies.

1. **Backlog table (`/backlog`)** is unreadable at ≤1024 px: the priority / worker / status `<select>`s are squeezed to a glyph
   ("P▾", "cod▾"). Give the columns sensible min-widths, put the table in a horizontally scrollable container with a sticky ID+title column,
   and make the selects show their full labels (Chinese labels for status/priority/worker). Keep it usable at 800 px wide.
2. **Routine create/edit dialog**: (a) when a required field is empty (name, cron, shell cmd/cwd, create_task title/project) show an inline
   red message under that field and focus it — currently the button silently does nothing; (b) server errors ("CronPattern: invalid…") render at the
   very bottom of a tall dialog and are off-screen: show them in a banner at the TOP of the dialog body and `scrollIntoView`; translate the common
   cron error to Chinese ("Cron 表达式无效，应为 5 或 6 段，例如 */5 * * * *"); (c) validate the cron client-side with a small 5/6-field check so the
   user sees the problem before submitting (server stays authoritative).
3. **Activity page**: show readable Chinese labels for event kinds (dispatch 派工, finalize 完成运行, review 审查, move 状态变更, edit 编辑,
   create 新建, routine_fire 定时触发, cooldown 冷却, cancel 取消, setup 准备, merge 合并, dependency_merge 合并依赖, …) with a coloured badge, and render
   JSON messages like `{"routine_id":1,"name":"heartbeat"}` as 「heartbeat」. Task identifier in each row links to `?task=ID`. Group by day.
4. **Dashboard review queue**: each in_review row shows the project key and a link to the drawer; approve/reject there must ask for confirmation
   (dialog with the note textarea) — one-click approve is too easy to hit by accident. Same confirmation for 立即运行 / 取消运行 / 删除 everywhere.
5. **Multi-project clarity**: show the project key (coloured chip) on Kanban cards and in the backlog table; the project switcher remembers the last
   selection (localStorage, try/catch). Several people/sessions may register projects in this aam; the UI must not assume only one.
6. **Always-on UI service**: extend `aam launchd` with a second agent `com.aam.ui` running `aam serve --port 3199` (same rules as the daemon plist:
   WorkingDirectory = home dir, logs in `~/Library/Logs/aam/ui.log`, absolute node path preferring /opt/homebrew/bin/node, RunAtLoad+KeepAlive,
   AAM_HOME env). Commands: `aam launchd install [--load]` installs/loads BOTH agents, `uninstall` removes both, `status` reports both
   (state, pid, last exit code). Never touch the real `~/Library/LaunchAgents` or call launchctl in tests — write plists to a temp dir via an injectable
   path/runner. Document in README that the UI is at http://127.0.0.1:3199.
7. Tests for each item (vitest, offline). `cd ui && npm run build` at the end; root `npm test`, `npm run typecheck`, `cd ui && npm test && npm run typecheck`.
