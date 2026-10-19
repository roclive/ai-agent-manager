import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Repo } from "../db/index.js";
import { runner } from "./process.js";
import type { ProviderSelection } from "./providers.js";

// gemma4:e4b-mlx keeps ~9.4 GB resident. Everything that may load it goes through this module so
// that at most one run exists, memory is recorded first, and the model is unloaded afterwards.
export const LOCAL_MODEL = "gemma4:e4b-mlx";
export const FALLBACK_PROVIDER = "opencode-fallback";
const WAIT_EVENT = "local_model_waiting_memory";
const WAIT_EVENT_INTERVAL_MS = 10 * 60_000;

// Replaceable so tests never run the real vm_stat / ollama.
export const localModelHost = {
  vmStat: (): string => runner("vm_stat", [], ".", undefined, 10_000).stdout,
  ollamaStop: (model: string) => {
    runner("ollama", ["stop", model], ".", undefined, 30_000);
  },
};

export function isLocalModel(model: string) {
  return model.replace(/^ollama\//, "") === LOCAL_MODEL;
}

export function fallbackActive(repo: Repo) {
  if (repo.getSetting("fallback_worker") !== "opencode") return false;
  if (repo.getSetting("fallback_active") === "1") return true;
  try {
    return (
      readFileSync(resolve(repo.home, "manager-owner"), "utf8").trim() ===
      "opencode-fallback"
    );
  } catch {
    return false;
  }
}

export function fallbackModel(repo: Repo) {
  return repo.getSetting("opencode_fallback_model")!;
}

export function fallbackSelection(repo: Repo): ProviderSelection {
  return {
    id: FALLBACK_PROVIDER,
    worker: "opencode",
    class: "local",
    legal: true,
    roles: ["any"],
    max_complexity: "high",
    reserve_remaining: 0,
    reservation: { low: 0, medium: 0, high: 0 },
    amount: 0,
    reason: `fallback_worker=opencode active; model ${fallbackModel(repo)}`,
  };
}

// free + inactive + speculative pages, in GB. NaN when vm_stat output is unusable.
export function availableGb(vmStat: string) {
  const size = Number(/page size of (\d+) bytes/.exec(vmStat)?.[1]);
  const pages = (name: string) =>
    Number(new RegExp(`^Pages ${name}:\\s+(\\d+)\\.`, "m").exec(vmStat)?.[1]);
  const total = pages("free") + pages("inactive") + pages("speculative");
  return (total * size) / 1024 ** 3;
}

export function localRunActive(repo: Repo) {
  return repo
    .runs()
    .some((r) => r.status === "running" && r.provider === FALLBACK_PROVIDER);
}

function waitEvent(repo: Repo, taskId: number, message: string) {
  const last = repo.db
    .prepare(
      "SELECT ts FROM events WHERE kind=? AND task_id=? ORDER BY id DESC LIMIT 1",
    )
    .get(WAIT_EVENT, taskId) as { ts: string } | undefined;
  if (!last || Date.now() - Date.parse(last.ts) >= WAIT_EVENT_INTERVAL_MS)
    repo.event(WAIT_EVENT, message, taskId);
}

// Returns why the local model cannot start now, or null. Never starts the model.
// Only the single-run lock refuses; memory is informational (local_model_memory event).
export function localModelWait(repo: Repo, taskId: number) {
  if (localRunActive(repo)) {
    const message = "another local-model run is active";
    waitEvent(repo, taskId, message);
    return message;
  }
  return null;
}

// Informational only: records available memory before a start; never blocks, never throws.
export function recordLocalModelMemory(repo: Repo, taskId: number) {
  let free = NaN;
  try {
    free = availableGb(localModelHost.vmStat());
  } catch {
    /* unknown */
  }
  repo.event(
    "local_model_memory",
    Number.isFinite(free)
      ? `available memory ${free.toFixed(1)} GB before local model start`
      : "available memory unknown (vm_stat unusable)",
    taskId,
  );
}

export function stopLocalModel(model = LOCAL_MODEL) {
  try {
    localModelHost.ollamaStop(model.replace(/^ollama\//, ""));
  } catch {
    /* ollama not running: nothing to unload */
  }
}

// Unload the model unless a local run still needs it (daemon startup, after reaping).
export function stopLocalModelIfIdle(repo: Repo) {
  if (!localRunActive(repo)) stopLocalModel();
}
