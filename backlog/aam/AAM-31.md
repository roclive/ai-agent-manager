# 真实 smoke：opencode + omlx + LFM2.5-2.6B MLX 4-bit，冷/热缓存

前置：AAM-39, AAM-30

用户最新要求（2026-10-20，覆盖旧模型/前置/验收表述）：本任务先依赖 AAM-39，统一以 mlx-community/LFM2.5-2.6B-4bit 原生 MLX 模型开展测试、配置示例和集成；复用 AAM-39 的真实加载及短文本生成证据。原来要求以 Gemma4 为默认测试模型、等待 AAM-38/AAM-60 或要求多个真实模型都通过的表述不再作为本任务前置。保留本任务原有功能验收；多模型配置/路由的自动测试仍可使用两个以上 fake 模型，但真实集成只需此 LFM 模型，不为凑模型数量另下载或启用未验证模型。模型 smoke 只证明加载和生成可用，编码、工具调用等能力必须按本任务实际验证，不可由 smoke 推断。内存压力、swap、缺少峰值监测均不能作为跳过 smoke 的理由；内存仅作观测，保留共享锁、单模型运行、硬超时和仅清理自有进程的要求。

Force-run even with low free memory (record memory before/after). Run 3 trivial tasks through aam -> opencode -> omlx in a scratch project/worktree; record model identity, prefill/decode tokens/s, cache hit (cold vs warm), peak footprint, wall time, tests passed, and that omlx was stopped/unloaded after. Results in docs/local-llm-smoke.md. Restore owner/settings afterwards.

Context: user plan 2026-10-19 — run opencode + LFM2.5-2.6B MLX 4-bit via the omlx inference server (SSD KV cache) as a local coding worker to cut Claude usage and memory, and raise cache hits across a series of agent tasks. Constraints: never auto-start the model from health checks/planner; keep AAM-22 guards (single run, (no memory gate)); never kill aam daemon/UI, OntoKB api, Paperclip, Claude/Codex apps; no secrets; no weights/caches in git; tests use fakes (real smoke only in AAM-31).


UPDATE 2026-10-19 (user decision): the 12 GB free-memory gate is REMOVED (local_model_min_free_gb=0, no memory refusal anywhere). Workers must FORCE-run LFM2.5-2.6B MLX 4-bit. If loading/running fails or thrashes (OOM, timeout, swap storm), automatically retry in this order: (1) omlx with SSD offload of KV cache/paged cache and a lower per-model memory limit, (2) smaller context window (e.g. 8192), (3) lower concurrency/batch=1. Record which level succeeded. Keep only the single-run lock, process-group kill on timeout, and unload after idle. Never signal the deny-listed processes (aam daemon/UI, OntoKB, Paperclip, Claude/Codex/ChatGPT).

UPDATE 2026-10-19 (user): before EVERY gemma4 test/run, free as much memory as safely possible and record available memory before/after: (1) unload all local models (omlx unload/stop, ollama stop for every model in ollama ps), (2) stop stray helper processes of this project only (leftover codex/opencode/python test runners, old venv workers, idle omlx/launchd helper) via the AAM-26 helper (allow-list only; deny-list: aam daemon/UI, OntoKB, Paperclip, Claude/Codex/ChatGPT apps), (3) never run 'sudo purge' or anything needing a password; do not close the user's apps — if more is needed, report which big apps hold memory (footprint) and ask the user. Also free it again after the test (unload + same cleanup).
