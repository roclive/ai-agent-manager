# Shared context: tamil-learning (帮我学好泰米尔语)

Goal (from the user): help a Chinese speaker (living in Japan; Japanese is also a strong second language) learn Tamil (தமிழ்) well — from zero to a solid A2, with a sustainable daily routine.
Tamil is SOV and agglutinative like Japanese — use Japanese/Chinese comparisons in explanations; all explanations in simplified Chinese (optionally with a Japanese comparison line).

Hard rule on correctness: Tamil content produced by an AI can contain errors. Therefore every data item that is not generated deterministically (e.g. letters composed from Unicode) carries `reviewed: false` and a
`source` note, and is listed by `tamil qa` in a native-speaker review checklist. Never present unreviewed sentences as verified. Prefer short, high-frequency, conservative examples. Do not invent grammar rules; when unsure, omit and note it in NOTES.md.

Technical rules: Python 3.13 stdlib only (+ `edge-tts`, already installed, for audio — used only through an injectable wrapper; tests never touch the network), package `tamil/` with `python3 -m tamil <command>`,
data in `~/.tamil/` (override `TAMIL_HOME`; tests use temp dirs), lesson/vocab content as JSON/Markdown files in `tamil/data/`, SQLite for review state. Tamil Unicode block U+0B80–U+0BFF; always NFC; romanization in ISO 15919-style
plus a learner-friendly Chinese-oriented hint (e.g. 「类似汉语拼音 ch」). Audio voices: Edge `ta-IN-PallaviNeural` (female) and `ta-IN-ValluvarNeural` (male) — verify with `edge-tts --list-voices | grep ta-IN` before relying on them; macOS `say -v '?'` may list a Tamil voice (check) as offline fallback.
Python: `/opt/homebrew/Caskroom/miniconda/base/bin/python3`; tests `python3 -m pytest -q tests` (offline, < 30 s). Commit nothing (aam commits), never push, keep generated audio/caches out of git (`data/audio/`, `.cache/` ignored); UI/CLI text Chinese.
