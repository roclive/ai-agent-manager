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
