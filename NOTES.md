# Implementation choices

- Task sequence numbers are per project. HTTP sort_order (deprecated alias sort) is independent of seq; existing rows migrate from seq. API column ordering uses the status enum order; scheduler priority/seq ordering stays unchanged.
- New dependency changes reject missing identifiers and cycles; legacy missing dependencies remain unsatisfied. Rejected reviews block at max_attempts, as failed worker runs do.
- Merge uses a temporary integration worktree, preserving the project's main checkout. A target branch already checked out elsewhere is refused by Git.
- Configured setup/test/routine commands are trusted shell commands. Task and review text travel through files or direct process arguments, never interpolated into shell code.
- Opencode uses a tiny Node launcher to read prompt.md into a direct argv value; the detached shell wrapper never receives task text.
- This session cannot write the repository's `.git` directory. Milestone commits are preserved in `/tmp/aam-implementation.git` and exported to `aam-implementation.bundle` for import.
- Numeric HTTP task IDs and human identifiers are both accepted. Identifier allocation uses existing identifier suffixes, so changing `sort` does not cause collisions.
- Tests are explicitly restricted to `tests/` to exclude the ignored vendored Paperclip source. Test process guards reject real AI CLI invocations.
- Setup/test commands have bounded execution times; shell routines and Claude reviews have a two-minute bound. Timeout runs consume an attempt. Lost runs increment lost_count instead; passing tests (or no configured tests) plus HEAD differing from the SHA captured at dispatch recover to review, otherwise retry until the third loss blocks the task. Recovery takes precedence over the loss threshold. Lost feedback is the test tail. Existing runs without a start SHA cannot establish recovery and retry conservatively.
- Cron routines are loaded and reconciled at each daemon interval; missed occurrences while the daemon is stopped are not replayed.
- HTTP task creation uses `{project: "KEY", title, ...taskFields}`; dependency arrays are stored as JSON text in SQLite responses. Run selection (`logs --run`) uses the database run ID. Pruning refuses dirty worktrees rather than discarding uncommitted files.

- Manager review fixes supersede the original spec: aam commits worker changes from last.md (summary line capped at 72 characters, body at 4096 UTF-8 bytes); workers leave changes uncommitted. Dependency merges precede setup, skip missing/contained branches, and abort conflicts; only newly created branches/worktrees are removed on conflict. Preparation errors block dispatch without consuming worker attempts. Rate-limit detection requires a failed/unknown exit and an error-bearing log line.

- Status daemon liveness: a live `tick.lock` PID, or a heartbeat (`last_tick_at`) within the last 180 s (`last_tick_age_s` is returned). Routine firing history uses routine_fire events keyed by stable routine ID (older name-only events are not backfilled). SSE starts from the latest event ID unless `Last-Event-ID` (resume) or `?replay=K` (last K events) is supplied.

## AAM-5 UI
- Paperclip components are copied into ui/src and adapted locally; there are no runtime vendor imports.
- Legacy server rejects fractional `sort` values (it stores them in positive-integer seq). Midpoint reordering uses the AAM-4 contract; legacy fallback rounds to a positive integer so status moves still work. Adjacent legacy positions may tie until AAM-4 adds REAL sort_order. Task identifiers are never edited.
- Missing legacy status/runs endpoints show unavailable daemon state / no running indicators; SSE failures fall back to polling.
- Project colour is taken from the API when supplied, with a neutral fallback because AAM-4 does not specify a colour field.

## AAM-6 UI
- Routines use the local scheduler time zone. A small Chinese cron helper describes the four supported presets; custom expressions are displayed verbatim and validated by the server.
- Activity uses an event-ID cursor and server-side project/task/kind filters. Project filters include events associated with that project's tasks; workspace settings/routine events remain in the all-projects feed.
- Bulk task moves are independent requests: successful changes remain if another task is rejected, and an error reports the failed count. Task status protections remain enforced by the API.
- Task descriptions render through react-markdown without raw HTML. Task/run statuses retain their original values in history; task status and role controls use Chinese labels.

## AAM-7 UI / launchd
- Backlog keeps the task ID and title together in one sticky column; other columns scroll horizontally. Project chips use a deterministic key colour.
- Cron input checks only for five or six whitespace-separated fields; the scheduler remains authoritative for syntax and ranges.
- launchd status keeps the existing top-level daemon fields for compatibility and adds a services array with daemon/UI state, PID and last exit code. The injectable user-home path isolates plist/log paths in tests.

AAM-8: Project opt-in safety takes precedence over the legacy global review_mode=claude tick path: non-opted-in projects remain manual. Model tools, hooks, project settings and MCP are disabled; all required repository context is supplied in stdin. Durable job reservations count against the local-day budget, including failures and test-gate rejections. Results are applied on a subsequent tick, and promotions are dispatched on the following tick. Blocked/cancelled tasks do not prevent planning when the active queue is drained.

AAM-9: Integration is opt-in; existing projects remain disabled. Promotion's --into must match the configured base branch. Conflicts are retried through at most two resolution tasks per original; operational Git failures are recorded as integration_error and leave the approved task pending integration. Integration-enabled worktrees skip dependency merges because approved dependencies are supplied through the integration tip.

AAM-11: Review age uses task.updated_at (the existing review epoch); project rank breaks age ties. Consecutive timeout history is durable per task and resets on a non-timeout result; each timeout after the third renews the 30-minute pause. Eligibility delays are checked on heartbeats. Bottleneck counts subtract dependency-ready queued work after backlog promotion from free worker capacity. Large-file filtering uses the maximum blob size on the merge base and task branch, including deleted files.

AAM-12: reviewer defaults to Codex for autopilot review/planning/health; legacy
review_mode remains accepted. Claude health keys remain readable for Claude,
while status exposes compatibility aliases for the selected reviewer.
Verified codex exec --help flags. Manual minimal-environment smoke invocation was
attempted once, but this execution sandbox rejected app-server initialization
with EPERM before authentication; login success cannot be confirmed here.
