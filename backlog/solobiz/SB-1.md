Scaffold + SQLite data model + CLI skeleton.

Tables (migrations via `schema_version`): `settings`, `offers(name, price, delivery_minutes)`, `contacts`, `leads(contact_id, offer_id, stage, value, source, next_action_at, last_touch_at, notes)`,
`deals` (won/lost with reason), `activities` (marketing activity instances: type, planned_week, est_minutes, status, result_notes), `projects(name, client, status, due, budget_minutes)`,
`milestones`, `tasks(project_id|lead_id|null, title, est_minutes, due, status, kind: sales|delivery|admin)`, `time_log(started_at, ended_at, minutes, kind, ref)`, `weekly_plans`, `reviews`.
CLI: `init`, `config get|set` (weekly_minutes, split, timezone), `offer add|list`, `contact add|list|show`, `lead add|list|move|show`, `task add|list|done`, `project add|list|show`, all with `--json`.
Validation (stage names, minutes > 0, dates). Tests: migrations idempotent, CRUD round trips, stage transitions, config defaults (180 = 90/60/30), JSON output schemas. README skeleton.
