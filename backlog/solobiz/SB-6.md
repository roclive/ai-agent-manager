Weekly review, metrics and goals.

`review week [--date D] [--json]` (non-interactive by default; `--interactive` asks 5 short questions: win, blocker, lesson, next week's one big thing, energy 1–5): computes time spent per kind vs plan, planned-vs-done items, pipeline movement (new, advanced,
won, lost, stale), conversion per stage, effective hourly rate (won revenue / hours), activity results, project health. Writes a `reviews` row and Markdown report `reports/YYYY-Www.md` (under SOLOBIZ_HOME) plus a short「下周唯一重点」 that feeds `plan week`.
Goals (OKR-lite): `goal set --revenue 300000 --period 2026-Q4 --deals 3`, `goal status` shows pace vs target and the weekly sales-minutes needed to hit it. Tests: metrics on a seeded dataset (fixed expected numbers), report golden-file, goal pace math, review feeds planner.
