# Saluki 27B IQ2-mix 下载、llama.cpp 部署与M1验收

用户已确认模型：ConwayResearch/Underdog-Saluki-27B-1.0，官方仓库 https://huggingface.co/ConwayResearch/Underdog-Saluki-27B-1.0 。准确文件 Underdog-Saluki-27B-1.0-IQ2-mix.gguf，模型卡标称7.89GB，Apache-2.0。采用 llama.cpp / llama-server，Metal GPU，--jinja；不要照抄 HF 自动生成的 :F16 命令。仅下载这一个文本权重，不下载可选 mmproj。先核对官方文件元数据/哈希与当前 llama.cpp 架构支持，断点续传到用户缓存目录，不放Git。启动先用ctx 2048/单并发，依据实测再提高，不能照搬模型卡32768上下文。验证中文JSON判断、tool calling、非思考直接调用（chat_template_kwargs.enable_thinking=false，temperature=0），记录吞吐/首token/峰值内存/swap/OOM。若版本不兼容先升级独立运行器并复测，不静默换模型。llama-server绑定127.0.0.1，OpenAI兼容API接LiteLLM。下载已授权；不得只做配置不下载/不实测。若网络/磁盘/内存阻塞记录真实结果，不标部署成功。

GW-1已经运行，本任务承接用户新确认的模型身份，纠正此前pending状态。遵守00-context.md共同约束与资源协调要求。部署脚本与测试在隔离工作树实现；权重放外部用户缓存。


## 用户追加：Ollama 优先

用户追加确认 Ollama 发布包 https://ollama.com/sparksammy/Underdog-Saluki-27B-1.0 ，优先尝试 ollama pull sparksammy/Underdog-Saluki-27B-1.0。网页显示latest为8.3GB、标称256K，发布者sparksammy并非原作者ConwayResearch，不假定其量化与原7.89GB文件完全相同。下载前核对manifest元数据，下载后ollama show检查架构/参数量/量化/template/license，验证中文JSON与tool calling。实测num_ctx=2048、并发1，不使用256K默认上下文。若量化、模板或当前Ollama架构支持不匹配，优先从ConwayResearch下载准确IQ2-mix GGUF并尝试Ollama导入，仍不兼容才使用llama.cpp。避免同时下载/常驻两份权重；已有缓存先复用。其余内存/延迟/JSON/工具调用与LiteLLM接入验收不变。此条覆盖先前llama.cpp优先的要求。
