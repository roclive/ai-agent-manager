# Native MLX evaluation — AAM-39

2026-10-20 JST. **AAM-39 passes its current acceptance:** the pinned native MLX 4-bit
`mlx-community/LFM2.5-2.6B-4bit` snapshot loaded and generated non-empty text using
`mlx-vlm` on MLX. No model files were downloaded or added to git. This is a smoke result,
not a coding benchmark or a recommendation for production routing.

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
| mlx-community/LFM2.5-8B-A1B-MLX-4bit | 146590a491db88581884033023f51f6b49a27b89 | 4,764,265,165 | 4,782,228,614 | Not needed after the 2.6B candidate passed |
| mlx-community/LFM2.5-2.6B-4bit | 72a08228cf703cd7dc0187abf4edbbd8e935f864 | 1,517,625,850 | 1,535,593,294 | Loaded and generated text with native MLX via mlx-vlm; passed |
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
of these distributions. No package was installed or upgraded. The actual successful
inference backend was `mlx-vlm`; the failed pure `mlx-lm` attempt is recorded below.

The [8B conversion card](https://huggingface.co/mlx-community/LFM2.5-8B-A1B-MLX-4bit/blob/146590a491db88581884033023f51f6b49a27b89/README.md)
reports mlx-lm 0.31.1. The [2.6B conversion card](https://huggingface.co/mlx-community/LFM2.5-2.6B-4bit/blob/72a08228cf703cd7dc0187abf4edbbd8e935f864/README.md)
reports mlx-vlm 0.6.10 and an image-generation example, conflicting with the text-only
architecture. Its automatic mlx-lm usage example did not establish support; the live
smoke below resolved runtime compatibility by loading with `mlx-vlm`.

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
Gemma comparison was not needed after the 2.6B candidate passed; the cache inspection
itself is complete.

The 8B artifact independently exceeds 4GB even considering weights alone. It was not
needed after the smaller candidate passed. No OptiQ artifact was downloaded or evaluated.

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
| Short text smoke | not needed | not needed | passed with native MLX / mlx-vlm |
| Fixed 8 coding + 2 tool prompts | unknown | not run | not run |
| Tool-call validity / coding pass rate | unknown | unknown | unknown |
| Prefill/decode tok/s / TTFT / wall time | unknown | unknown | unknown |
| RSS / physical footprint / Metal / mapped memory | unknown | unknown | unknown |
| Sampled peak / swap delta / available-memory before-after | unknown | unknown | unknown |
| opencode client smoke | unknown | not run | not run |

RSS counts resident process pages; physical footprint measures attributed physical
memory; mapped files and Metal allocations have different accounting boundaries and
must not be summed blindly. No ending measurement here is labelled peak.

## Live smoke result (2026-10-20)

The exact pinned cached snapshot was used directly; no download was needed. The first
attempt with `mlx_lm.load` failed during weight loading: its LLM model rejected 600
checkpoint keys prefixed with `language_model.model.*`. This showed that this artifact's
packaging is incompatible with that pure LLM loader. The same snapshot then loaded and
generated successfully with `mlx-vlm 0.7.8`, using `MLX 0.32.4` in the Homebrew oMLX
Python environment (`mlx-lm 0.31.4.dev132+g94cdcae13` was also installed). No oMLX server
or persistent service was started.

- Repository/revision: `mlx-community/LFM2.5-2.6B-4bit` at
  `72a08228cf703cd7dc0187abf4edbbd8e935f864`.
- Backend: direct `mlx-vlm.load` / `mlx-vlm.generate`, native Apple MLX 0.32.4; source
  weights are the repository's 4-bit MLX safetensors.
- Load evidence: `load()` returned model and processor in 2.669 s.
- Input: `Write one short sentence about a quiet garden in the morning.`
- Generated text (48-token cap): `The one short sentence about a quiet garden in the morning. The one short sentence about a quiet garden in the morning. The one short sentence about a quiet garden in the morning. The one short sentence about a quiet garden in the morning.`
- Generation: 4.441 s. Process exit status 0; total wall time 8.644 s; start
  `2026-10-20T00:58:34.107326Z`, finish `2026-10-20T00:58:42.751129Z`. The process
  was run under a 240-second hard timeout and exited normally; no cleanup signal was
  needed.
- Background host observation before the successful attempt: 16 GiB RAM and 1,103 MiB
  swap used. Memory was informational only and no peak sampling was performed.

The acceptance asks for one actual native MLX load and short text generation; that
criterion is met. Other candidates, JSON/tool use, coding prompts, throughput, peak memory,
Gemma/AAM-60 comparison and production routing preference are outside this acceptance and
were not tested.

## Superseded historical observations

The 2026-10-19 no-run notes below document why an earlier worker did not run inference.
They are retained as history only; they do not override the successful smoke or current
acceptance. Prior requirements for AAM-60 comparisons, coding prompt sets, peak memory,
production routing recommendations and 8B download approval do not apply to AAM-39's
current acceptance. No alternative candidate was needed after the 2.6B success.
