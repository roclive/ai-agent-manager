Quiet scheduled output + reliability polish for `python3 -m bible daily`.

1. When `--out` is given, do NOT echo the whole report to stdout (it ends up in aam's event log every morning, ~12 KB). Print one short line: `报告已保存：<path>（旧约 <passages>）` and keep warnings on stderr. Without `--out` keep printing the report.
   Add `--quiet` (no stdout at all, exit code only) for cron use.
2. `--notify` should include the first OT passage label and the baseline-based 落后 count in one line, and must never fail the run (exit 0) when osascript is blocked; write the reason to stderr once.
3. Add `python3 -m bible doctor`: checks that schedule/bible.db/lifestudy.db exist and are readable, counts, last crawl dates, whether today's passages resolve to verses, progress.json validity, and prints Chinese 「正常 / 需要处理」 with the exact fix commands. Exit code 1 if anything is broken. Tests for each state with temp dirs.
4. README (Chinese): routine setup, doctor, quiet mode.
