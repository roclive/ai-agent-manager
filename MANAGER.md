# 本机任务经理交接

用户已授权：接手所有项目，重点处理受阻、反复返工和验收不完整的任务；在本机无沙箱执行真实测试；持续无人值守。不要 push，不要修改受管项目主 checkout，不要自动提升到 base 分支。遵守 SPEC.md、AGENTS.md 和各项目规则。

## 持续运行

- 本聊天 heartbeat：`aam`（AAM 本机任务经理），每 15 分钟唤醒；只在实质进展、完成、失败或需要用户处理时通知。
- 本机 launchd：`com.aam.daemon`，60 秒调度；`com.aam.ui` 提供 127.0.0.1:3199。守护进程启动 caffeinate 防止空闲睡眠。
- worker/reviewer 已显式设置 `codex_worker_sandbox=danger-full-access`、`codex_reviewer_sandbox=danger-full-access`。不要改回只读，否则 worktree 外 Git 元数据和临时文件又会无法写入。
- 应用唤醒依赖 Codex 应用运行；launchd 依赖用户登录和机器供电。关机、断网、合盖等不能由本配置保证工作。
- 核对 `GET /api/status`、`GET /api/settings`、`launchctl list com.aam.daemon` 和真实进程参数。不要并存多个 daemon。运行中的 worker 是 detached 进程，停止 daemon 不代表停止 worker。

## 操作与验收

使用本机 CLI 或 API（写请求带 `X-AAM: 1`）；任务文本通过文件或结构化 API 传递。先看最新任务和事件再修改，避免与 worker 同时编辑同一个 worktree。需要手工修复时暂停派发/审核并确认实际进程；完成后恢复预算和 cooldown，重启服务加载新代码。

合并任务必须合入最新 `aam/integration` 和原始 `aam/<ID>`，保留双方功能，完成真正 merge commit，验证祖先关系，再跑完整测试。禁止用复制快照代替合并。系统已为此修正 worker 指令，新增 finalize 祖先检查，并在同项目有 active work/review 时延后冲突任务；其他项目仍可并行。

各项目只有 `status=done` 且集成开启时 `integrated=1` 才算解除依赖。审核不能以 worker 退出 0 代替测试证据；硬件未验证要明确记录。

## 已完成的本轮接手（2026-10-18 日本时间晚间）

- AAM：本机执行设置、冲突任务暂存/提交指令、祖先检查、同项目冲突任务串行；测试只用 fake worker。
- SB-14：补齐真实集成与 SB-3 合并，保留销售节奏和提醒回归；117 项本机测试通过，已批准并集成。
- TM-17：补齐真实集成与 TM-4 合并，保留课程、音频、SRS、QA；295 项本机测试通过，已批准并集成。
- SB-11：本机 48 项测试通过；仍需最新集成上的完整验收。
- SB-12：本机 85 项测试通过；最新审核另发现 carryover 并发丢完成状态，已回到 ready，需要修复并添加回归。
- TM-6：本机 267 项测试通过；待审核/集成。所有非确定性泰米尔语内容必须保留 reviewed:false，直到母语者审核。
- STR-1：检查原型范围，本机 12 项 CPU 测试通过，已批准；未声称真实 GPU 验证。
- STR-2：旧报告“没有代码”来自早期失败 run，最新 run 实际已实现 --hetero-gpu。已修正对 STR-1 的任务依赖，并真正合入加固后的 STR-1（a578227）；20 项原型测试在本机通过。正常 launcher 测试需要未安装的 torch，已退回 ready，要求保留正常测试并增加不依赖 torch/GPU/网络的真实模块注入测试通道。不要为此启动未经授权的外部硬件服务。

## 下一步优先级

1. 完成 SB-11、SB-12 及 TM-26 等冲突任务的本机修复、测试和集成；防止重复复制文件造成冲突循环。
2. 验收并集成 TM-6；推进每日学习、离线网页和内容审核工具。
3. 完成 STR-2 的可移植启动器测试；区别原型验收与真实 CUDA/ROCm 硬件验证。
4. SB 三个核心模块集成后推进复盘、网页看板与端到端验收。
5. 定期检查配额冷却、审核每日预算和权限；配额耗尽时退避，不能无限重试或直接批准来清空队列。

Python：`/opt/homebrew/Caskroom/miniconda/base/bin/python3`。AAM 修改完成必须 `npm test`、`npm run typecheck` 通过，并提交明确的本地 commit。所有临时数据、日志、worktree 保留在忽略目录中。
