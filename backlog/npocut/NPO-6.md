Add a Microsoft Edge neural TTS backend (edge-tts) as the default voice, keep macOS `say` as offline fallback,
and fix orphan subtitle cues.

The user listened to samples and chose **zh-CN-YunyangNeural** (news-style male) as the default Chinese voice.
`edge-tts` 7.3.1 is already installed in `/opt/homebrew/Caskroom/miniconda/base/bin/python3`; add `edge-tts>=7` to
requirements.txt. It needs internet; tests must never hit the network.

1. TTS backends in kb_video.py: `--tts auto|edge|say` (default `auto`), `--voice` (backend-specific name).
   - Default voices: edge zh → `zh-CN-YunyangNeural`, ja → `ja-JP-KeitaNeural`, en → `en-US-GuyNeural`;
     say zh → Tingting (existing logic), ja/en existing logic.
   - edge: use the `edge_tts` Python API (`Communicate(text, voice, boundary="SentenceBoundary")`, async stream), write
     the mp3, convert to 24 kHz mono WAV with ffmpeg; timeout 60 s per segment; 2 retries with backoff.
   - `auto`: try edge; on import error / network error / timeout after retries, log one warning and fall back to `say`
     for the WHOLE video (never mix voices within one video).
   - Record `tts_backend`, `voice`, and `fallback_reason` (if any) in manifest.json.
   - `NPOCUT_FAKE_TTS=1` still overrides everything.
   - Cache synthesized audio in `kb_out/.tts_cache/<sha256(backend+voice+text)>.wav` (+ boundary json) and reuse it.
2. Subtitle timing: when edge returns SentenceBoundary events, use their offsets/durations for cue timing within the
   segment instead of proportional estimation. Keep proportional timing for say/fake.
3. Orphan cue bug: a sentence longer than the 2-line cue limit is currently split by character overflow, producing
   cues like `人。` lasting 0.5 s (see vertical subs of the fixture: cue 8 ends `培养一万`, cue 9 is `人。`). Split long
   sentences at clause punctuation (，、；：) into balanced chunks that each fit in 2 lines; only hard-split when a single
   clause is too long, and never leave a chunk shorter than 6 characters (merge it with its neighbour; shrink font one
   step if needed). Cue timing for chunks proportional within the sentence (or boundary-based when available).
4. kb_autogen: add `--tts` and `--voice` passthrough; include backend+voice in content_hash so changing voice
   regenerates. Default `auto`.
5. Tests (offline): monkeypatch a fake `edge_tts.Communicate` that yields an mp3 (generate via ffmpeg anullsrc) plus
   SentenceBoundary events → cue timing follows boundaries; edge raising → auto falls back to say-path (use
   NPOCUT_FAKE_TTS-like stub for say) and manifest records fallback_reason; cache hit avoids second call; orphan-cue
   test with the fixture sentence `Anthropic 将投入 1 亿美元培养前沿部署工程师，目标是到 2027 年底培养一万人。` at vertical
   size produces no cue < 6 chars.
6. Docs: README/README_zh/SKILL: voices, `--tts`, fallback behavior.

Finally render the fixture item for real with default settings (edge, Yunyang) in both orientations and report the
backend recorded in the manifest and the durations.
