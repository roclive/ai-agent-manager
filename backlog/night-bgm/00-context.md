# BGM 评分、配乐与成片升级

项目 /Users/zhangdapeng/Downloads/BGM挿入，本轮建立源码 Git 基线 main，媒体/表格未入库，测试 fixture 必须人工合成小样本。现有 annotate_bgm_full.py 为规则路径；annotate_bgm_byLLMv2.py 为 LLM 打分与 TOP3；util scripts/ 包含 render_audio_drama.py、generate_japanese_audio_drama_10blocks.py、generate_bilingual_subtitle_video_10blocks.py。现有默认 ROOT 指向父目录，工作树中必须改为显式可配置数据目录并保持兼容，不能擅自遍历 Downloads。

用户要更有意义的评分与 BGM 插入时机、更好的 Edge TTS、MP4 质量。复杂度必须能解释并通过消融/对比验证；不能只增加随机分数或标签。保持原 CSV 日文字段兼容，新增 schema 版本与配置。不得修改原始音乐/视频/Excel。真实样片仅使用已获准可用本地素材，素材缺失则使用合成测试音频并明确标注。本地 LLM/gateway 可选，规则默认能独立运行。

共同约束：用户授权本轮升级与独立环境依赖安装。只在 AAM 工作树实现，不推送、不自动推广至 base、不改原始素材或正在运行的服务。先读适用 AGENTS.md 与项目文档。新增测试用 fake runner/provider，不能消耗真实编码工具或云额度；真实冒烟单列结果。所有模型/provider 名称以本机配置和官方文档核实，免费额度未知标 unknown，不能把花费估算当剩余额度。仅用用户已有账号和可用免费服务，不开通付费或额度耗尽后转付费。密钥不输出不提交。保留本轮前已有未提交改动。完成时记录命令、测试、限制与产物绝对路径。管理器分配的项目 test_cmd 必须通过；第一项先建立真实测试基础，后续不得用空测试伪造通过。
