# Manager decision audit

Audit date: 2026-10-19. The “current settings” below were read from the live
`$AAM_HOME/aam.db`; the cited source lines describe this checkout.

## Executive answer

The daemon does **not** ask an LLM which ready task to run. Task selection,
eligibility, concurrency, promotion, and provider/executor routing are
rule-based. An LLM is used only after those rules launch an autopilot planning
or review job: it proposes new tasks for a drained project or judges a completed
task. Its output is validated and applied by deterministic code.

## 1. Which ready task is picked?

**Decision: rule-based.**

`Repo.tasks()` always returns tasks ordered by `priority`, then project-local
`seq`, then database `id` (`src/db/index.ts:471-480`). On each tick, the daemon
walks that ordered `ready` list, stops when `max_parallel` is full, skips tasks
whose dependencies are incomplete, skips conflicting integration-resolution
work, skips tasks blocked by the applicable cooldown, and dispatches the first
eligible tasks (`src/core/tick.ts:53-68`). Dependency eligibility itself checks
that every dependency is `done` and, when the dependency's project uses an
integration branch, integrated (`src/core/dispatch.ts:27-40`). No prompt or LLM
call participates in this choice.

The scheduler adds no intelligence to this decision. It calls `tick()` on the
configured interval and from heartbeat routines (`src/scheduler.ts`, there is no `src/core/scheduler.ts`: `:38-46`,
`src/scheduler.ts:137-146`). A `create_task` routine merely inserts its payload;
it does not use an LLM (`src/scheduler.ts:46-48`).

Autopilot can refill empty worker capacity from `backlog`, but that promotion is
also rule-based: enabled projects are ranked by `autopilot_rank`, least-recent
work, priority, `sort_order`, and id (`src/core/autopilot.ts:656-710`). The newly
promoted task becomes eligible on a later tick because dispatch happens before
promotion in the tick (`src/core/tick.ts:53-73`).

## 2. Which worker runs it?

**Decision: rule-based configuration and availability checks, not LLM-chosen.**

At dispatch, `choose()` resolves the effective coding executor. Precedence is
task override, then project override, then global `coding_executor`
(`src/core/executors.ts:58-74`). An explicit executor is selected directly,
subject only to its configured fallback chain, installation, operator pause,
cooldown, and quota (`src/core/executors.ts:92-124`). In `auto` mode, deterministic
provider policy and quota rules select the first capable available provider;
free/local providers rank ahead of standard providers and configuration order
breaks ties (`src/core/providers.ts:88-169`). `dispatch()` performs that choice
and then launches the selected worker (`src/core/dispatch.ts:57-63`,
`src/core/dispatch.ts:88-107`, `src/core/dispatch.ts:179-211`). No LLM recommends
or votes on the route.

**Live answer: Claude.** The live global `coding_executor` is `claude`
(source: global setting). `resolveExecutor` returns it unless a task or project
sets its own executor (`src/core/executors.ts:58-74`), and because it is not
`auto`, `choose()` hands it straight to `selectExecutor`
(`src/core/dispatch.ts:57-59`). That bypasses `selectProvider` and the legacy
`task.worker` / `default_worker` path entirely, so ready tasks currently run on
Claude unless a task/project override says otherwise. The live snapshot has no
`executor_fallback`, `routing_overrides` or `provider_policy` rows (all
unset/empty), so there is no fallback chain, no operator pause list, and the
`auto`/provider-policy branch is not active.

`default_worker` is therefore effectively dormant. It is only copied into a
task's legacy `worker` field when the task is created without an explicit worker
(`src/db/index.ts:520`). That field matters only on the legacy path
(`coding_executor=auto`, no `provider_policy`), where `task.worker` decides
between Codex/opencode, and an enabled Ollama backend maps to the Codex adapter
(`src/core/providers.ts:101-120`). `default_worker` accepts only `codex` or
`opencode` (`src/db/index.ts:357`). No LLM chooses the worker.

## 3. Autopilot planning and review

### When planning/review happens

**Decision: rule-based.** Autopilot first requires a healthy configured reviewer
and no applicable global cooldown (`src/core/autopilot.ts:728-743`). Reviews are
queued oldest-updated first, then by project rank and id, only for projects with
`auto_review` enabled, within concurrency/daily limits and retry/backoff rules
(`src/core/autopilot.ts:744-808`). Planning is attempted only when no plan is
pending, the daily budget remains, and an autopilot-enabled project with a goal
is fully drained; projects are considered by `autopilot_rank` and backoff rules
(`src/core/autopilot.ts:834-863`). `planner_daily_max` limits plan launches; it
does not choose their content (`src/core/autopilot.ts:87-105`,
`src/core/autopilot.ts:834-837`).

### What planning/review decides

**Decision: LLM-chosen content/verdict, inside rule-based guardrails.** The
planner prompt asks the selected reviewer/provider LLM for 3–5 new tasks
(`src/core/autopilot.ts:478-499`). Code then validates task count, fields,
priorities, roles, dependencies, and acyclicity before inserting anything
(`src/core/autopilot.ts:440-470`, `src/core/autopilot.ts:609-636`).

For review, code builds a bounded prompt from the task, test result, diff stat,
file list, and diff, then asks the selected reviewer/provider LLM for an
`approve`/`reject` verdict (`src/core/autopilot.ts:331-411`,
`src/core/autopilot.ts:809-828`). Code parses the answer, rejects when tests did
not pass, and applies approval/rejection; stricter confidence/context gates are
used for the gateway reviewer (`src/core/autopilot.ts:561-608`). Thus the
quality judgment is LLM-made, while eligibility, budgets, safety checks,
parsing, and state transitions are rule-based.

The reviewer/provider is itself selected by rules. With provider policy it is
chosen by the same capability/quota router; otherwise `reviewer`, `llm_backend`,
and gateway configuration map directly to GW, Ollama/Codex, Claude, or Codex
(`src/core/autopilot.ts:243-276`). `llm_backend=ollama` is effective only when
`ollama_fallback_enabled=1`; otherwise the effective backend is `primary`
(`src/core/llm.ts:6-11`).

For the primary Codex reviewer, AAM passes `--ignore-user-config` so a personal
`~/.codex/config.toml` that points at a local Ollama endpoint cannot silently
redirect reviews. Authentication still comes from `CODEX_HOME`; when
`primary_model` is configured AAM passes it explicitly. The Ollama route is
opt-in through the fallback backend and receives its own local-provider/model
arguments. Changing `reviewer` does not change `coding_executor`, and changing
the coding executor does not change reviewer routing.

## Current requested settings

| Setting | Live value | Meaning in the current code |
| --- | --- | --- |
| `coding_executor` | `claude` (global) | Authoritative: non-`auto` executor goes through `selectExecutor`; task/project overrides win over it. Tasks run on Claude. |
| `executor_fallback` | unset | No fallback chain: if Claude is unavailable the task waits. |
| `routing_overrides` | unset | No operator pauses or allow-list. |
| `provider_policy` | unset | Auto/provider-policy routing is not active. |
| `default_worker` | `codex` | Dormant while `coding_executor=claude`: only stamps legacy `task.worker=codex`, used solely on the `auto` legacy path. |
| `review_mode` | `claude` | Legacy setting only. A repo-wide grep of `src/` finds it only in the defaults and validation in `src/db/index.ts`, so no dispatch/autopilot code reads it; per-project `auto_review` gates automatic review. |
| `reviewer` | `claude` | Without provider-policy substitution, planning, review, and reviewer health checks use Claude on the primary backend. |
| `llm_backend` | `primary` | Effective backend is primary; this setting would select Ollama only while `ollama_fallback_enabled=1`. |
| `planner_daily_max` | `10` | At most ten non-rate-limited planner jobs are counted per local calendar day. |

The defaults installed for new databases are different only for
`review_mode`: `default_worker=codex`, `review_mode=manual`, `reviewer=codex`,
`llm_backend=primary`, and `planner_daily_max=10`
(`src/db/index.ts:173-213`). The live values above describe this manager, not
those initialization defaults.

## Unparseable auto-review results (AAM-54)

The headless Claude reviewer runs with all tools disabled, so its prompt now says it has no tools
(`claudeContextRule` plus `--append-system-prompt`) and must reply with the final JSON verdict only.
If a result is still unparseable (tool-call transcript, prose, malformed JSON) the job is `unparseable`
and the task stays `in_review`. Retries use bounded backoff: 1 min after the first failure, then
30 min × (n−1) after the n-th. After `MAX_UNPARSEABLE` (4) failures since the task last changed, auto
review stops, a `review_stalled` event is raised (at most hourly) and the task id appears in
`/api/status` `autopilot.stalled_reviews`. Recover with `aam review <ID> approve|reject`, or change the
task state (e.g. move to ready and back) — any task update resets the count.

## Manager backend extraction (AAM-49)

`manager_backend` defaults to `rules`. Dispatch now calls `ManagerBackend.decide`
through `choose()`; the executor/provider policy described in this historical audit
lives in `RulesBackend` in `src/core/manager-backend.ts`. Tick supplies eligible
candidates in database priority/sequence order and rechecks eligibility after each
launch. Routing failures leave candidates ready and allow other tasks to proceed.
Provider reservation still rechecks selection in an immediate transaction.
The `claude`, `codex`, and `local-small` names currently delegate to rules as
extension slots; no model decision adapter is implemented by AAM-49.
