Project / delivery management with a hard capacity.

Projects with milestones and next-actions (estimates in minutes), **WIP limit 2 active projects** (starting a third requires pausing one, with a clear message), capacity check:
`project start <id>` computes remaining minutes vs weeks left at the delivery share (60 min/week by default) and warns「按当前节奏将延期 N 周」/ suggests scope cuts or schedule change.
Timer: `time start --kind delivery --ref project:3`, `time stop`, `time add --minutes 25`, `time week` (by kind vs plan). Burn-down per project (planned vs spent), overrun alert at 80%, `project risks`
(due soon & not enough capacity, no next action defined, idle > 14 days). Every active project must always have exactly one defined next action (`project next <id>`). Tests: capacity math across week boundaries (Asia/Tokyo), WIP enforcement,
timer edge cases (stop without start, overlap), risk detection.
