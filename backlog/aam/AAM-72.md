## AAM-39 补强：下载并验证 LFM2.5-8B-A1B MLX 4-bit

专门补强 AAM-39 中因 4GB 下载上限而未能开展的 LFM2.5-8B-A1B 实测。用户已明确将该模型文件集下载上限提高到 8GB，并指定 MLX 4-bit 构建：`mlx-community/LFM2.5-8B-A1B-MLX-4bit`。

1. 通过 Hugging Face API 再核对仓库、revision、许可及完整文件清单/总大小；下载仅限这个模型的运行必需文件，单文件集上限 8GB。权重约 4.76GB，在用户缓存（HF/omlx 模型缓存）中下载，禁止写入仓库或 git。记录精确 revision 与文件大小；若需下载总量超过 8GB，先停止并记录，不扩展上限。
2. 下载前确认缓存中是否已有该 revision 或在进行中的下载，避免重复下载/并发占用；遵守 AAM-26 清理规则，记录测试前后内存，不用 sudo purge，不停止用户应用或 deny-listed 进程。
3. 使用已安装并验证的原生 MLX/omlx 环境，先单 worker、单进程做有硬超时的模型加载和短文本生成；保存命令、后端确认、首 token/生成耗时、错误及内存观测。不得仅凭架构模块可导入就报告加载成功。
4. 若加载和短 smoke 成功，再按 AAM-39 的固定 benchmark 与可用的 Gemma4 E4B 证据作顺序评测，记录通过率、工具调用有效性、速度、TTFT、内存和缓存行为。若对照证据不可用，明确列缺项，不虚构结论。
5. 更新 `docs/local-model-eval.md` 和 AAM-39 结果摘要，说明此次解除的只是该 8B MLX 4-bit 文件集上限；不更改 2.6B 或其他候选模型的下载上限，不擅自启用自动路由或作生产推荐。

约束：仅操作此模型与项目辅助进程；保持单运行锁、硬超时、进程组清理；不得触碰 AAM daemon/UI、OntoKB、Paperclip、Claude/Codex/ChatGPT 等 deny-listed 进程；不提交模型权重。
