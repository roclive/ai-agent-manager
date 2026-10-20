# Native MLX evaluation — AAM-39

2026-10-19 JST. **Metadata preflight completed; runtime evaluation is still pending.**
The cached 2.6B model was not downloaded, loaded, converted, or served by this worker.
No recommendation for unattended AAM-37 coding is established. Automatic local routing
remains unchanged.

## Verified artifacts

HF API `GET /api/models/<id>?blobs=true` supplied revisions and individual file sizes.
Config and tokenizer metadata were fetched from those immutable revisions. Full file
manifests, config quantization overrides and chat templates are in
[evidence/lfm-metadata.json](evidence/lfm-metadata.json). Upstream revision/source hashes
are in [evidence/lfm-upstream.json](evidence/lfm-upstream.json). These are metadata only;
there are no weights in git. Sizes below use decimal bytes; totals include every file
in the repository manifest, including optional documentation.

| Candidate | Fixed revision | Weight bytes | All repository bytes | Status |
|---|---|---:|---:|---|
| mlx-community/LFM2.5-8B-A1B-MLX-4bit | 146590a491db88581884033023f51f6b49a27b89 | 4,764,265,165 | 4,782,228,614 | Exists; exceeds 4GB; download approval pending |
| mlx-community/LFM2.5-2.6B-4bit | 72a08228cf703cd7dc0187abf4edbbd8e935f864 | 1,517,625,850 | 1,535,593,294 | Cached complete at pinned revision; within 4GB; load not attempted |
| Gemma4 E4B MLX 4-bit (AAM-60) | unknown | unknown | unknown | Comparison pending: no AAM-60 result found; no HF Gemma MLX snapshot cached |

Sources: [8B config](https://huggingface.co/mlx-community/LFM2.5-8B-A1B-MLX-4bit/blob/146590a491db88581884033023f51f6b49a27b89/config.json),
[2.6B config](https://huggingface.co/mlx-community/LFM2.5-2.6B-4bit/blob/72a08228cf703cd7dc0187abf4edbbd8e935f864/config.json).

8B uses `Lfm2MoeForCausalLM` / `lfm2_moe`: 24 hybrid layers, 18 convolution and
6 attention, 32 experts with top-4 routing. LiquidAI specifies 8.3B total / 1.5B active
parameters. Config context is 128,000. Quantization is affine, group size 64, nominal
4-bit, with explicit **8-bit feed-forward gate overrides**. This is not a separate
8-bit model evaluation. All experts still require storage; active parameters do not
predict resident memory. [Official 8B card](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B).

2.6B uses `Lfm2ForCausalLM` / `lfm2`, a dense hybrid, not a 24B MoE. LiquidAI specifies
2.69B total parameters and 131,072 context tokens; this MLX config instead specifies
128,000. Quantization is affine 4-bit, group size 64, without gate overrides.
Its config includes an empty `vision_config` despite the upstream model being text-only.
[Official 2.6B card](https://huggingface.co/LiquidAI/LFM2.5-2.6B).

Both use LFM Open License v1.0. Commercial permission is conditional on the license's
annual-revenue threshold ($10 million); redistribution requires the license, notices,
and modification attribution. Consult the exact linked terms before distribution;
this report does not establish eligibility.
[8B license](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B/blob/5dd22602c2e9f6a097b1de4c4efe0658b605015c/LICENSE).
The upstream evidence links the separately pinned 2.6B license as well.

## Runner and template preflight

The installed `omlx --version` returned `0.7.1rc1`. Its own Python environment reports
`mlx-lm 0.31.4.dev132+g94cdcae13`, `mlx-vlm 0.7.8`, `mlx 0.32.4`; both
`mlx_lm.models.lfm2` and `mlx_lm.models.lfm2_moe` resolve. The default `python3` has none
of these distributions. No package was installed or upgraded. Resolving architecture
modules is evidence of available implementation, **not evidence of successful loading
or omlx tool-call compatibility**. Actual inference runner/backend remain unknown.

The [8B conversion card](https://huggingface.co/mlx-community/LFM2.5-8B-A1B-MLX-4bit/blob/146590a491db88581884033023f51f6b49a27b89/README.md)
reports mlx-lm 0.31.1. The [2.6B conversion card](https://huggingface.co/mlx-community/LFM2.5-2.6B-4bit/blob/72a08228cf703cd7dc0187abf4edbbd8e935f864/README.md)
reports mlx-vlm 0.6.10 and an image-generation example, conflicting with the text-only
architecture. Its automatic mlx-lm usage example is insufficient to establish support.
A bounded load must resolve this discrepancy before benchmarking.

Saved tokenizer templates contain role delimiters, tool definitions and tool-call tokens.
LiquidAI documents Python-style calls delimited by `<|tool_call_start|>` and
`<|tool_call_end|>`, with JSON available through explicit prompting. A parsed JSON string
does not establish OpenAI tool-call interoperability. The 2.6B reasoning template can
spend its entire short output budget thinking; a future empty visible answer must retain
raw reasoning/content, finish_reason and token usage rather than be scored successful.
[Tool-use guide](https://docs.liquid.ai/lfm/key-concepts/tool-use).

## Cache and prior evidence inspection

The read-only HF cache inspection found the complete
`mlx-community/LFM2.5-2.6B-4bit` snapshot at revision
`72a08228cf703cd7dc0187abf4edbbd8e935f864`. Its `model.safetensors` is
1,517,625,850 bytes; the snapshot contains the manifest files and totals
1,535,593,294 bytes, matching the pinned HF API manifest. The similarly named
`LiquidAI/LFM2.5-2.6B-MLX-4bit` cache is a separate repository/revision and is not
substituted for the requested candidate. No Gemma MLX HF snapshot was present in the
cache. No files were downloaded or modified during this inspection.

No AAM-60 result or prompt set was present in this worktree or the inspected local AAM
records. `docs/local-llm-smoke.md` records that the Ollama tag `gemma4:e4b-mlx` was
pulled/present at 9.46 GB on disk, but was never loaded or benchmarked because the
then-current memory check said “not run: memory”. That is not an MLX-native AAM-60
runtime result and supplies no comparable coding, latency, or residency measurements.
Gemma comparison therefore remains specifically pending its AAM-60 evidence (or a
separately authorized native MLX evaluation); the cache inspection itself is complete.

The 8B artifact independently exceeds the 4GB cap even considering weights alone. **Decision
required from the user:** whether to authorize downloading its 4,764,265,165-byte weight
artifact despite the per-model 4GB cap. Until that decision, it is not downloaded or
evaluated. No OptiQ artifact was downloaded or evaluated.

A read-only process snapshot found no active LFM download or omlx process. Earlier
observations in the prior report of three `hf download` processes are historical only;
this worker did not signal or stop any process. AAM-38 was not restarted.

Host observation: arm64, 17,179,869,184 bytes RAM. At inspection, vm_stat page size was
16,384; free=5,849, inactive=287,789, speculative=9,273, giving 4,962,893,824 bytes by
AAM-26's informational formula. Swap used was 1,803.81 MiB. These are single host
observations, not model residency, available-memory guarantees, deltas or peaks.
No cleanup was necessary because no helper/server/model was started by this worker.

| Runtime evidence | Gemma4 E4B | LFM 8B | LFM 2.6B |
|---|---|---|---|
| Short text / JSON / tested edit smoke | unknown | not run | not run |
| Fixed 8 coding + 2 tool prompts | unknown | not run | not run |
| Tool-call validity / coding pass rate | unknown | unknown | unknown |
| Prefill/decode tok/s / TTFT / wall time | unknown | unknown | unknown |
| RSS / physical footprint / Metal / mapped memory | unknown | unknown | unknown |
| Sampled peak / swap delta / available-memory before-after | unknown | unknown | unknown |
| opencode client smoke | unknown | not run | not run |

RSS counts resident process pages; physical footprint measures attributed physical
memory; mapped files and Metal allocations have different accounting boundaries and
must not be summed blindly. No ending measurement here is labelled peak.

## Next authorized run and recommendation

The 2.6B pinned artifact is complete in the user cache, so no download is needed for its
bounded load smoke. This attempt did not proceed: no shared AAM local-model lock was
available in the task worktree, and the existing memory helper failed to obtain process
footprints (permission errors for unrelated processes). A read-only host snapshot showed
5.34 GiB by the AAM-26 available-memory formula and 1,338.31 MiB swap used; several other
AAM Codex workers were active. These are host observations, not model residency. No
inference process was started, so there is no post-run measurement. Re-run only when the
shared single-run lock is available and memory monitoring is reliable. The 8B size
decision remains required before any download. Use one owned server/process group and
one request at a time. Record AAM-26 memory observations before/after; no sudo purge or
user-app cleanup. Prefer omlx with this pinned environment, verify actual native MLX
backend, and save bounded-load errors.

### Current recheck (2026-10-19)

The pinned 2.6B snapshot remains fully cached (1,535,593,294 repository bytes), and the
8B artifact still exceeds the 4GB download cap. No AAM-60 Gemma MLX benchmark, test prompt
set, or model snapshot is available in this checkout. The current host sample is about
0.85 GiB by the AAM-26 free+inactive+speculative page formula; `sysctl vm.swapusage`
reports 1,319 MiB used. `ps` showed no `omlx` or `mlx_lm` process. A fresh
`aam memory --top 20` attempt emitted permission failures for unrelated PIDs and could
not produce a useful footprint inventory; this helper scans the whole host and has no
candidate-PID-only mode. No shared model lock was found. The footprint scan could not
inspect unrelated processes, so peak and process-boundary measurements are unavailable.
No inference process was started; no files were downloaded and no other process was
signalled. This headroom is insufficient for responsibly attempting a model load under
the task's memory-observation and owned-process cleanup constraints. These are blocker
observations, not a model load failure or a model capability result.
Use a 180-second total smoke deadline and 45-second per-request deadline; a supervisor
must enforce the total across load and requests and clean only owned processes.
Save complete raw response, finish_reason, reasoning, timing and exit status.

Smoke sequence: short answer, schema-checked JSON and an actual tool-call validation,
then a small edit tested against expected behavior. Stop on any failure. Only a passing
candidate enters the same frozen eight coding tasks plus two JSON/tool prompts used for
the Gemma comparison. The AAM-60 prompt set/results must be supplied before claiming
comparability; don't invent substitute scores. Sample memory throughout; preserve raw
samples and metric definitions. Skip long-context testing unless a specific requirement
needs one bounded 8k retrieval check. Record opencode separately from backend quality.

`local_model_preference`: **none validated**. No preference order can be recommended until
the pending live smoke and comparable Gemma results exist. Proposed evaluation
order is 8B (only after explicit size approval), then 2.6B; its smaller weight footprint makes 2.6B a
plausible memory candidate, not a measured winner. Do not promote either for AAM-37
until the smoke and test-gated coding evidence pass. Reuse AAM-60 Gemma evidence when
available. Formal model catalog and auto/manual routing remain with AAM-62/63,
GW-9/10 and AAM-64; no fallback code changes were needed here.

## Review feedback and offline validation

The previous review finding was that real model evaluation and comparison were missing.
The hardware check remains unresolved because this attempt had no shared model lock and
could not collect process-footprint measurements; tests do not represent that inference
passed. Existing offline evidence regressions cover the preflight findings: over-limit
8B weights, gate precision overrides, dense 2.6B identity/context discrepancy,
runner-card discrepancy, and templates remaining distinct from runtime verification. No
test loads a model or invokes a real worker. Offline test success cannot satisfy the
pending hardware checks.

Validation on this worktree: core `npm test -- --maxWorkers=1 --testTimeout=60000
--hookTimeout=60000` passed **245 tests / 27 files**, exit 0; `npm run typecheck`
passed, exit 0. UI `npm test -- --maxWorkers=1 --testTimeout=60000
--hookTimeout=60000` passed **45 tests / 8 files**, exit 0; `npm run typecheck`
passed, exit 0. `git diff --check` passed. These offline results include a regression
that keeps the pending live-smoke finding open; they are not real MLX inference
acceptance.

## Review recheck (2026-10-20)

- **P1 live evaluation:** still unresolved. This recheck found no AAM-60 Gemma MLX
  results, frozen prompt set, or Gemma MLX model cache. The cached LFM 2.6B artifact
  remains available, but no inference was started. At inspection, the host reported
  5.13 GiB by the AAM-26 free+inactive+speculative formula and 1,119 MiB swap used;
  active Codex workers were present, including this task, and unrelated Claude/Codex
  application processes were running. There is no candidate-only physical-footprint
  sampler in the documented AAM-26 helper, and no established shared model lock was
  found. These conditions do not support safe, scoped peak measurement, so the smoke,
  coding benchmark, and Gemma comparison remain **not run**, not model failures.
  No process was signalled and no model was downloaded or unloaded. The 8B candidate
  remains over the 4GB limit. The P1 review finding is therefore not satisfied and
  `local_model_preference` remains none validated; AAM-37 unattended coding is not
  recommended based on this evidence.
- **P1 delivery:** not satisfied. This report and its offline regressions record missing
  evidence; they do not substitute for load, JSON/tool-call, edit smoke, coding benchmark,
  or comparable Gemma results. Completion remains blocked on bounded MLX runtime evidence.
- **P1 scope:** resolved at the task branch base. The branch diff contains only the
  AAM-39 evaluation report and evidence tests, plus the separately requested manager
  citation correction and regression. No routing/catalog integration is included.
- **P2 8B cap:** no download was made. The artifact is 4,764,265,165 bytes and requires
  explicit user authorization to exceed the 4GB per-model limit. The cached 2.6B candidate
  is within the cap, but the runtime attempt remains unsafe under observed host conditions.
- **P3 citation:** fixed the malformed scheduler citation in `docs/MANAGER.md`; a regression
  asserts the correct path and rejects the garbled fragment.
- **P3 test count:** the latest core Vitest output on this worktree reports 245 tests
  across 27 files, exit 0. The stale 244 count is corrected above. A regression now
  checks that the report preserves 245 and rejects the old count.
- Added report regressions also assert that absent AAM-60 evidence and unrun live
  inference remain explicit. These offline checks document the unresolved P1; they do
  not claim that a model was loaded or evaluated.
