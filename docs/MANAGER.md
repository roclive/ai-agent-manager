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
configured interval and from heartbeat routines (`src/scheduler.ts:38-46`,
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

`default_worker` is narrower than its name suggests: it is copied into a task's
legacy `worker` field when the task is created without an explicit worker
(`src/db/index.ts:492-521`). With no explicit executor and no provider policy,
that task field supplies the legacy Codex/opencode choice; an enabled Ollama
backend instead maps to the Codex adapter (`src/core/providers.ts:101-120`). It
does not dynamically ask an LLM to choose. Claude can also be a coding executor
through the newer executor setting even though `default_worker` itself accepts
only `codex` or `opencode` (`src/core/executors.ts:27-33`,
`src/db/index.ts:356-358`).

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

## Current requested settings

| Setting | Live value | Meaning in the current code |
| --- | --- | --- |
| `default_worker` | `codex` | New tasks without an explicit worker receive legacy worker `codex`; executor/provider overrides can supersede it. |
| `review_mode` | `claude` | Legacy setting only. Current dispatch/autopilot code does not read it; per-project `auto_review` gates automatic review. |
| `reviewer` | `claude` | Without provider-policy substitution, planning, review, and reviewer health checks use Claude on the primary backend. |
| `llm_backend` | `primary` | Effective backend is primary; this setting would select Ollama only while `ollama_fallback_enabled=1`. |
| `planner_daily_max` | `10` | At most ten non-rate-limited planner jobs are counted per local calendar day. |

The defaults installed for new databases are different only for
`review_mode`: `default_worker=codex`, `review_mode=manual`, `reviewer=codex`,
`llm_backend=primary`, and `planner_daily_max=10`
(`src/db/index.ts:173-213`). The live values above describe this manager, not
those initialization defaults.
