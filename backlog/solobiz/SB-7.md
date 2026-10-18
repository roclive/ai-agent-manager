Local web dashboard (stdlib only).

`python3 -m solobiz serve [--port 8780]` (127.0.0.1 only; `X-Solobiz: 1` header required on mutating requests, same-origin check) serving one self-contained `solobiz/web/index.html` (vanilla JS, no CDN, Chinese UI, light/dark) over a small JSON API
(`/api/plan/week`, `/api/pipeline`, `/api/activities`, `/api/projects`, `/api/time`, `/api/review`). Views: 本周 (3 sessions with checkable items and a live countdown of remaining minutes), 销售管道 (kanban with drag between stages that calls lead move),
活动日历 (12-week grid), 项目 (progress, next action, burn-down bar), 计时器 (start/stop), 复盘. Must be usable on a phone-width screen. Tests: API handlers with `http.client` against an ephemeral port (status codes, CSRF 403, JSON shapes), HTML contains
required view anchors, no external URLs in the HTML.
