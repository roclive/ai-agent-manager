# Shared context: solo-biz (自营业个人事业主管理系统 · 每周只有 3 小时)

Goal (from the user): build a management system for a self-employed solo business owner who has **only 3 hours per week** for the business:
how to plan activities (marketing), sell, manage, and run projects — all inside that tiny time budget. The tool must make every one of the 180 minutes count:
decide what to do this week, remind follow-ups, keep the pipeline moving, run delivery projects without overrun, and review weekly.

Design principles:
- **Time budget is the core constraint.** Everything (leads follow-up, activities, project next-actions, admin) carries a minute estimate and the planner never plans more than the weekly
  budget (default 180 min, configurable; default split Sales 90 / Delivery 60 / Admin+Review 30, configurable, with automatic rebalancing when delivery is empty).
- Trade-agnostic: do not assume what the business sells; the user configures an "offer" (name, price, delivery hours). Examples in docs may use a consultant/freelancer.
- Local-first: Python 3.13 stdlib only (`sqlite3`, `argparse`, `http.server`, `json`, `datetime`, `zoneinfo`; timezone default Asia/Tokyo), no network calls, no pip dependencies
  (pytest for tests is available). All user-facing text is Chinese (simplified); message templates also available in Japanese and English.
- Package `solobiz/` with `python3 -m solobiz <command>`, data in `~/.solobiz/solobiz.db` (override with `SOLOBIZ_HOME`; tests always use a temp dir). Money as integer minor units, dates ISO.
- Environment: Python `/opt/homebrew/Caskroom/miniconda/base/bin/python3`; run tests with `python3 -m pytest -q tests` (offline, < 30 s). Commit nothing (aam commits). Never push. Never write outside the worktree
  (tests use temp dirs). Keep modules small, typed, tested; CLI commands support `--json`.
- Docs in Chinese (`README.md`), keep `NOTES.md` with decisions/limitations.
