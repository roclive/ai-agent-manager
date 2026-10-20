Upgrade/repair omlx and run it as the local LLM inference server with an SSD-backed KV cache, used with opencode as a coding worker to cut Claude usage and memory (user request 2026-10-19; run AFTER AAM-23).

Facts found: `/opt/homebrew/bin/omlx` is broken (`bad interpreter: /opt/homebrew/Cellar/omlx/0.2.13/libexec/bin/python3.11: no such file`); a process `omlx serve` (python@3.11) has run ~9 days; brew refuses the tap: `Refusing to load formula jundot/omlx/omlx from untrusted tap` (needs `brew trust jundot/omlx` — that is a security setting: do NOT run it yourself; record it as the one step the user must approve, then continue with everything else you can: e.g. `brew info`, read the tap's README/release notes via web, check `~/.omlx/{settings.json,model_settings.json,models,cache,logs}`). User data in ~/.omlx must be backed up (copy settings) before changes.

Do:
1. Determine installed vs latest omlx version and what the new version offers (SSD cache / paged KV cache, continuous batching, OpenAI-compatible API, model aliases). Evidence from README/changelog, not guesses.
2. After the user approves trust (or if already possible), upgrade/reinstall; verify `omlx --help` works; stop the stale `omlx serve` gracefully first.
3. Configure: model gemma4 e4b MLX (reuse the weights already on disk if the Ollama/omlx model dir has them; no re-download > 4 GB without need), SSD cache dir on the internal SSD with a size cap (e.g. 20 GB, setting documented), bind 127.0.0.1 only, memory limit so it can't starve the Mac (>= 6 GB left for the system), idle unload.
4. Wire opencode to it via the AAM-22 provider mechanism (OpenAI-compatible baseURL of omlx) and make aam setting `local_llm_server` = `ollama` | `omlx`; keep the 12 GB guard, single-run lock and no auto-start rules from AAM-22.
5. Tests with fakes (command construction, health probe, cache dir config); one real smoke only if memory allows; record tokens/s with cold vs warm cache. Docs: `docs/omlx-server.md`.
