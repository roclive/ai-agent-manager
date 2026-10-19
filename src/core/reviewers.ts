import type { Repo } from "../db/index.js";
import { executorInstalled } from "./executors.js";
import { normalizeReviewer, REVIEWERS, type Reviewer } from "./reviewer-names.js";

const META: Record<Reviewer, { label: string; provider: string; model?: string }> = {
  "codex-sol": { label: "Codex (Sol)", provider: "codex", model: "gpt-5.6-sol" },
  "codex-luna": { label: "Codex (Luna)", provider: "codex", model: "gpt-5.6-luna" },
  claude: { label: "Claude (Sonnet)", provider: "claude", model: "sonnet" },
  "claude-opus": { label: "Claude (Opus)", provider: "claude", model: "opus" },
  gw: { label: "Gateway reviewer", provider: "gw" },
};

export function reviewerMeta(value: string) {
  return META[normalizeReviewer(value) as Reviewer];
}

export function reviewersView(repo: Repo) {
  const health = (key: string) => repo.getSetting(`reviewer_${key}`) || "";
  const ok = health("ok");
  return {
    reviewer: normalizeReviewer(repo.getSetting("reviewer") || "codex-sol"),
    reviewer_ok: ok === "" ? null : ok === "1",
    reviewer_checked_at: health("checked_at") || null,
    reviewer_error: health("error"),
    reviewers: REVIEWERS.map((id) => ({
      id,
      ...META[id],
      supported: id === "gw" ? Boolean(repo.getSetting("gw_model")) : executorInstalled(id),
    })),
  };
}

export { normalizeReviewer } from "./reviewer-names.js";
