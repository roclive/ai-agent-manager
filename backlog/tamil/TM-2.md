Audio pipeline.

`tamil/audio.py`: `synthesize(text, voice) -> Path` using `edge_tts` through an injectable transport (so tests use a fake that writes a tiny mp3 via ffmpeg `anullsrc` — `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`), cached by sha256(voice+text) under `TAMIL_HOME/audio/`, 2 retries with backoff,
timeout 60 s, optional macOS `say` fallback if a Tamil voice is installed. CLI: `tamil audio letters` (all 247 + grantha), `tamil audio vocab [--deck D] [--limit N]`, `tamil audio say "<tamil text>"` (plays with `afplay`), `tamil audio coverage`
(which items lack audio). Manifest JSON mapping item id → file + voice + duration (ffprobe). Respect politeness (1 request/0.5 s). Tests offline: cache hit avoids second call, retry/backoff, manifest consistency, missing voice error message.
