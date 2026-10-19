# Native MLX evaluation — AAM-39

2026-10-19 JST. **Metadata preflight completed; real model evaluation remains blocked.**
No model was downloaded, loaded, converted, or served by this worker. No recommendation
for unattended AAM-37 coding is established. Automatic local routing remains unchanged.

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
| mlx-community/LFM2.5-2.6B-4bit | 72a08228cf703cd7dc0187abf4edbbd8e935f864 | 1,517,625,850 | 1,535,593,294 | Exists; within 4GB; load not attempted |
| Gemma4 E4B MLX 4-bit (AAM-60) | unknown | unknown | unknown | Comparison pending: no AAM-60 result in this worktree |

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

## Why runtime results are pending

The worker is explicitly restricted to writing inside this worktree, while task policy
requires model downloads in the user cache. No cache was written or inspected outside
the worktree. The 8B artifact also independently exceeds the 4GB limit, even considering
weights alone, and needs a user decision. No OptiQ artifact was downloaded or evaluated.

A read-only process snapshot found three pre-existing `hf download` processes for LFM
2.6B (PIDs 34270, 34271, 37558). They predated this worker's inspection and are not owned
by it. None was stopped, signalled, or assumed to have completed. This is an additional
reason to coordinate a shared-lock run with the manager rather than start competing work.
No active omlx process appeared in that snapshot. AAM-38 was not restarted.

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

First resolve cache-write permission and the 8B size decision; check exact cached
revision and missing bytes without duplicating other downloads. Use the shared local
model lock, one owned server/process group and one request at a time. Record AAM-26
memory observations before/after; no sudo purge or user-app cleanup. Prefer omlx with
this pinned environment, verify actual native MLX backend, and save bounded-load errors.
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

`local_model_preference`: **no validated production order yet**. Proposed evaluation
order is 8B (after size approval), then 2.6B; its smaller weight footprint makes 2.6B a
plausible memory candidate, not a measured winner. Do not promote either for AAM-37
until the smoke and test-gated coding evidence pass. Reuse AAM-60 Gemma evidence when
available. Formal model catalog and auto/manual routing remain with AAM-62/63,
GW-9/10 and AAM-64; no fallback code changes were needed here.

## Review feedback and offline validation

Supplied previous feedback contains only successful core/UI test logs, with no concrete
finding or failing assertion. There is no defect description to reproduce. Added offline
evidence regressions for the actual preflight findings: over-limit 8B weights, gate
precision overrides, dense 2.6B identity/context discrepancy, runner-card discrepancy,
and templates remaining distinct from runtime verification. No test loads a model or
invokes a real worker. Offline test success cannot satisfy the pending hardware checks.

Validation on this worktree: core `npm test -- --maxWorkers=1 --testTimeout=60000
--hookTimeout=60000` passed **242 tests / 27 files**, exit 0; `npm run typecheck`
passed, exit 0. UI `npm test -- --maxWorkers=1` passed **45 tests / 8 files**,
exit 0; UI `npm run typecheck` passed, exit 0. `git diff --check` passed.
The first default-parallel core invocation was stopped after unrelated existing tests
exceeded deadlines amid multiple other worktree suites; the first UI invocation had
one board-query timeout (44/45 passed). Both suites passed on the bounded-concurrency
rerun without changing their assertions or application code. These offline results
include five new evidence checks, not real MLX inference acceptance.
