import { codexModelWarnings } from "./model-warnings.js";
import { DEFAULT_SOL_MODEL } from "./model-defaults.js";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";
import type { Repo, Task } from "../db/index.js";
import { EXECUTORS, normalizeExecutor, parseFallback, type Executor } from "./executor-names.js";
import { FALLBACK_PROVIDER, fallbackModel } from "./local-model.js";
import { parseOverrides } from "./routing-overrides.js";
import { providerCooldown, type ProviderSelection } from "./providers.js";
import { checkQuota } from "./usage.js";
import { WORKER_EFFORTS, workerEffort } from "./worker-effort.js";

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
  // Quota/cooldown account when it differs from the executor id (variants share their CLI's account).
  provider?: string;
  // Model passed to the CLI for this variant.
  model?: string;
}
// Install hints are shown in the UI; aam never installs anything itself.
export const EXECUTOR_META: Record<Executor, Meta> = {
  "codex-sol": { label: "Codex (Sol)", bin: "codex", worker: "codex", hint: "npm i -g @openai/codex", provider: "codex", model: DEFAULT_SOL_MODEL },
  "codex-luna": { label: "Codex (Luna)", bin: "codex", worker: "codex", hint: "npm i -g @openai/codex", provider: "codex", model: "gpt-6-luna" },
  claude: { label: "Claude (Sonnet)", bin: "claude", worker: "claude", hint: "npm i -g @anthropic-ai/claude-code", model: "sonnet" },
  "claude-opus": { label: "Claude (Opus)", bin: "claude", worker: "claude", hint: "npm i -g @anthropic-ai/claude-code", provider: "claude", model: "opus" },
  opencode: { label: "opencode", bin: "opencode", worker: "opencode", hint: "brew install sst/tap/opencode" },
  "opencode-local": { label: "opencode (local LFM2.5 2.6B MLX 4-bit)", bin: "opencode", worker: "opencode", hint: "brew install sst/tap/opencode; start omlx (docs/omlx-server.md)" },
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
  return id === "opencode-local" ? FALLBACK_PROVIDER : EXECUTOR_META[id].provider ?? id;
}

// task > project > global > auto. Empty string means "inherit".
export function resolveExecutor(
  repo: Repo,
  task: Pick<Task, "executor" | "project_id">,
): EffectiveExecutor {
  if (task.executor)
    return { value: normalizeExecutor(task.executor) as EffectiveExecutor["value"], source: "task" };
  const project = repo.project(task.project_id);
  if (project.coding_executor)
    return {
      value: normalizeExecutor(project.coding_executor) as EffectiveExecutor["value"],
      source: "project",
    };
  return {
    value: normalizeExecutor(repo.getSetting("coding_executor") || "auto") as EffectiveExecutor["value"],
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
    ...(EXECUTOR_META[id].model && id !== "opencode-local"
      ? { model: EXECUTOR_META[id].model }
      : {}),
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
  const warnings = codexModelWarnings({ "codex-sol": EXECUTOR_META["codex-sol"].model!, "codex-luna": EXECUTOR_META["codex-luna"].model! });
  return {
    coding_executor: normalizeExecutor(repo.getSetting("coding_executor") || "auto"),
    model_note:
      "AAM's persisted executor selection (task > project > global) sets the CLI model; the Codex desktop app's model picker is not consulted.",
    worker_effort: workerEffort(repo),
    effort_choices: WORKER_EFFORTS,
    executor_fallback: parseFallback(repo.getSetting("executor_fallback")),
    reviewer: repo.getSetting("reviewer"),
    executors: EXECUTORS.map((id) => ({
      id,
      label: EXECUTOR_META[id].label,
      model_warning: warnings[id] ?? null,
      model: EXECUTOR_META[id].model ?? null,
      provider: executorProvider(id),
      installed: executorInstalled(id),
      install_hint: EXECUTOR_META[id].hint,
      cooldown_until: providerCooldown(repo, executorProvider(id)),
      effort_supported: ["codex", "claude"].includes(EXECUTOR_META[id].worker),
    })),
  };
}
