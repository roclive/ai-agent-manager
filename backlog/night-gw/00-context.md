# 本地 LiteLLM 网关与夜间额度

新项目 /Users/zhangdapeng/Desktop/night/local-llm-gateway。本机 M1/16GB，已装 Ollama，ollama list 有 qwen3.5:latest 6.6GB、qwen2.5:1.5b 986MB，其余 :cloud 不是本地兜底。用户已确认模型：ConwayResearch/Underdog-Saluki-27B-1.0，官方仓库 https://huggingface.co/ConwayResearch/Underdog-Saluki-27B-1.0 。准确文件 Underdog-Saluki-27B-1.0-IQ2-mix.gguf，模型卡标称7.89GB，Apache-2.0。采用 llama.cpp / llama-server，Metal GPU，--jinja；不要照抄 HF 自动生成的 :F16 命令。仅下载这一个文本权重，不下载可选 mmproj。先核对官方文件元数据/哈希与当前 llama.cpp 架构支持，断点续传到用户缓存目录，不放Git。启动先用ctx 2048/单并发，依据实测再提高，不能照搬模型卡32768上下文。验证中文JSON判断、tool calling、非思考直接调用（chat_template_kwargs.enable_thinking=false，temperature=0），记录吞吐/首token/峰值内存/swap/OOM。若版本不兼容先升级独立运行器并复测，不静默换模型。llama-server绑定127.0.0.1，OpenAI兼容API接LiteLLM。下载已授权；不得只做配置不下载/不实测。若网络/磁盘/内存阻塞记录真实结果，不标部署成功。7.89GB 文件不等于总运行内存，须实测 KV cache、峰值 RSS、swap 与延迟。模型最大并发 1，避免与 NPO 生图争抢内存，压力大排队/卸载。

openusage=/opt/homebrew/bin/openusage，支持 export --output <path> --format json --source auto|daemon|direct。先核实输出 schema，仅存脱敏样本。Codex/Claude CLI 订阅额度由 AAM worker 路由处理；LiteLLM 只路由正式支持的 API，不伪造 OAuth 订阅代理。官方参考 https://docs.litellm.ai/docs/proxy/reliability 。只监控已配置且可访问的 provider，逐项显示覆盖与 unknown，不声称掌握全部免费额度。

共同约束：用户授权本轮升级与独立环境依赖安装。只在 AAM 工作树实现，不推送、不自动推广至 base、不改原始素材或正在运行的服务。先读适用 AGENTS.md 与项目文档。新增测试用 fake runner/provider，不能消耗真实编码工具或云额度；真实冒烟单列结果。所有模型/provider 名称以本机配置和官方文档核实，免费额度未知标 unknown，不能把花费估算当剩余额度。仅用用户已有账号和可用免费服务，不开通付费或额度耗尽后转付费。密钥不输出不提交。保留本轮前已有未提交改动。完成时记录命令、测试、限制与产物绝对路径。管理器分配的项目 test_cmd 必须通过；第一项先建立真实测试基础，后续不得用空测试伪造通过。


## 用户追加：Ollama 优先

用户追加确认 Ollama 发布包 https://ollama.com/sparksammy/Underdog-Saluki-27B-1.0 ，优先尝试 ollama pull sparksammy/Underdog-Saluki-27B-1.0。网页显示latest为8.3GB、标称256K，发布者sparksammy并非原作者ConwayResearch，不假定其量化与原7.89GB文件完全相同。下载前核对manifest元数据，下载后ollama show检查架构/参数量/量化/template/license，验证中文JSON与tool calling。实测num_ctx=2048、并发1，不使用256K默认上下文。若量化、模板或当前Ollama架构支持不匹配，优先从ConwayResearch下载准确IQ2-mix GGUF并尝试Ollama导入，仍不兼容才使用llama.cpp。避免同时下载/常驻两份权重；已有缓存先复用。其余内存/延迟/JSON/工具调用与LiteLLM接入验收不变。此条覆盖先前llama.cpp优先的要求。


用户最新指示：Saluki使电脑过慢，已停止测试并卸载内存。禁止自动加载Saluki或aam-saluki、禁止启用本地回退，须用户再次明确授权才恢复。今晚先使用已验证的免费云端编码后端，所有本地生图/模型任务必须避开重新加载Saluki。
