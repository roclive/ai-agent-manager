Make agent tasks hit the local inference cache as much as possible to raise gemma4 e4b throughput (user request 2026-10-19; after AAM-24).

Goal: successive aam worker runs of the same project/series should reuse the KV/prefix cache (omlx SSD cache) instead of re-prefilling thousands of tokens.
1. Prompt layout: put the stable content first (system/role rules, MANAGER/CLAUDE-style conventions, project README excerpt, tool list), task-specific text last; no timestamps/run ids/random ordering inside the stable prefix; deterministic ordering of file lists. Make the aam prompt builder produce a byte-identical prefix for tasks of the same project.
2. Reuse: keep the same model/server instance between consecutive tasks of one series (do not `ollama stop`/unload between back-to-back local runs; unload only after idle timeout), but keep the memory guard. Reuse opencode session/system prompt where possible.
3. Measure: add a metric (events or a small table) with prompt tokens, cached tokens, prefill/decode tokens/s per local run, from the server's response/usage or logs; show cache-hit rate in the UI task/run detail if cheap.
4. Benchmark: 3 consecutive small tasks, cold vs warm cache, in `docs/local-llm-cache-bench.md` (throughput, cache-hit %, memory). Report honestly if gains are small.
5. Tests with fake server responses; prompt-prefix stability test (two tasks same project -> identical prefix bytes).
