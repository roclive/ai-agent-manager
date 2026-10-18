# 本机任务经理交接

用户已授权：接手所有项目，重点处理受阻、反复返工和验收不完整的任务；在本机无沙箱执行真实测试；持续无人值守。不要 push，不要修改受管项目主 checkout，不要自动提升到 base 分支。遵守 SPEC.md、AGENTS.md 和各项目规则。

## 持续运行

- 额度兜底已获用户授权并开启：`ollama_fallback_enabled=1`，主后端 `llm_backend=primary` 沿用现有 CLI 默认模型。备用 `ollama_model=gemma4:31b:cloud`、`ollama_base_url=http://127.0.0.1:11434/api/codex/v1`，已真实执行工具并返回 OK。这是 Ollama 云模型，不是离线推理；当前套餐拒绝 kimi-k3:cloud，不要尝试购买或升级。
- 每次唤醒先调用 get_usage_limits；任一窗口已用达到90%或明确额度耗尽时设 `llm_backend=ollama`。任务执行、审核、规划与健康检查的额度错误也会自动触发切换；旧主模型并发失败不会暂停备用模型。切换不扣任务尝试次数，备用也限流时才保留30分钟退避。主模型恢复且所有可见窗口已用低于70%、健康检查通过后才能切回；不要消费重置券。当前聊天模型由应用控制，不要把队列切换说成聊天模型已切换。

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

### 2026-10-18 22:38 JST 唤醒记录

- Codex 可见额度已用29%，普通使用正常；未触发90%切换阈值。`llm_backend=primary`，Ollama兜底已开启。单个 launchd daemon、caffeinate、3个 worker 正常，未发现 blocked；不要中断正在修复 BGM-2 的 worker。
- 接手 NPO-11 的误拒：审核器误将 GPT Image 2.5 按 DALL·E 规范要求改成 response_format，并声称图片 API 不返回 token usage。已核对官方 Create image API reference：output_format 支持 GPT Image，GPT Image 返回 base64、不支持旧 response_format，官方示例含 usage。
- 在确认无 worker 后将 NPO-11 暂存 backlog 作为管理租约，补充请求参数/usage契约断言和模型文档；本机完整79测试通过，提交 `11ae025`。NPO-10 原始真实 smoke PNG 存在，SHA-256 与记录一致；未进行额外付费 API 调用。
- 在 tick 锁内撤销这次无效拒绝消耗的1次尝试、写入 manager_review_correction 证据并人工批准 NPO-11；已成功集成，解除 NPO-12 前置依赖。保留 API 文档证据，避免同一错误再次返工。
- 本轮 AAM 107项测试和类型检查通过。BGM-2 的测试回归仍由现有 worker 处理；NPO-13 正在审核；TM-6 的词性/例句问题仍待处理。

### 2026-10-18 22:22 JST 唤醒记录

- 唤醒已实际触发；launchd 单实例、caffeinate、Codex full-access 及配额退避设置正常。审核预算 120，目前约 83 次，未遇配额冷却。
- 找到剩余冲突循环根因：reconcile 反复合入旧的 done/unintegrated 解决分支，即使更新的解决分支已集成。已修复 reconcile 和显式 integrate 两条路径：必须确认较新的同源解决分支确实在 integration 历史中，才跳过旧分支；保留旧分支和真实 integrated=0。
- 已核对原分支是 integration 的祖先，取消尚未启动、没有 worktree 的重复 SB-16、TM-31、TM-32。不要重新启动这些重复项。
- SB-12 已完成 carryover 并发修复并集成；本轮在其稳定 worktree 重跑完整测试：203 passed。SB-15 审核新发现营销 log 与 replan 并发问题，worker 正在修复；不要同时编辑。
- TM-29 已集成第 5–12 周语法；本轮稳定 worktree 重跑完整测试：299 passed。TM-30 仍在审查。TM-6 被退回，需修复副词被机械套成名词例句的问题，不能因 reviewed:false 忽略明显错误。
- STR-2 已完成可移植启动器测试并获批准。本轮独立执行配置命令：38 passed（一个既有 pytest asyncio_mode 配置警告）；无需 torch/GPU/网络。真实 GPU 和原生依赖集成仍未验证。
- SB-3/4/5 当前均已集成，已将 SB-6 周复盘和 SB-7 网页看板提升到 ready。NPO 出现另一聊天安排的新一轮任务（NPO-9～18），保持用户最新队列和目标，不覆盖其配置。

1. 完成 SB-11、SB-12 及 TM-26 等冲突任务的本机修复、测试和集成；防止重复复制文件造成冲突循环。
2. 验收并集成 TM-6；推进每日学习、离线网页和内容审核工具。
3. 完成 STR-2 的可移植启动器测试；区别原型验收与真实 CUDA/ROCm 硬件验证。
4. SB 三个核心模块集成后推进复盘、网页看板与端到端验收。
5. 定期检查配额冷却、审核每日预算和权限；配额耗尽时退避，不能无限重试或直接批准来清空队列。

Python：`/opt/homebrew/Caskroom/miniconda/base/bin/python3`。AAM 修改完成必须 `npm test`、`npm run typecheck` 通过，并提交明确的本地 commit。所有临时数据、日志、worktree 保留在忽略目录中。
