Daily study engine and reminders.

`tamil today` composes a 20-minute session: SRS reviews due (≤ 10 min) + one new lesson chunk (≤ 7 min) + one listening snippet (≤ 3 min), tracks completion, streak, weekly goals; `tamil week` summary; level checks A0→A2 as a quiz built from learned items
(`tamil level test`) with a Chinese report and weak-spot list. `tamil remind [--notify]` sends a macOS notification (osascript via argv list) with today's plan. `scripts/aam_routines.txt` documents the aam routine commands (daily 08:00 remind) — documentation only.
Progress file/DB under TAMIL_HOME, atomic writes. Tests: session composition under varying due counts, streak rules (timezone Asia/Tokyo), level test scoring, notification command construction (mock), idempotent re-run on the same day.
