Manager review of NPO-2 (rejected; code structure is good, one real-world bug):

Real TTS fails on every segment:
  say -v Tingting -o audio-0.aiff --data-format=LEI16@24000 -f audio-0.txt
  -> "Opening output file failed: fmt?" (exit 1)
AIFF is big-endian, so LEI16 is invalid there. (The task card's example was wrong — sorry.) Fix:
  say -v <voice> --file-format=WAVE --data-format=LEI16@24000 -o audio-N.wav -f audio-N.txt
(verified working on this Mac: 24 kHz mono WAV). Drop the .aiff intermediate.

Also:
1. Add `tests/test_kb_video.py::test_real_say_smoke`: skipped unless `shutil.which("say")`; synthesizes one short
   Chinese sentence with the real TTS function (not NPOCUT_FAKE_TTS) and asserts a WAV with duration > 0.3 s.
   This catches format bugs the fake TTS hides. Must take < 5 s.
2. Remove any LD/DYLD library-path workaround you added for ffmpeg in a previous attempt: ffmpeg-full has been
   upgraded to 9.0.2 and works now. Use `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` directly (env override kept).
3. Then render the fixture item for real (no fake TTS) at default size once, check it plays (ffprobe duration ≈ sum of
   segment durations) and report the duration in your summary. Do not commit kb_out/.
