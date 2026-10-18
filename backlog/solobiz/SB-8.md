Reminders, demo data, docs and end-to-end test.

`solobiz remind [--notify]` builds today's nudge (the plan slice for today, due follow-ups, timer left running, "3 小时还剩 N 分钟") and posts a macOS notification via `osascript` (argv list, no shell interpolation; skip silently elsewhere).
`solobiz demo seed` loads a realistic demo dataset (a freelance consultant: 2 offers, 12 leads across stages, 2 projects, 6 weeks of time logs) into the current SOLOBIZ_HOME only if it is empty. `scripts/aam_routines.txt` lists the exact
`aam routine add ...` commands (daily 07:30 remind, Sunday 20:00 review, Monday 08:00 plan week) — documentation only, do not execute anything. Write the Chinese README (quick start, the 3-hour weekly rhythm, how planning/pipeline/activities/projects/review fit,
FAQ) and an end-to-end test that drives the CLI through a whole simulated week and asserts the budget is never exceeded.
