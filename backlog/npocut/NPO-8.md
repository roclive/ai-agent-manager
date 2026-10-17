From OntoKB web panel: narration backend selector + voice dropdown (default Edge Yunyang).

Context: main now contains the web panel (kb_web.js, web/kb.js) and the TTS backends in kb_video.py
(`--tts auto|edge|say`, `--voice`). The panel still has a free-text "声音" input described as a macOS voice, which
no longer matches the default Edge backend (typing "Tingting" with auto → Edge fails → whole video falls back).

1. Voice listing helper `kb_voices.py` (stdlib + edge_tts):
   `python3 kb_voices.py --lang zh|ja|en` prints JSON `{"edge":[{"name","label","gender"}...], "say":[{"name","label"}...],
   "defaults":{"edge":"zh-CN-YunyangNeural","say":"Tingting"}}`.
   - edge: `edge_tts.list_voices()` filtered by locale prefix (zh → zh-CN only; ja → ja-JP; en → en-US). Cache the full
     list in `kb_out/.tts_cache/edge_voices.json` for 7 days. If offline/error, use a built-in fallback list
     (zh: Yunyang 云扬, Xiaoxiao 晓晓, Yunxi 云希, Xiaoyi 晓伊, Yunjian 云健; ja: Keita, Nanami; en: Guy, Jenny).
     Chinese labels for zh voices, e.g. "云扬 · 新闻男声".
   - say: parse `say -v '?'` for the lang (zh → zh_CN/zh_TW/zh_HK; ja → ja_JP; en → en_US/en_GB), names only.
   - Reuse the default-voice constants from kb_video.py (import them) so defaults stay in one place.
2. Server (`kb_web.js`): `GET /api/kb/voices?lang=zh` runs kb_voices.py via spawn with argv array (cache result in memory
   per lang for 10 min). `POST /api/kb/generate` accepts `tts` ∈ {auto, edge, say} (default auto) and `voice`; validate
   `voice` against the list for that backend+lang (auto validates against edge list); pass `--tts` and `--voice`.
   Reject anything else with 400.
3. UI (`web/kb.js`, `web/index.html`, `web/styles.css`): replace the free-text voice input with
   - 「配音」select: 自动（Edge，失败退回本机）/ Edge 神经语音 / 本机 macOS；default 自动.
   - 「声音」select populated from /api/kb/voices for the chosen backend + language; default 云扬 (zh-CN-YunyangNeural)
     for auto/edge, Tingting for say. Changing language reloads the list.
   - Remember last backend/voice per language in localStorage (wrapped in try/catch).
   - After a job finishes, show which backend/voice was actually used, read from the output's manifest.json
     (`tts_backend`, `voice`, `fallback_reason`): e.g. "配音：Edge 云扬" or "配音：已退回本机 Tingting（原因…）".
     Add the manifest fields to the job result in kb_web.js (read manifest next to the output file).
4. Tests: Python `tests/test_kb_voices.py` (mock edge_tts.list_voices, offline fallback list, say parsing from a sample
   `say -v '?'` text, cache reuse). Node `tests/kb_web.test.mjs`: voices endpoint with a fake python script, generate
   rejects unknown tts and voices not in the list, passes `--tts/--voice` argv correctly, job result includes backend info.
5. Docs: README/README_zh/SKILL panel sections mention the backend selector.

Do not change kb_video.py behavior beyond exporting default-voice constants if needed.
