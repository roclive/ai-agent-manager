# Local worker smoke: opencode + gemma4:e4b-mlx (AAM-23)

Date: 2026-10-19 (JST). Result: **NOT RUN: memory.** No success is claimed.

## 1. The ~3.02 GB python process

| item | finding |
|---|---|
| Candidate | pid 654, `/opt/homebrew/opt/omlx/bin/omlx serve` (python@3.11 Python.app), ppid 1, up ~9d 18h |
| Owner / why running | launchd job `homebrew.mxcl.omlx` (a `brew services` job), port 8000, the user's local MLX server (models in `~/.omlx/models`: Qwen3.5-4B-MLX-4bit, Qwen3.5-0.8B-MLX-4bit) |
| Evidence for 3.02 GB | `~/.omlx/logs/server.log.2026-10-09`: "Loaded model: Qwen3.5-4B-MLX-4bit (estimated: 2.97GB)", matching the ~3 GB figure |
| Current state | RSS only ~100 MB. `server.log` shows "Unloaded model: Qwen3.5-4B-MLX-4bit ... Engine pool shutdown" at 2026-10-19 17:35:02, so the model weights are already unloaded and nothing was left to free |
| Measurement limit | `footprint 654` and `vmmap -summary 654` failed in this sandbox (process not visible), so the footprint could not be measured. RSS under-reports MLX memory anyway |
| Other python | pid 75594 is the OntoKB api (:8765), which must not be touched |
| Action | **Nothing stopped.** omlx is a persistent launchd service, not clearly a disposable helper, and stopping it would not have reached the gate (see below). Stopping it is the user's call: `brew services stop omlx` |

## 2. Memory before/after (vm_stat, 16 KiB pages; available = free+inactive+speculative)

| | free | inactive | speculative | available |
|---|---|---|---|---|
| before (17:35) | 12,092 | 345,740 | 25,529 | 383,361 pages = **6.28 GB** |
| after (no action taken, 17:35) | 18,651 | 344,210 | 22,448 | 385,309 pages = **6.31 GB** |

`memory_pressure`: "System-wide memory free percentage: 74%" (this is not the vm_stat-based gate).

Required: >= 12 GB available. Even if the full 3.02 GB had been freed, available would be ~9.3 GB, which is still below 12 GB. Other large residents: Codex/ChatGPT/Claude renderers (~0.7-0.8 GB each), the aam daemon and UI, Paperclip, and a running `codex exec` health worker.

Conclusion: **not run: memory**. The model (`gemma4:e4b-mlx`, 9.46 GB on disk in Ollama 0.40.6, runner `mlx`, capabilities completion/vision/audio/tools/thinking) is pulled but was not loaded (`/api/ps` is empty). The 12 GB guard and the single run lock were left on, and nothing was started from a health check.

## 3. Smoke test results

No measurements were taken, so none are reported:

| metric | value |
|---|---|
| model identity | gemma4:e4b-mlx present in `ollama /api/tags`, not loaded |
| tokens/s, wall time, peak footprint | not run: memory |
| tests passed on code change | not run: memory |
| unloaded afterwards | n/a (never loaded; `/api/ps` empty) |
| settings/owner | unchanged (`claude`); `fallback_worker` was not switched |

To rerun once >= 12 GB is available (e.g. after quitting the desktop apps and running `brew services stop omlx`):
1. Check the guard: free+inactive+speculative >= 12 GB.
2. Set `fallback_worker=opencode` with owner `opencode-fallback` (AAM-22 path, Ollama `http://127.0.0.1:11434/v1`).
3. Run one trivial task in a scratch worktree, then record `footprint $(pgrep -f 'ollama runner')`, the tokens/s from the Ollama response (`eval_count/eval_duration`) and the wall time.
4. Run `ollama stop gemma4:e4b-mlx`, confirm `/api/ps` is empty, and restore the owner to `claude`.

## 4. Claude Code with a local model

- (a) **opencode as worker is the supported route.** That is the AAM-22 design, and the manager (Claude Code) stays on Anthropic models.
- (b) Pointing Claude Code itself at a local endpoint via `ANTHROPIC_BASE_URL` (with `ANTHROPIC_AUTH_TOKEN` set to a dummy value) is only viable if the endpoint speaks the Anthropic Messages API (`/v1/messages`, including tool use and streaming). I did not verify this here. The Ollama OpenAI-style `/v1` endpoint used by AAM-22 is not enough on its own, and the omlx server on :8000 was not probed. Even if the protocol works, a 4B-class model is a weak fit for the manager role (planning, review, tool use), and it would need the same ~12 GB memory headroom. Recommendation: do not use it as the manager; keep the local model as a worker only. This is unverified evidence, with no secrets involved.

## Update (AAM-41, 2026-10-19): memory gate removed

The 12 GB gate described above no longer exists in code. `local_model_min_free_gb` defaults to 0 (0/unset = no memory refusal) and an unreadable `vm_stat` never blocks dispatch. Only the single-run lock, process-group kill on timeout and unload after idle remain. Available memory before start is recorded as the informational event `local_model_memory`. References to the "12 GB guard" above are historical.
