Bible text crawler + local store (Recovery Version, https://line.twgbr.org/recoveryversion/bible1/).

1. Inspect the real site structure first (index page → book pages → chapter pages? frames? per-chapter anchors?), then write
   `bible/bibletext.py` that crawls ALL 66 books (OT first), parsing verses into a SQLite store `data/bible.db`:
   `verses(book TEXT, chapter INT, verse INT, text TEXT)`, `footnotes(book, chapter, verse, marker, text)` if footnotes exist on the pages (keep them,
   they are part of the Recovery Version reading), `outline(book, chapter, text)` for the chapter outlines/headings if present, `meta(key,value)`.
   Keep verse numbers, strip navigation/markup. Resumable at chapter granularity.
2. CLI: `python3 -m bible text fetch [--book 创] [--testament ot|nt] [--limit N] [--refresh] [--dry-run]`,
   `python3 -m bible text show 创世记 1:1-5`, `python3 -m bible text show "诗篇 23"`, `python3 -m bible text coverage` (which chapters are present vs the
   canonical chapter counts in `bible/books.py`; created in BIB-1 — if you don't see it, create it with the same API).
   A passage resolver `resolve(passage_label) -> list[(book, chapter, v_from, v_to)]` reused by the daily reminder (accepts labels as they
   appear in the schedule JSON from BIB-1, e.g. "创世记一至三章", "诗篇二十三篇", "创 1:1-5").
3. Tests with HTML fixtures (one book page + one chapter page excerpt), parser edge cases (verse without number, footnote markers), resolver, store round-trip, coverage report.
4. Run the real crawl for the Old Testament (this may take a while at 1 req/s: ~930 chapters; run it in the background inside your sandbox and keep
   polling the log — or implement `--limit` and crawl in batches), then NT if time allows. Report coverage in your summary. If you cannot finish
   the full crawl within your session, leave the data partial: the code must be resumable and `coverage` must say exactly what is missing.
