Spaced-repetition engine (SM-2 variant) + review CLI.

SQLite state per card (`card_id`, deck, ease, interval, due, lapses, history). Decks built from data files: letter recognition (see char → say sound), listening (hear → pick letter), vocabulary recall both directions, cloze for phrases.
`tamil review [--deck D] [--limit N] [--new N]` interactive terminal session (also `--script answers.json` for tests): shows prompt, waits for reveal, grades 0–5 (Again/Hard/Good/Easy mapping), plays audio via `afplay` when present (skippable),
daily limits (new 15 / reviews 100), leech detection (lapses ≥ 6 → suspend + note). `tamil stats` (due today, retention %, streak, cards by maturity). Deterministic scheduler with injectable clock. Tests: interval growth, lapses, leech, due ordering,
daily limits, persistence across sessions, stats math.
