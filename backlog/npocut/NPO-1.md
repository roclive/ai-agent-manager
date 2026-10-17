Add `kb_source.py`: OntoKB client + video script builder.

- `fetch_library(base_url="http://127.0.0.1:8765", timeout=30) -> list[dict]` via urllib; `load_library(path)` from saved JSON (accepts full `/api/reading` payload or a bare list).
- `build_script(item, max_points=6, lang="zh") -> dict` producing a JSON-serializable VideoScript:
  `{id, title, url, lang, segments:[{kind:"title"|"summary"|"point"|"outro", heading, text, narration}]}`.
  - title segment: heading = title, narration = title.
  - summary: split summary into ≤ 2 segments of ≤ 120 CJK chars at sentence boundaries (。！？.!?).
  - one `point` per key_point (cap `max_points`), heading "要点 n/N" (ja: "ポイント n/N", en: "Point n/N").
  - outro: narration "以上就是本期内容" (ja "以上です", en "That's all."), text shows source URL if present.
  - Narration text strips markdown and URLs.
- `slugify(id_or_title)` → filesystem-safe ascii slug (hash fallback for pure CJK).
- CLI: `python3 kb_source.py list [--from-json f] [--base-url u]` prints id, kind, title;
  `python3 kb_source.py script <id> [--from-json f] [-o script.json]`; `python3 kb_source.py snapshot -o f` saves the live payload.
- Save the real payload as fixture: copy `/Users/zhangdapeng/Desktop/ai-agent-manager/backlog/npocut/fixtures/ontokb_reading.json`
  to `tests/fixtures/ontokb_reading.json` (if the source path is unreadable, create a realistic small fixture yourself).
- Tests in `tests/test_kb_source.py`: load fixture, build script, segment splitting, caps, slug, CLI `list` via subprocess.
- Add `kb_out/` to `.gitignore`.
