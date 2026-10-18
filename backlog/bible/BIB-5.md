Companion reading: crawl 《生命读经》(Life-Study of the Bible, Witness Lee) from https://line.twgbr.org/life-study/ and pair it with today's Old Testament reading.

Background (from BIB-3's investigation, see `docs/leeworks-site-notes.md` in the repo): the site does NOT host 《李常受文集》 (the "文集" link on the schedule pages is an off-site Readmoo ad).
What the site does host is 《生命读经》, organised by Bible book: `/life-study/` (traditional) and `/life-study/index-chs.html` (simplified; prefer simplified for
all output), a book page such as `/life-study/1.html` (Genesis) that contains the first message and links to later ones like `1_2.html` (note `1_1.html` is 404).
Inspect the real pages first and write down the actual URL pattern in `docs/lifestudy-site-notes.md` (Chinese, short).

1. `bible/lifestudy.py` — polite crawl (shared `Fetcher` from BIB-1; same etiquette rules as in the shared context) of ALL books, Old Testament first, into SQLite
   `data/lifestudy.db`: `books(book_no, name, abbr, url)`, `messages(id, book_no, seq, title, scripture_ref, url)`, `paragraphs(message_id, seq, text)`.
   Keep headings and paragraph order, strip navigation. `scripture_ref` = the Scripture portion the message covers if the page/title states it
   (e.g. 「创世记一章一至二节」 → normalised with `bible/books.py` into book + chapter ranges, stored as JSON in a second column `refs_json`); leave empty when not stated.
   Resumable per message; `--limit`, `--dry-run`, `--refresh`.
2. CLI: `python3 -m bible lifestudy fetch [--testament ot|nt] [--book 耶利米书] [--limit N]`, `lifestudy list [--book B]`, `lifestudy show <message-id> [--max-chars N]`,
   `lifestudy coverage`, and `lifestudy for-passage "耶利米书 20:1～22:30"` → the Life-Study messages of that book ordered by seq, marking those whose `refs_json`
   overlaps the passage's chapters (if no refs known, return the whole book's list with a note「该书生命读经按篇次排列，未标明对应章节」).
3. Reading pointer for the daily reminder: `lifestudy next --book B` returns the next unread message in that book given `data/progress.json` (create/extend the
   progress file schema compatibly with BIB-4's design: `{"lifestudy_done": ["<message-id>", ...]}`), and `lifestudy done <id>`.
4. Tests with HTML fixtures (index, book page, a message page, a 404 first-message case), scripture-ref normalisation, for-passage overlap logic, resumability, store round-trip.
5. Crawl the Old Testament Life-Study (1 req/s, in batches), report coverage per book. Partial data is acceptable if resumable and `coverage` says exactly what is missing.
