Daily reading reminder: today's passages + Old-Testament focus + Lee works progress + notification, scheduled by aam.

Builds on BIB-1 (schedule + books), BIB-2 (verse store + passage resolver), BIB-3 (Lee works store + reading order) — all merged into your branch.

1. `bible/daily.py`: `build_daily(date, db_paths) -> DailyReading` containing:
   - 今日进度: the schedule items for that date (OT / NT / Psalms / other) with labels;
   - 旧约重点: the OT passages with the full verse text (from `bible.db`) rendered in readable Chinese, chapter headings, verse numbers;
     if a chapter is missing in the store say so explicitly (and give the site URL) instead of silently skipping;
   - 本日进度状态: day N of 365, % complete, whether the user is behind (see progress tracking), next 3 days preview;
   - 李常受文集: the next unread message in `reading_order()` (1980s first) with title, volume, source URL and the first ~600 chars as a teaser,
     and "今日建议篇数" (default 1, `--lee-per-day`).
2. Progress tracking `data/progress.json` (gitignored): per-day done flags for the schedule (`python3 -m bible done [--date D] [--undo]`),
   Lee works pointer (`python3 -m bible lee done <message-id>` / `lee next`), catch-up detection: list of schedule days before today not marked done
   (「落后 N 天」), with `python3 -m bible catchup` printing what to read to catch up (OT first).
3. Outputs: `python3 -m bible daily [--date D] [--format text|md|html] [--notify] [--out PATH]`:
   - default prints Chinese text/markdown; `--out` writes `reports/YYYY-MM-DD.md` or `.html` (reports/ is gitignored; HTML is a clean single-file page
     with large readable type, dark-mode aware, OT text first);
   - `--notify` posts a macOS notification via `osascript -e 'display notification ...'` (argv list, no shell interpolation; title 「今日读经」,
     body = today's labels + 落后天数), and opens nothing else. Skip silently on non-macOS.
4. Scheduling hook: `python3 -m bible daily --out reports/today.html --notify` must be safe to run from cron/launchd with a minimal environment
   (absolute paths computed from the package location, no cwd assumptions, exit code 0 even when data is partially missing — log warnings to stderr).
   Document in README the aam routine to register (the manager will register it): action `shell`, cron `0 7 * * *`.
5. Tests: daily composition from tiny fixture DBs (schedule fixture, 2 chapters of verses, 3 Lee messages), catch-up logic across month boundary,
   progress file atomic writes, HTML/MD rendering snapshot (small), notify command construction (mock subprocess), missing-data warnings.
6. README (Chinese): install/usage/crawl order/daily routine/progress commands. Run the real thing for today's date and paste the rendered text of
   today's OT reading (first 25 lines) in your summary.
