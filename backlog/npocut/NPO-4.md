Web UI: "From OntoKB" panel in npocut's web app (`server.js` + `web/`, also used by Electron).

- Server endpoints (follow existing server.js style; spawn python with argv arrays, never shell strings):
  - `GET /api/kb/library` → proxy OntoKB `/api/reading` library (id, title, kind, summary, key_points count)
    plus each item's autogen state from `kb_out/autogen_state.json`. OntoKB base url configurable via env `ONTOKB_URL`.
  - `POST /api/kb/generate {id, vertical, voice, lang}` → starts `kb_video.py` as a background job; returns job id.
  - `GET /api/kb/jobs/:id` → status, log tail, output paths.
  - `GET /api/kb/file?path=` → serve files only from inside `kb_out/` (reject path traversal), with Range support.
- UI: new tab/panel listing library items (title, kind badge, summary preview, generated status), buttons
  "生成横屏" / "生成竖屏", progress/log while running, inline `<video>` preview and download link when done.
  Match existing styles in `web/styles.css`; works in narrow windows.
- Tests: a Node test (`node --test`) for the path-traversal guard and job state machine if server code is testable;
  otherwise extract the guard into a small module and test it. Do not break existing UI features.
