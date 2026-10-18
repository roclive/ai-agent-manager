# 本地 LiteLLM 网关与夜间额度

新项目 /Users/zhangdapeng/Desktop/night/local-llm-gateway。本机 M1/16GB，已装 Ollama，ollama list 有 qwen3.5:latest 6.6GB、qwen2.5:1.5b 986MB，其余 :cloud 不是本地兜底。用户指定“7.89GB、27B”，名称仍待确认，不准猜测或静默替代。先建立可运行本地后端与可配置模型，待确切 model ID/量化/来源确认再下载指定权重，记录阻塞而不阻断其他开发。7.89GB 文件不等于总运行内存，须实测 KV cache、峰值 RSS、swap 与延迟。模型最大并发 1，避免与 NPO 生图争抢内存，压力大排队/卸载。

openusage=/opt/homebrew/bin/openusage，支持 export --output <path> --format json --source auto|daemon|direct。先核实输出 schema，仅存脱敏样本。Codex/Claude CLI 订阅额度由 AAM worker 路由处理；LiteLLM 只路由正式支持的 API，不伪造 OAuth 订阅代理。官方参考 https://docs.litellm.ai/docs/proxy/reliability 。只监控已配置且可访问的 provider，逐项显示覆盖与 unknown，不声称掌握全部免费额度。

共同约束：用户授权本轮升级与独立环境依赖安装。只在 AAM 工作树实现，不推送、不自动推广至 base、不改原始素材或正在运行的服务。先读适用 AGENTS.md 与项目文档。新增测试用 fake runner/provider，不能消耗真实编码工具或云额度；真实冒烟单列结果。所有模型/provider 名称以本机配置和官方文档核实，免费额度未知标 unknown，不能把花费估算当剩余额度。仅用用户已有账号和可用免费服务，不开通付费或额度耗尽后转付费。密钥不输出不提交。保留本轮前已有未提交改动。完成时记录命令、测试、限制与产物绝对路径。管理器分配的项目 test_cmd 必须通过；第一项先建立真实测试基础，后续不得用空测试伪造通过。
