Add `kb_video.py`: render a VideoScript into a narrated MP4 with burned subtitles.

Pipeline (each step in its own function, all temp work in a tempdir, final files in `kb_out/<slug>/`):
1. TTS per segment `narration` → wav (see shared context for `say` and `NPOCUT_FAKE_TTS`); measure durations with ffprobe. Pad 0.4 s after each segment.
2. Slide image per segment with Pillow at `--size 1920x1080` (default) or `--vertical` (1080x1920):
   clean card design — background color/gradient, heading large, body text wrapped (CJK-aware wrapping by pixel width),
   small footer with the item title and segment index; title slide shows title big + category; outro shows source URL.
3. Assemble: each slide as a still clip for its audio duration (`-loop 1 -t`), concat audio and video
   into `video.mp4` (H.264 yuv420p, AAC, 30 fps, `+faststart`).
4. SRT: one cue per sentence of narration, timed proportionally within its segment → `subs.srt`.
5. Burn subtitles into `<slug>.subbed.mp4` (option `--no-burn` skips; default burns). Bottom-centered,
   font from shared context, margins scaled to resolution.
6. Write `manifest.json` in the output dir: script, durations, voice, files, total duration, created_at.

CLI: `python3 kb_video.py <id> [--from-json f | --base-url u] [--script script.json] [--vertical] [--size WxH]
[--voice V] [--lang zh|ja|en] [--max-points N] [--out kb_out] [--no-burn]`. Prints the final path.
Uses `kb_source.build_script` (NPO-1).

Tests `tests/test_kb_video.py` with `NPOCUT_FAKE_TTS=1`, `--size 320x180`: end-to-end render from the fixture
produces a playable mp4 whose ffprobe duration ≈ sum of segment durations (±0.5 s), SRT cues monotonic and within
duration, vertical mode produces 9:16 dimensions, text wrapping never exceeds slide width.
