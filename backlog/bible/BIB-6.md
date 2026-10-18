Progress baseline and wording fixes for the daily reminder (found when the manager ran it on day 291 of the year).

1. **Baseline**: a user who starts mid-year sees「落后 290 天」and「已完成 0.0%」— discouraging and meaningless. Add a baseline start date to `data/progress.json` (`baseline`: ISO date).
   `python3 -m bible start [--date D]` (default today) sets it; if no baseline exists when `daily` runs for the first time, set it to that day and say so once (「已从今天开始追踪」).
   Days before the baseline are not counted as behind; percentages and 落后 are computed from the baseline (e.g.「已读 2 / 5 天」). `catchup` only lists days from the baseline on.
   Add `python3 -m bible done --through YYYY-MM-DD` (mark a range done) and `done --undo --through`. Keep existing files compatible (missing baseline = today's behaviour is NOT acceptable; migrate by setting baseline to first day with a done flag, or today).
2. **Wording**: warnings use the book abbreviation as a name (「耶生命读经缺少 39 篇」). Use the full book name (「耶利米书的生命读经缺少 39 篇」) and tell the exact command to fix it:
   `python3 -m bible lifestudy fetch --book 耶利米书`.
3. Show a short Chinese encouragement line at the top that depends on state (on track / 1–2 days behind / catching up) — plain text, no emoji.
4. Tests for baseline logic (before/after baseline, range done/undo, migration of an existing progress file), the percentage text, and the warning text. README update (Chinese).
