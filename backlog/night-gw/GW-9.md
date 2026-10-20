# 本地模型路由：auto 自动选择与 manual 固定模型

前置：AAM-39, AAM-62

用户最新要求（2026-10-20，覆盖旧模型/前置/验收表述）：本任务先依赖 AAM-39，统一以 mlx-community/LFM2.5-2.6B-4bit 原生 MLX 模型开展测试、配置示例和集成；复用 AAM-39 的真实加载及短文本生成证据。原来要求以 Gemma4 为默认测试模型、等待 AAM-38/AAM-60 或要求多个真实模型都通过的表述不再作为本任务前置。保留本任务原有功能验收；多模型配置/路由的自动测试仍可使用两个以上 fake 模型，但真实集成只需此 LFM 模型，不为凑模型数量另下载或启用未验证模型。模型 smoke 只证明加载和生成可用，编码、工具调用等能力必须按本任务实际验证，不可由 smoke 推断。内存压力、swap、缺少峰值监测均不能作为跳过 smoke 的理由；内存仅作观测，保留共享锁、单模型运行、硬超时和仅清理自有进程的要求。

依照AAM-62契约，仅修改GW：接入共享的已验证模型目录，暴露auto和manual/显式model_id。auto仅在通过验证、健康且满足请求能力的候选中选路，记录选择与回退原因；manual固定模型，不可用时明确错误，不静默切换。只有明确策略允许才fallback，禁止隐式付费fallback。复用契约中模型生命周期接口，不复制运行锁实现。
验收：fake providers覆盖两模型auto/manual、能力过滤、健康状态过期、无合格候选、固定模型不可用及可观测路由日志；保留现有云路由兼容性，交付API/配置示例。
共同约束：只启用有验证证据的本地模型；AAM-38已被用户中止，仅为llama.cpp/GGUF部分基线，不代表omlx/MLX SSD验证通过。不新增长benchmark，不重启AAM-38。自动测试使用fake runner/provider，不调用真实codex/opencode/claude或模型。保留用户取消强制内存门槛的决定。隔离工作树开发，读适用SPEC/AGENTS，不修改主检出或运行服务，不push，不提交模型/.aam/vendor/node_modules。各项目规定测试必须通过，AAM运行npm test及npm run typecheck，UI改动做适用UI检查；GW运行配置的unittest。当前仅创建backlog，不启动实施。
