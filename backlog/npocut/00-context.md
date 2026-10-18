# Shared context for all npocut tasks (prepended to each task)

Goal: npocut autonomously turns OntoKB knowledge-base items — especially their **summary**
and **key_points** — into finished narrated videos, including plain text articles that have no
source video.

OntoKB (separate project, do NOT modify it):
- Local API: `http://127.0.0.1:8765`. `GET /api/reading` returns
  `{nodes, edges, library:[{id, title, url, kind ("article"|"youtube"...), source, summary,
  categories[], key_points[], steps[], entity_count, relation_count}]}`.
- `GET /api/reading` may be slow or offline; every feature must also work from a saved JSON
  file (`--from-json path`). A real sample is at `tests/fixtures/ontokb_reading.json` once NPO-1 lands.
- OntoKB already makes clip videos for YouTube items itself; npocut's new job is the
  **summary-driven narrated video** for any item.

Environment (macOS, offline-capable):
- ffmpeg with libass: `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` (and `ffprobe` next to it).
  Allow override by env `NPOCUT_FFMPEG` / `NPOCUT_FFPROBE`. Reuse helpers in `common.py` where they fit.
- subtitles filter quoting is fragile: copy SRT into a temp dir as `subs.srt` and run ffmpeg with
  `cwd=tmp`; escape commas in `force_style` as `\,`.
- TTS: macOS `say -v <voice> -o out.aiff --data-format=LEI16@24000 -f text.txt`. Default voice
  `Tingting` for zh_CN if present, else first zh_CN voice from `say -v '?'`; `--voice` overrides;
  `--lang ja` picks a ja_JP voice. Env `NPOCUT_FAKE_TTS=1` must produce silent audio of a duration
  proportional to text length (≈ 0.18 s per CJK char, 0.06 s per latin char, min 1.5 s) using ffmpeg
  `anullsrc`, so tests run without `say`.
- Fonts: `/System/Library/Fonts/Hiragino Sans GB.ttc` (fallback `STHeiti Medium.ttc`); env override `NPOCUT_FONT`.
- Pillow and pytest are installed. Python: `/opt/homebrew/Caskroom/miniconda/base/bin/python3`.

Rules:
- Python 3.10+, stdlib + Pillow only for new modules (no new pip deps without asking).
- New outputs go under `kb_out/` which must be gitignored. Never commit media (.mp4/.wav/.aiff/.png outputs).
- Do not modify or delete existing user media files in the repo root.
- Tests live in `tests/`, run with `python3 -m pytest -q tests`, must be offline and fast (< 60 s),
  using `NPOCUT_FAKE_TTS=1` and tiny resolutions where rendering is exercised.
- Update README.md / README_zh.md and SKILL.md briefly for user-facing features.


---

# NPO 夜间升级任务（2026-10-18）

用户授权：升级陈旧的 npocut 界面；下载小型 SD 生图模型或接入 API，让 OntoKB 同步生成的视频更精彩；增加可持续执行的夜间任务。

项目 /Users/zhangdapeng/Desktop/ytsubone/npocut。先读项目说明和现有 kb_source.py、kb_video.py、kb_autogen.py、kb_web.js、web/。既有能力包括知识库读取、脚本、横竖版视频、字幕、Edge TTS/macOS 回退、网页生成及预览。

在任务工作树实现，保留旧功能与默认兼容性，不改用户素材、不推送、不发布、不自动合并 main。以管理器集成分支累积工作，依赖任务必须等待集成。遵守实际 worker 提示的提交规则。

生图采用可替换后端。先检查硬件/内存/磁盘、已安装依赖及可用凭证的存在性（不输出密钥）。依据官方模型卡/文档核实下载体积、许可证及 Mac 支持，优先可在此机运行的小模型；单次模型下载上限 4GB，缓存放用户缓存目录，不提交权重。API 仅用已有配置，不注册付费服务；真实验证最多 2 张图，不循环烧额度。若无凭证或本机不支持，交付可用适配器、离线回退及明确阻塞原因，不能声称真实生图成功。必须尝试实际配置/下载/出图，不能仅交付调研。

生成的插图应标明 AI 示意，不能冒充来源实拍；旁白和事实仍来自 OntoKB。保留来源、scene prompt、模型、seed、缓存及回退信息。任务验收应记录实际命令、结果及样片绝对路径。模型、视频、快照及密钥不提交。

界面任务使用 frontend-skill；浏览器验收覆盖真实操作、窄屏与错误状态。Python 和 Node 测试离线使用 fake provider；真实冒烟单独进行。没有凭证时不允许无限重试。

本轮用户已授权小模型/API 实施，因此旧规则中的新增 pip 依赖询问要求由本轮授权覆盖：仅生图后端可在独立环境安装所需依赖，其他模块继续优先 stdlib + Pillow。旧 TTS 基线已升级为 Edge Yunyang 优先、macOS 回退，以当前代码行为为准。
