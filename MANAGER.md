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

手工修复后送自动审核，必须为当前提交真实执行测试，并把命令、SHA、日志和返回码登记为新的 `manager-validation` run（原失败run保持不变）；只写event或feedback不会替换自动审核读取的最新test_exit_code。禁止直接把旧失败run改为成功，也不能仅写in_review跳过测试证据。

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

### 2026-10-18 23:55 JST 唤醒记录

- 可见额度仍32%，普通使用正常，显式Ollama云路由健康，单daemon79478与caffeinate79480正常；heartbeat aam仍ACTIVE，未重启既有worker，GW-7暂停不变。跨午夜审核预算将按本地日自然归零，不手工增加120上限。 本轮AAM110项离线测试、typecheck通过。
- BGM-3自动审核已在14:43批准并集成，但经理复核发现明确边界缺口。无worker时先blocked租约；先新增4条回归并真实看到全部失败：相同曲目跨block合并16秒超过可用10秒、2秒block/2秒track突破3秒cue下限、静默移位产生1秒cue。
- 提交0883fc6修复累计merge时长、所有时长/静默/冷却变换后重新校验cue下限、移位/截短后重查对白保护及淡入淡出边界；另补冷却移入对白和无效/非有限时长回归。完整28测试通过。登记独立manager-validation run162，提交SHA0883fc6，送回in_review并置integrated=0（旧版历史仍在integration），尝试保持2；待正常审核，未直接批准。
- AAM-16/GW-4仍由现有worker处理。AAM-16持续测试修复、GW-4正在修复python -m litellm无__main__导致的proxy测试启动失败；不要同时改动其工作区。全局规划DP与实际CLI接入仍应由BGM-3审核单独核实，不能把28测试或TTS smoke等同于全部需求通过。

### 2026-10-18 23:42 JST 唤醒记录

- Codex额度32%、普通使用正常；Ollama云端路由保持，不切回primary。发现launchd长期运行的daemon仍保留旧llmArgs（仅根级openai_base_url），对daemon PID86927发SIGTERM使其正常退出后由launchd重启为79478；AAM-16/GW-4既有worker PID45294/45296/74546/74548均继续存在，没有重启。新健康检查实际参数含named aam-fallback provider、danger-full-access、approval_policy=never；首次瞬时超时后自动复查在14:41:57Z返回ok。
- BGM-3上轮22测试通过，但经理只写event并置in_review，没有登记新run；auto-review按设计读取旧run157失败返回Tests did not pass。这次先取得blocked租约，在tick锁内真实重跑22测试，提交SHA32c55b15，登记独立manager-validation run159及 `.aam/manager-validation/BGM-3/1792334481676/test.log`。保留run157原失败，将仅因证据遗漏消耗的尝试3→2恢复，审核预算不回退，重新送in_review；仍须实质功能审核，未直接批准。
- 不修改正在工作的AAM-16/GW-4工作区；GW-7人工暂停继续保留。持久唤醒、caffeinate、并发2/审核1、额度兜底开关1和无cooldown均正常。AAM本轮110项离线测试与类型检查通过。

### 2026-10-18 23:32 JST 唤醒记录

- Codex已用32%，普通使用正常，继续保留已验证的显式Ollama云端路由；不恢复旧primary错误路由。唤醒aam仍ACTIVE/15分钟，launchd/UI/caffeinate正常，全权限worker保持，不触碰GW-7人工暂停。
- 接手无worker的BGM-4（blocked管理租约）。修复Python3.13 dataclass动态导入后发现时间戳回归及渲染器大规模功能丢失，恢复当前integration实现，再真正接入共享Edge适配层。MP3明确转PCM WAV、校验缓存、隔离配置、重试/局部say回退、失败终止混音，原渲染器/OpenAI/say/manifest/批处理保留。提交adf9605，真实merge97c66fd，证据6c9759a；完整12项离线测试通过，已在tick锁内批准并集成，尝试数2不重置。
- 中日真实Edge短句分别2.928/3.816秒；完整渲染器实际输出一条2.928秒cue，含停顿最终WAV3.378秒。产物 `.aam/bgm4-tts-smoke`。Homebrew ffmpeg动态链接缺libx265.216，npocut bundled版本也缺动态库；使用已安装正确4.2库的进程级 `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/Cellar/x265/4.2/lib` 验证成功，未修改任何系统库或全局环境。后续本机真实音频执行须保留该作用域环境或修复Homebrew。未做人声听感或真实BGM素材验收。
- 同时定位BGM-3真实测试无限循环占用CPU和tick锁：对白保护边界赋同一值却再次changed=True。短暂暂停派发并仅终止卡死的测试PID24410，获取租约后恢复派发；没有终止其他worker。以有界排序区间扫描替代while，淡入淡出保留对白保护窗口，新增恰好边界与重叠窗口回归，提交d930256；真实合入BGM-4/integration提交32c55b1，完整22测试通过。送回in_review正常审核，保留尝试2；全局优化、冷却/时长和CLI集成仍必须严格审核，未直接批准。
- AAM本轮110项离线测试与typecheck通过。保持并发2/审核1、每日审核预算120；不因剩余任务多而绕过验收或任意加预算。

### 2026-10-18 23:10 JST 唤醒记录

- 可见 Codex 额度已用32%，普通使用正常。本轮不是额度耗尽触发切换；排查到审核健康检查连续90秒超时，默认 CLI 模型为 gemma4:31b:cloud，但未配置 model_provider，根级 openai_base_url 不能保证覆盖账号路由。
- AAM 的 ollama_fallback_enabled 当时为0。恢复本聊天已授权的云端兜底开关并设置 llm_backend=ollama，使用现有显式 aam-fallback provider 指向本机 Ollama 云网关；真实 `aam autopilot check` 返回 ok，14:09:57Z reviewer_ok=true，14:10 已重新开始 MUD-3 审核（审核预算100/120）。此切换修复路由故障，不代表当前聊天模型改变。
- 没有重启既有 AAM-16/BGM-4 worker；真实参数仍为 danger-full-access、approval_policy=never。保留 GW-7 人工暂停，不加载 Saluki，不下载任何模型；本机入口调用的是 gemma4 云模型。
- 修复后 MUD-3 审核实际完成并退回 ready：指出未知房间仍继续执行、固定路由未接入 BFS 两项实质缺口；保留反馈交给正常 worker 修复，未直接批准。AAM 本轮完整离线测试110项通过，类型检查通过。
- launchd daemon/UI 单实例与 caffeinate 正常；heartbeat aam 仍可查看。内存空闲已回升63%，暂时保留 worker并发2/审核1，先确认队列稳定；无额度退避。后续所有可见额度<70%且主路由健康验证通过后再恢复primary，不能仅因当前额度低就切回错误路由。

### 2026-10-18 23:04 JST 唤醒记录

- 额度已用30%，主后端继续运行，未触发切换。守护进程、唤醒和 Ollama 兜底正常。
- 直接接手等待执行的 TM-6：先确认无 worker，以 blocked 管理租约防止 autopilot 抢占。修正整个扩展时间主题中4个副词（每天／以前／很快／总是）被标为名词并套“这是……”例句的问题，补充 Anki 导出回归；原分支268测试通过。词条与例句保持 reviewed:false，不把 AI 草稿视为母语者审核。
- 同步最新 integration 时发现实质兼容缺陷并修复：audio vocab 参数变量遮住 vocab 模块；普通短语被当成 cloze 导致 KeyError；主题牌组目录与 SRS 在同一个 review.sqlite3 创建不兼容 cards 表。目录改用 decks.sqlite3，实际复习从核心/扩展词库和短语创建双向卡，只有明确 cloze 字段生成填空卡，新增跨目录/复习状态保留测试。
- 合并后的完整 TM 测试306项通过；提交 `221c0a3`（内容纠正）、`6f1ffb6`（真实集成及兼容修复），人工批准且已集成 TM-6，保留原有效拒绝的1次尝试。TM-8、TM-9 前置依赖解除并提升 ready。
- 本机并发测试一度明显退化：内存空闲14%、大量历史 pageouts，同时有本地 Metal 模型编译，AAM 多个测试仅因15秒时限失败。未放宽断言或超时；将新 worker 上限3→2、审核并发3→1，现有 worker 不中断。`npm test -- --maxWorkers=1` 随后110项全部通过。下一轮结合 GW-7 模型验证、真实内存压力与测试耗时再评估恢复并发，不要不加判断立即改回3。
- 不要改动正在运行的 AAM-16、BGM-4 工作区；其最新任务与反馈以数据库为准。继续跟进 NPO-13 的真实后端状态/UI 配置问题、BGM-3 的落点/淡入淡出/有界优化缺口。
- 收尾时 GW-7 被人工标记 blocked，blocker 明确为“用户要求卸载Saluki、停止本地测试；未经再次授权不得加载模型”。这是用户暂停约束，不是需要自动重试的技术故障；必须保留，不得重新拉取、加载或测试 Saluki。此约束不改变已验证的 Ollama 云端 gemma4 额度兜底。

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

## 低额度兜底交接（opencode + gemma4:e4b-mlx）

- Claude 额度不足 → 将 `.aam/manager-owner` 写为 `opencode-fallback`（或设置 `fallback_active=1`），且 `fallback_worker=opencode`；此后任务经 opencode 适配器以 `opencode_fallback_model`（默认 `ollama/gemma4:e4b-mlx`，即 `opencode run --format json --dir <worktree> -m <model>`）派发。Claude 恢复 → 将 owner 写回 `claude`（并清除 `fallback_active`）。
- 不再使用 Codex 跑 gemma4（缺模型元数据、无输出）。小模型不自动批准审查：沿用现有质量门槛，测试必须通过，含糊的审查保持 `in_review` 交给人工/Claude。
- 本地模型保护：gemma4:e4b-mlx 常驻约 9.4 GB。已移除内存门槛（`local_model_min_free_gb` 默认 0，0 或未设置 = 不因内存拒绝；`vm_stat` 不可读也不阻塞派发）。仅保留：同一时刻最多一个本地模型 run（单次运行锁，占用时任务保持 `ready` 并记录限频事件 `local_model_waiting_memory`）；启动前记录信息级事件 `local_model_memory`（可用内存，仅供参考）；run 结束（含超时/丢失）后与守护进程启动时（无活跃 run）执行 `ollama stop gemma4:e4b-mlx`；超时杀整个进程组。健康检查和规划器绝不自动加载该模型。
- opencode 的 Ollama provider 由启动器按进程注入（`OPENCODE_CONFIG_CONTENT`：`@ai-sdk/openai-compatible`、`baseURL http://127.0.0.1:11434/v1`、`limit.context 32768`），不依赖也不修改 `~/.config/opencode/opencode.jsonc`。若想在手动使用 opencode 时也可选该模型，可自行在该文件的 `provider.ollama` 下加入相同内容（先备份）。
