import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Repo } from "../db/index.js";

export function llmBackend(repo: Repo): "primary" | "ollama" {
  return repo.getSetting("ollama_fallback_enabled") === "1" &&
    repo.getSetting("llm_backend") === "ollama"
    ? "ollama"
    : "primary";
}

export function llmArgs(
  repo: Repo,
  backend: "primary" | "ollama" = llmBackend(repo),
): string[] {
  return backend === "ollama"
    ? [
        "-m",
        repo.getSetting("ollama_model")!,
        "-c",
        'model_provider="aam-fallback"',
        "-c",
        'model_providers.aam-fallback.name="AAM fallback"',
        "-c",
        `model_providers.aam-fallback.base_url=${JSON.stringify(repo.getSetting("ollama_base_url"))}`,
        "-c",
        "model_providers.aam-fallback.requires_openai_auth=false",
        "-c",
        'model_reasoning_effort="high"',
      ]
    : [];
}

export function providerLlmArgs(repo: Repo, provider: string): string[] {
  return provider === "ollama" ? llmArgs(repo, "ollama") : [];
}

export function recordBackend(repo: Repo, dir: string, provider?: string) {
  const backend = provider === "ollama" ? "ollama" : llmBackend(repo);
  writeFileSync(
    resolve(dir, "backend.json"),
    JSON.stringify({
      backend,
      provider: provider || (backend === "ollama" ? "ollama" : "codex"),
      model:
        backend === "ollama"
          ? repo.getSetting("ollama_model")
          : "configured default",
    }),
  );
}

export function readBackend(dir: string): string {
  try {
    return JSON.parse(readFileSync(resolve(dir, "backend.json"), "utf8"))
      .backend;
  } catch {
    return "primary";
  } // Runs launched before backend tracking.
}

// In-flight primary runs may report quota errors after another run switched.
// They must not cool down the healthy fallback or consume task attempts.
export function quotaFallback(repo: Repo, backend: string, reason: string) {
  if (
    repo.getSetting("ollama_fallback_enabled") !== "1" ||
    backend === "ollama"
  )
    return false;
  if (llmBackend(repo) !== "ollama") {
    repo.setSetting("llm_backend", "ollama");
    repo.setSetting("reviewer_ok", "");
    repo.setSetting("reviewer_checked_at", "");
    repo.setSetting("reviewer_error", "");
    repo.event(
      "llm_fallback",
      `${reason}; switched workers/reviews/planning to Ollama ${repo.getSetting("ollama_model")}`,
    );
  }
  return true;
}
