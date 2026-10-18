Stop auto-review from parking tasks in `blocked` while attempts remain, and stop feedback from being lost. (00-ui-context.md rules apply; backend.)

Observed tonight: TM-2 and SB-3 were each rejected twice by the Codex reviewer with valid, concrete findings; the rule "two consecutive auto rejects → blocked" parked them although `attempts` (2) < `max_attempts` (3), so a human had to move them back.
Also `aam task move <ID> ready --note ...` overwrote the stored review feedback with the note, so the worker would not have seen the findings.

1. Auto-review reject: always set `status=ready`, `feedback=<full reviewer notes, up to 8 KB>`, `attempts+1`; mark `blocked` ONLY when the new `attempts >= max_attempts` (blocker = "auto-review rejected N times: <notes>"). Remove the "two consecutive rejects" rule. Tests.
2. `task move ... --note` must append the note to events and NEVER overwrite `feedback`. `task move X ready` from `blocked` keeps `feedback` (and resets only `blocker`). Add `aam task retry <ID> [--attempts N]` = move to ready, keep feedback, optionally set attempts (default max_attempts-1, minimum 0) so a human can grant one more try. API: `POST /api/tasks/:id/retry`; UI: a 「再试一次」 button in the task drawer for blocked tasks. Tests.
3. Worker prompt: when `feedback` is non-empty include it under the heading 「上一轮审查意见（必须逐条处理）」 and tell the worker to add a regression test for each finding. Tests on the prompt text.
4. Reviewer calibration: tell the reviewer in the prompt to list findings with severity [P0]–[P3], and to approve (verdict approve, notes listing the nits) when the only findings are [P3] nits or style; reject for any [P0]/[P1]/[P2] correctness, security, data-loss or spec violation. Parse nothing new, just prompt wording; keep tests.
Do not call real codex/claude in tests; do not change project flags.
