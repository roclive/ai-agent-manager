# AAM 额度预警与多后端连续工作

在现有 TypeScript ESM strict 架构中扩展 OpenUsage 采集与 worker 路由。不要修改 SPEC.md/AGENTS.md/CLAUDE.md，必要差异写 NOTES.md。现有 tests 必须 AAM_FAKE_WORKER/injectable runners，禁调真实 codex/opencode/claude。不要修改原工作区已有未提交 integration.ts 及测试变更；在隔离工作树基于当前 base 实施。

用户授权在 Codex/Claude 额度耗尽前切到合法可用的 opencode 免费模型或本地 LLM，接入 OpenUsage。先核实 CLI 支持的 provider/model 参数及官方文档；不要新增不存在的 claude worker，worker 类型以当前实际实现为准。CLI worker 的切换由 AAM 做，通用 API 经 GW LiteLLM；本地模型要有实际工具执行 agent（可用 opencode），裸聊天回复不是完成编码。UI 显示剩余额度数据来源、采集时间、重置窗口、unknown 和当前选路原因。已运行任务不暴力中断；切换只在安全调度/重试边界，保留 worktree/feedback/attempts，按 provider cooldown，不因一家限流让所有 provider 停摆。

OpenAI 官方文档核对入口 https://developers.openai.com/codex/ 和 https://learn.chatgpt.com/ 。官方文档与 OpenUsage 实测优先，不把 API token 花费当 CLI 订阅剩余。

共同约束：用户授权本轮升级与独立环境依赖安装。只在 AAM 工作树实现，不推送、不自动推广至 base、不改原始素材或正在运行的服务。先读适用 AGENTS.md 与项目文档。新增测试用 fake runner/provider，不能消耗真实编码工具或云额度；真实冒烟单列结果。所有模型/provider 名称以本机配置和官方文档核实，免费额度未知标 unknown，不能把花费估算当剩余额度。仅用用户已有账号和可用免费服务，不开通付费或额度耗尽后转付费。密钥不输出不提交。保留本轮前已有未提交改动。完成时记录命令、测试、限制与产物绝对路径。管理器分配的项目 test_cmd 必须通过；第一项先建立真实测试基础，后续不得用空测试伪造通过。
