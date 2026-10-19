import type { Repo } from "../db/index.js";
import { normalizeReviewer } from "./reviewer-names.js";

export const reviewerHealthSetting = (repo: Repo, key: string) =>
  repo.getSetting(`reviewer_${key}`) ||
  (normalizeReviewer(repo.getSetting("reviewer")).startsWith("claude") &&
  !(
    repo.getSetting("ollama_fallback_enabled") === "1" &&
    repo.getSetting("llm_backend") === "ollama"
  )
    ? repo.getSetting(`claude_${key}`)
    : "") ||
  "";
