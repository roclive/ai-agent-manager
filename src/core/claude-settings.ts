import type { Repo } from "../db/index.js";
import { reviewerHealthSetting } from "./reviewer-settings.js";

export function claudeSettings(options: {
  model?: string;
  effort?: string;
  fast?: boolean;
}) {
  const effort = process.env.AAM_CLAUDE_EFFORT || options.effort || "max";
  return {
    model: process.env.AAM_CLAUDE_MODEL || options.model || "opus",
    effort: effort === "default" ? "max" : effort,
    fast: process.env.AAM_CLAUDE_FAST
      ? process.env.AAM_CLAUDE_FAST !== "false" &&
        process.env.AAM_CLAUDE_FAST !== "0"
      : (options.fast ?? true),
  };
}

export function reviewerClaudeSettings(repo: Repo) {
  return claudeSettings({
    model: repo.getSetting("reviewer_model"),
    effort: repo.getSetting("reviewer_effort"),
    fast: reviewerHealthSetting(repo, "fast_mode") !== "0",
  });
}
