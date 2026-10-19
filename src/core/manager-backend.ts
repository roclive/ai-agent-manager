import type { Repo, Task } from "../db/index.js";
import { resolveExecutor, selectExecutor } from "./executors.js";
import { fallbackActive, fallbackSelection } from "./local-model.js";
import { selectProvider, type ProviderSelection } from "./providers.js";

export const MANAGER_BACKENDS = [
  "rules",
  "claude",
  "codex",
  "local-small",
] as const;
export type ManagerBackendName = (typeof MANAGER_BACKENDS)[number];

export interface ManagerContext {
  repo: Repo;
}

export interface ManagerDecision {
  task: Task;
  worker: ProviderSelection;
  reason: string;
}

export interface ManagerBackend {
  readonly name: ManagerBackendName;
  decide(candidates: readonly Task[], context: ManagerContext): ManagerDecision;
}

/** The pre-abstraction scheduler and routing policy, kept as one deterministic backend. */
export class RulesBackend implements ManagerBackend {
  readonly name: ManagerBackendName = "rules";

  decide(candidates: readonly Task[], { repo }: ManagerContext): ManagerDecision {
    const task = candidates[0];
    if (!task) throw new Error("No manager candidates");
    const effective = resolveExecutor(repo, task);
    const worker =
      effective.value !== "auto"
        ? selectExecutor(repo, effective)
        : fallbackActive(repo)
          ? fallbackSelection(repo)
          : selectProvider(repo, task);
    return {
      task,
      worker,
      reason: `rules: first eligible candidate; ${worker.reason ?? "configured worker"}`,
    };
  }
}

/**
 * The named decision slots deliberately preserve rules behavior until their
 * model adapters are configured. This makes backend selection safe and offline
 * while leaving dispatch independent of a particular decision implementation.
 */
class RulesCompatibleBackend extends RulesBackend {
  constructor(override readonly name: ManagerBackendName) {
    super();
  }
}

export function managerBackend(repo: Repo): ManagerBackend {
  const name = repo.getSetting("manager_backend") as ManagerBackendName;
  if (!MANAGER_BACKENDS.includes(name))
    throw new Error(`Invalid manager backend: ${name}`);
  return name === "rules" ? new RulesBackend() : new RulesCompatibleBackend(name);
}
