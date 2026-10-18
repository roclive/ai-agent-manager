Witness Lee Collected Works (李常受文集), starting from the 1980s, crawled in reading order.

The user has not given a URL. Discover it:
1. Explore https://line.twgbr.org/ (root, the pages linked from /recoveryversion/, any "文集" / "李常受" / "Collected Works" / "全集" links, sitemap if any).
   Write `docs/leeworks-site-notes.md` (Chinese, short) describing: the index URL(s), how volumes are organised (by year? series? volume numbers),
   how a volume/message page is structured, and which volumes belong to 1980–1989. If the collected works are NOT available on this site,
   stop and report that clearly in your summary and in the notes file (do not guess other sites); implement nothing further except the notes.
2. If found: `bible/leeworks.py` crawls the index and builds `data/lee_index.json` (year, series/volume title, ordered messages/chapters with URLs),
   then fetches the 1980–1989 volumes into SQLite `data/lee.db`: `volumes(id, year, title, order_no, url)`, `messages(volume_id, seq, title, url)`,
   `paragraphs(message_id, seq, text)` (keep headings/paragraph order; strip navigation). Resumable per message.
3. Reading order: define `reading_order()` → flat ordered list of (volume, message) from the earliest 1980 volume onward, so the daily reminder can say
   「李常受文集 · 1984年 · 《xxx》第 N 篇」. Chronological by year and then volume order on the site; document the rule.
4. CLI: `python3 -m bible lee index [--refresh]`, `python3 -m bible lee fetch --from-year 1980 --to-year 1989 [--limit N] [--dry-run]`,
   `python3 -m bible lee list [--year 1984]`, `python3 -m bible lee show <message-id> [--max-chars N]`, `python3 -m bible lee coverage`.
5. Tests with HTML fixtures for the index and a message page, ordering rule, resumability, store round-trip.
6. Crawl as much of 1980–1989 as practical (1 req/s; batches with `--limit`); report coverage. Partial data is acceptable if resumable.
