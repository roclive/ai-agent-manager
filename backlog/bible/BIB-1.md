Project scaffold + shared polite fetcher + one-year reading schedule crawler/parser.

1. Scaffold the package/layout from the shared context, `.gitignore` (`data/`, `__pycache__/`, `.pytest_cache/`), `requirements.txt`
   (empty if stdlib only), `README.md` skeleton, `python3 -m bible --help`.
2. `bible/fetch.py`: `Fetcher(cache_dir, delay=1.0, user_agent=...)` with `get(url, refresh=False) -> str` (disk cache keyed by URL hash +
   readable path, charset detection, retry/backoff, robots.txt check cached once), injectable transport for tests.
3. `bible/schedule.py`: fetch https://line.twgbr.org/recoveryversion/oneyear/2026.html (inspect the real page first: the table layout, how
   dates and passages are written, how OT/NT/Psalms/ "晨兴" items appear), parse into `data/schedule_2026.json`:
   `[{"date":"2026-01-01","weekday":"四","items":[{"kind":"OT"|"NT"|"PS"|"other","label":"创世记一至三章","book":"创","chapters":[[1,3]]}],"raw":"..."}]`.
   Normalise book names (Chinese full names and the abbreviations used on the site) to a canonical list in `bible/books.py`
   (66 books, Chinese name, abbreviation, chapter counts). Handle ranges, multiple passages per day, cross-chapter ranges.
4. CLI: `python3 -m bible schedule fetch [--refresh]`, `python3 -m bible schedule show [--date YYYY-MM-DD] [--ot-only]` (defaults to today,
   Asia/Tokyo; prints Chinese lines), `python3 -m bible schedule validate` (all 365 days present, every passage resolves to a canonical book/chapter range).
5. Tests: parse the fixture excerpt (copy a representative slice of the real HTML, e.g. January + one month boundary), range parsing edge cases,
   book-name normalisation, date lookup, fetcher cache/backoff with a fake transport.
6. Run the real fetch once, run `schedule validate`, and report in your summary: days parsed, number of OT days, any unparsed rows.
