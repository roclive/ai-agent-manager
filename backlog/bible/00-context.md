# Shared context for the daily Bible-reading reminder project (key BIB)

Goal: a local tool that tells the user every day what to read, with the text ready to read:
1. **Recovery Version one-year reading schedule 2026** (focus: Old Testament, 旧约): https://line.twgbr.org/recoveryversion/oneyear/2026.html
2. **Bible text** (恢复本 Recovery Version, Chinese): https://line.twgbr.org/recoveryversion/bible1/
3. **Witness Lee's Collected Works (李常受文集), reading in order starting from the 1980s** (the user did not give a URL —
   discover the collected-works index from the same site, https://line.twgbr.org/ — start by looking at links on the pages above
   and the site root; the volumes are organised by year/series).

Environment (macOS): Python `/opt/homebrew/Caskroom/miniconda/base/bin/python3` (3.13). Prefer stdlib (`urllib`, `html.parser`, `sqlite3`,
`json`, `argparse`) — if you need an HTML parser and `bs4` is installed use it, otherwise `html.parser`. Do not add pip dependencies without
need; if one is truly needed, list it in `requirements.txt`. Pages are UTF-8 (some may be Big5 — detect from `<meta charset>` / headers).
Network is available to you (the sandbox allows it) but tests MUST be offline: use saved HTML fixtures in `tests/fixtures/`
(small excerpts, ≤ 30 KB each, copied from the real pages) and mock the fetch function.

Crawling etiquette (the content is copyrighted, for the user's personal local reading only):
- Identify yourself: `User-Agent: bible-reading-personal/0.1 (personal use)`. Respect robots.txt (the site currently has none → 404).
- At most 1 request per second, sequential, with retry/backoff on 5xx/timeouts; resumable (skip already-fetched pages); cache raw HTML
  under `data/raw/` and parsed data under `data/`. **`data/` is gitignored — never commit crawled text.** Commit only code, tests, fixtures excerpts.
- Provide `--limit N` and `--dry-run` options on every crawler, and a `--refresh` flag to re-fetch.
- Never push anywhere; never publish the data.

Project layout (create what you need): `bible/` package (`fetch.py` shared polite fetcher, `schedule.py`, `bibletext.py`, `leeworks.py`,
`store.py`, `daily.py`, `cli.py`), `tests/`, `README.md` (Chinese), `requirements.txt`.
CLI entry: `python3 -m bible <command>`. Run tests with `python3 -m pytest -q tests`.
All user-facing output (reminder text, README) in Chinese. Keep modules small and tested.
