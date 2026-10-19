// Pure helpers for the low-quota opencode + local Ollama fallback. Kept apart from the launcher
// (which runs on import) so command construction can be tested with fake runners.
export const FALLBACK_BASE_URL = "http://127.0.0.1:11434/v1";
export const FALLBACK_CONTEXT = 32768;

// `ollama/<name>` routes through the OpenAI-compatible Ollama endpoint; any other
// provider/model value is passed to opencode untouched and uses its own configuration.
export function fallbackProvider(id, model, baseUrl = FALLBACK_BASE_URL, contextWindow = FALLBACK_CONTEXT) {
  const local = model.startsWith("ollama/");
  return {
    id,
    kind: local ? "ollama" : "opencode",
    model,
    codingWorker: true,
    tools: true,
    json: true,
    health: { status: "unknown", detail: "not checked" },
    freeQuota: "unknown",
    contextWindow,
    ...(local ? { baseUrl } : {}),
  };
}

// opencode run --format json --dir <worktree> -m <model> "<prompt>"
export function fallbackRunArgs(worktree, model, prompt) {
  return ["run", "--format", "json", "--dir", worktree, "-m", model, prompt];
}
