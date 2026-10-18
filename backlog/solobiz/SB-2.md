Weekly planner within the 3-hour budget.

`python3 -m solobiz plan week [--date D] [--sessions 3x60|6x30|custom]` builds a concrete plan: candidate items = overdue/due follow-ups (leads with next_action_at), deals nearest to closing,
planned marketing activities for the week, project next-actions (due soon first) and admin musts (invoice, weekly review 15 min). Score = urgency × value ÷ minutes with hard rules
(overdue follow-ups first, never exceed budget, keep per-kind split with automatic rebalance when a bucket is empty, max 2 active projects). Output: ordered sessions with start offsets and
minutes, plus a「放弃清单」(what was dropped and why). `plan today` = the slice for today; `plan carryover` pushes undone items to next week with an aging bonus.
Persist `weekly_plans`; `plan show`, `plan done <item>`, `plan replan` after changes. Tests: budget never exceeded (property-style loop), rebalance, overdue priority, ties deterministic, carryover aging.
