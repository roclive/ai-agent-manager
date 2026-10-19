# Local LLM memory helper

`npm run aam -- memory` (or `scripts/local-llm-memfree.sh`) inspects memory before/while running
the local worker (opencode + gemma4 e4b-mlx via omlx). It is **read-only** unless `--stop-service` is given.

- Top processes by real footprint (`footprint -p <pid>`, not RSS): `aam memory --top 10`
- Available memory = (free + inactive + speculative pages) × page size from `vm_stat`, plus `memory_pressure`.
- `aam memory --stop-service omlx` gracefully stops the service via `brew services stop omlx`
  (fallback `launchctl bootout gui/<uid>/homebrew.mxcl.omlx`).

## Safety
- Allow-list: only `omlx` / `homebrew.mxcl.omlx`. Anything else is refused.
- Hard deny-list (never signalled, never stopped): aam daemon/UI, OntoKB, Paperclip,
  Claude/Codex/ChatGPT, WindowServer. The helper never sends signals to PIDs at all.
- No memory gate: the former 12 GB free-memory refusal is removed; this tool is informational.
  It is never invoked automatically by health checks or the planner.

Tests (`tests/memory.test.ts`) use fake ps/footprint/vm_stat/memory_pressure/brew runners.
