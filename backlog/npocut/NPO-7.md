Stop the From OntoKB web panel from accumulating snapshot files.

Every `GET/POST /api/kb/library` in `kb_web.js` writes a new `kb_out/web-source-<uuid>.json` (4 page loads → 4 files),
so the folder grows forever.

Fix: name the snapshot by content hash — `web-source-<sha256(JSON) first 16 hex>.json` — and only write it if it does
not exist (identical library = same file). Update the `/api/kb/generate` snapshot-name validation regex accordingly.
On server start (createKbHandler), delete `web-source-*.json` files older than 7 days in `kb_out/`.

Tests (node --test): loading the same library twice produces one snapshot file; a different library produces a
second; generate still accepts the hash-named snapshot and rejects other names; old-file cleanup removes only
`web-source-*.json` older than 7 days.
