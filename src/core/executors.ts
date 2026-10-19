import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";
import type { Repo, Task } from "../db/index.js";
import { EXECUTORS, parseFallback, type Executor } from "./executor-names.js";
import { FALLBACK_PROVIDER, fallbackModel } from "./local-model.js";
import { parseOverrides } from "./routing-overrides.js";
import { providerCooldown, type ProviderSelection } from "./providers.js";
import { checkQuota } from "./usage.js";

export { EXECUTORS, EXECUTOR_VALUES, parseFallback } from "./executor-names.js";
export type { Executor } from "./executor-names.js";

export type ExecutorSource = "task" | "project" | "global";
export interface EffectiveExecutor {
  value: "auto" | Executor;
  source: ExecutorSource;
}

interface Meta {
  label: string;
  bin: string;
  worker: ProviderSelection["worker"];
  hint: string;
}
// Install hints are shown in the UI; aam never installs anything itself.
export const EXECUTOR_META: Record<Executor, Meta> = {
  codex: { label: "Codex", bin: "codex", worker: "codex", hint: "npm i -g @openai/codex" },
  claude: { label: "Claude (sonnet)", bin: "claude", worker: "claude", hint: "npm i -g @anthropic-ai/claude-code" },
  opencode: { label: "opencode", bin: "opencode", worker: "opencode", hint: "brew install sst/tap/opencode" },
  "opencode-local": { label: "opencode (local gemma4)", bin: "opencode", worker: "opencode", hint: "brew install sst/tap/opencode; start omlx/Ollama (docs/omlx-server.md)" },
  pi: { label: "pi", bin: "pi", worker: "pi", hint: "npm i -g @mariozechner/pi-coding-agent" },
  hermes: { label: "Hermes Agent (Nous)", bin: "hermes", worker: "hermes", hint: "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash" },
};

// Replaceable in tests so they never depend on what is installed on the machine.
export const executorHost = {
  which(bin: string): boolean {
    const dirs = [
      ...(process.env.PATH || "").split(delimiter),
      "/opt/homebrew/bin",
      join(homedir(), ".local/bin"),
    ];
    return dirs.some((d) => d && existsSync(join(d, bin)));
  },
};

export function executorInstalled(id: Executor) {
  // A fake worker replaces every real binary.
  return Boolean(process.env.AAM_FAKE_WORKER) || executorHost.which(EXECUTOR_META[id].bin);
}

// The cooldown/quota/provider id an executor is accounted to.
export function executorProvider(id: Executor) {
  return id === "opencode-local" ? FALLBACK_PROVIDER : id;
}

// task > project > global > auto. Empty string means "inherit".
export function resolveExecutor(
  repo: Repo,
  task: Pick<Task, "executor" | "project_id">,
): EffectiveExecutor {
  if (task.executor)
    return { value: task.executor as EffectiveExecutor["value"], source: "task" };
  const project = repo.project(task.project_id);
  if (project.coding_executor)
    return {
      value: project.coding_executor as EffectiveExecutor["value"],
      source: "project",
    };
  return {
    value: (repo.getSetting("coding_executor") || "auto") as EffectiveExecutor["value"],
    source: "global",
  };
}

function selection(repo: Repo, id: Executor, reason: string): ProviderSelection {
  return {
    id: executorProvider(id),
    worker: EXECUTOR_META[id].worker,
    class: id === "opencode-local" ? "local" : "standard",
    legal: true,
    roles: ["any"],
    max_complexity: "high",
    reserve_remaining: 0,
    reservation: { low: 0, medium: 0, high: 0 },
    amount: 0,
    reason: id === "opencode-local" ? `${reason}; model ${fallbackModel(repo)}` : reason,
  };
}

// Picks the executor for an explicit (non-auto) choice. The chosen executor is never
// replaced by another one unless the user listed it in `executor_fallback`; a rate-limited
// executor makes the task wait (throws "No provider available ..." => deferred).
export function selectExecutor(
  repo: Repo,
  effective: EffectiveExecutor,
): ProviderSelection {
  const chain = [
    effective.value as Executor,
    ...parseFallback(repo.getSetting("executor_fallback")),
  ].filter((id, i, all) => all.indexOf(id) === i);
  const overrides = parseOverrides(repo.getSetting("routing_overrides"));
  const failures: string[] = [];
  for (const id of chain) {
    const provider = executorProvider(id);
    if (!executorInstalled(id)) failures.push(`${id}: not installed`);
    else if (overrides.paused.includes(provider)) failures.push(`${id}: paused by operator`);
    else if (providerCooldown(repo, provider)) failures.push(`${id}: cooldown`);
    else {
      const quota =
        id === "opencode-local" ? { ok: true } : checkQuota(repo, provider);
      if (!quota.ok) failures.push(`${id}: ${quota.warning || "quota unavailable"}`);
      else
        return selection(
          repo,
          id,
          id === effective.value
            ? `executor ${id} (${effective.source})`
            : `executor_fallback ${id} (primary ${effective.value} unavailable: ${failures.join("; ")})`,
        );
    }
  }
  throw new Error(`No provider available (${failures.join("; ")})`);
}

export function executorsView(repo: Repo) {
  return {
    coding_executor: repo.getSetting("coding_executor") || "auto",
    executor_fallback: parseFallback(repo.getSetting("executor_fallback")),
    reviewer: repo.getSetting("reviewer"),
    executors: EXECUTORS.map((id) => ({
      id,
      label: EXECUTOR_META[id].label,
      installed: executorInstalled(id),
      install_hint: EXECUTOR_META[id].hint,
      cooldown_until: providerCooldown(repo, executorProvider(id)),
    })),
  };
}
