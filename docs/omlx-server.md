# omlx server install (AAM-27)

Date: 2026-10-19 (JST). Purpose: repair the broken omlx install so it can later serve
`gemma4 e4b-mlx` to opencode (see the fallback ladder below). **The server was not started and no model was loaded.**

## Repair record

| item | value |
|---|---|
| Previous version | 0.2.13 (`/opt/homebrew/bin/omlx` -> `Cellar/omlx/0.2.13/bin/omlx`, its `libexec` python3.11 was missing, so the binary was dead) |
| Installed now | **0.7.1rc1** (tap `jundot/omlx`, formula `omlx`, python@3.11, 38,824 files / 1.7 GB). This is a release candidate. 0.7.0 is the latest stable upstream release |
| Verification | `omlx --help` lists `start, stop, restart, serve, launch, diagnose, cluster`; `omlx --version` prints `0.7.1rc1` |
| Config backup | `~/.omlx/backup-20261019/{settings.json,model_settings.json,stats.json}` (outside git; `settings.json` may hold an API key, never commit). Live files were byte-identical to the backups after the upgrade |
| Launchd cleanup | `brew services stop omlx` removed `~/Library/LaunchAgents/homebrew.mxcl.omlx.plist` (it was in error state 78). `brew services list` shows `omlx none`, `launchctl list` has no omlx job, and no omlx process exists. No `KeepAlive` respawn remains. Do not run `brew services start omlx` |
| Old Cellar | 0.2.13 was removed by brew cleanup |

Steps: backup, `brew services stop omlx`, `brew upgrade jundot/omlx/omlx` (about 5 min build), verify.

## Release notes relevant to us (0.2.13 -> 0.7.1rc1)

Source: GitHub releases of jundot/omlx (v0.7.0, v0.7.1rc1). The jump spans many versions; only the points we care about are listed.

- **SSD cache:** a paged SSD prefix cache plus an optional in-memory hot cache. CLI flags: `--paged-ssd-cache-dir`, `--paged-ssd-cache-max-size`, `--hot-cache-max-size`, `--hot-cache-write-through`, `--initial-cache-blocks`, `--no-cache`. 0.7.0 fixed SSD cache growth on hybrid models; 0.7.1rc1 fixed prefix-block dedup and made prompts shorter than one block hit the cache. Cancelled prompts stay cached.
- **KV cache / memory:** 0.7.0 rebuilt the memory guard (`--memory-guard {off,safe,balanced,aggressive}`, `--memory-guard-gb`). 0.7.1rc1: running requests are paused and resumed under memory pressure instead of aborted. `--max-concurrent-requests` (default 8) controls batching, which is the lever for the "batch=1" fallback. Models are LRU-managed, so unload-after-idle is a server concern.
- **OpenAI API:** OpenAI-compatible server (`omlx serve`, `/v1/...`). Newer: `/v1/decisions`, OpenAI content parts in `/v1/embeddings`, usage stats on non-streaming responses. Gemma 4 audio/vision handling was fixed in 0.7.0.
- Other: `omlx launch <tool>` integrates external tools, `omlx diagnose` checks the install, DFlash now runs inside the batched engines.

## Use with AAM (policy, unchanged by this task)

- Never start omlx or load the model from health checks or the planner. Only a worker run starts it, under the single-run lock; process-group kill on timeout; unload after idle.
- Memory gate is removed (`local_model_min_free_gb=0`). Workers force-run gemma4 e4b-mlx. On OOM, timeout or swap storm, retry in order and record the level that worked: (1) SSD offload of the KV/paged cache with a lower per-model memory limit (`--paged-ssd-cache-dir`, `--memory-guard`/`--memory-guard-gb`), (2) smaller context (e.g. 8192), (3) concurrency/batch=1 (`--max-concurrent-requests 1`).
- Never signal the aam daemon/UI, OntoKB api, Paperclip, or the Claude/Codex/ChatGPT apps.
- Real smoke test belongs to AAM-31; tests use fakes.
