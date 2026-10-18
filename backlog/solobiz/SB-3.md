Sales pipeline, follow-up cadence and message templates.

Stages: 线索 → 已联系 → 面谈 → 报价 → 成交 / 流失. Cadence rules (configurable table): after contact follow up in 3 days, then 7, then 14, then park; after proposal 2/5/10 days; stale detection (no touch >
threshold) lists「需要唤醒」. Lead score (0–100) from value, stage, recency, source quality. `pipeline show` (value per stage, weighted forecast, conversion rates), `pipeline due [--date]` (what to touch today with a minute estimate each:
email 10 min, call 20 min, proposal 40 min), `lead touch <id> --note --next 7d`.
Template engine (`solobiz/templates/`, plain text with `{{placeholders}}`; zh/ja/en): first outreach, referral ask, follow-up #1/#2/#3, meeting confirmation, proposal cover, won/lost thanks, invoice reminder, testimonial request;
`message draft <lead-id> --kind followup1 --lang ja` fills from the lead/contact/offer. Tests: cadence dates, scoring monotonicity, forecast math, template rendering/missing placeholder errors in all languages.
