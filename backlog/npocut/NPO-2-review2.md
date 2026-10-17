Manager review #2 of NPO-2 — rejected. TTS, timing (93.6 s), SRT and encoding are good. Rendered both orientations
with real TTS and inspected frames; fix these:

1. Output collision: `kb_video.py <id>` and `kb_video.py <id> --vertical` both write
   `kb_out/<slug>/<slug>.subbed.mp4`, `video.mp4`, `subs.srt`, `manifest.json` — the second render overwrites the first.
   Use a per-format subfolder: `kb_out/<slug>/landscape/...` and `kb_out/<slug>/vertical/...` (custom `--size` → a
   folder named `WxH`). Each folder holds its own video.mp4, subs.srt, `<slug>.subbed.mp4`, manifest.json.
   Return/print the final path. kb_autogen (NPO-3) will rely on this layout.
2. Vertical (1080x1920) typography is broken: heading and body are tiny (body ≈ 1/3 of landscape size) and the frame is
   mostly empty. Scale fonts by the *short side* (width for vertical), e.g. heading ≈ 0.075·short, body ≈ 0.055·short,
   then step down only if the wrapped body does not fit the content box. Vertically center the content block in the
   area between the accent bar and the subtitle safe zone.
3. Subtitles collide with the footer in landscape (footer text sits right under/behind the subtitle line). Reserve a
   bottom subtitle safe zone (≈ 18% of height) that slide content and footer never enter; put the footer *above* it or
   at the very top-right. Subtitles must stay in that zone with font size scaled to the short side.
4. Chinese/Japanese line breaking: lines must not start with closing punctuation (，。、；：！？）」』】》…) and must not end
   with opening punctuation (（「『【《). Implement simple kinsoku in the wrapper (move the char to the previous line).
   Add unit tests for the wrapper covering this.
5. Add a test that renders the fixture at tiny landscape and tiny vertical sizes into the same out dir and asserts both
   outputs exist with the right dimensions.

Then render the fixture item for real (no fake TTS) in both orientations, extract one frame at t=20s from each with
ffmpeg into kb_out/ (not committed) and describe in your summary how they look.
