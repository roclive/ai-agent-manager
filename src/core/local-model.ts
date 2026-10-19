import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  run: (cmd: string, args: string[], env: NodeJS.ProcessEnv) => {
    const result = spawnSync(cmd, args, {
      cwd: dirname(fileURLToPath(import.meta.url)),
      env,
      encoding: "utf8",
      timeout: 30_000,
    });
    return {
      status: result.status,
      stdout: result.stdout || "",
      stderr: (result.stderr || "") + (result.error?.message || ""),
    };
  },
  probe: (url: string) => {
    const result = runner(
      "curl",
      ["--fail", "--silent", "--show-error", "--max-time", "2", url],
      ".",
      undefined,
      5_000,
    );
    return { ok: result.status === 0, detail: result.stdout || result.stderr };
  },
};

export type LocalLlmServer = "ollama" | "omlx";
export type LocalLlmProfile = 0 | 1 | 2 | 3;
const OMLX_BASE_URL = "http://127.0.0.1:8000/v1";
const OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";

export function localLlmServer(repo: Repo): LocalLlmServer {
  return repo.getSetting("local_llm_server") === "omlx" ? "omlx" : "ollama";
}

export function localLlmBaseUrl(repo: Repo) {
  return localLlmServer(repo) === "omlx" ? OMLX_BASE_URL : OLLAMA_BASE_URL;
}

export function omlxStartCommand(profile: LocalLlmProfile = 0) {
  const script = fileURLToPath(new URL("../../scripts/omlx-start.sh", import.meta.url));
  return {
    cmd: script,
    args: ["--max-concurrent", profile >= 3 ? "1" : "2"],
    env: {
      OMLX_FORCE: "1",
      ...(profile >= 1 ? { OMLX_SYSTEM_RESERVE_GB: "8" } : {}),
    },
  };
}

export function omlxStopCommand() {
  return {
    cmd: fileURLToPath(new URL("../../scripts/omlx-stop.sh", import.meta.url)),
    args: [] as string[],
  };
}

/** Probe-only: this function never starts or loads a model. */
export function localLlmHealth(repo: Repo) {
  return localModelHost.probe(`${localLlmBaseUrl(repo)}/models`);
}

function previousLocalFailures(repo: Repo, taskId: number) {
  return repo
    .runs(taskId)
    .filter(
      (run) =>
        run.provider === FALLBACK_PROVIDER &&
        ["failed", "timeout", "lost"].includes(run.status),
    ).length;
}

export function localLlmProfile(repo: Repo, taskId: number): LocalLlmProfile {
  return Math.min(previousLocalFailures(repo, taskId), 3) as LocalLlmProfile;
}

/** Called only from dispatch, after the single-run guard has accepted the task. */
export function startLocalLlm(repo: Repo, taskId: number) {
  if (localLlmServer(repo) !== "omlx") return 0 as LocalLlmProfile;
  let profile = localLlmProfile(repo, taskId);
  if (localLlmHealth(repo).ok) return profile;
  let failure = "";
  for (; profile <= 3; profile = (profile + 1) as LocalLlmProfile) {
    const command = omlxStartCommand(profile);
    const result = localModelHost.run(command.cmd, command.args, {
      ...process.env,
      ...command.env,
      OMLX_IDLE_MINUTES: repo.getSetting("local_llm_idle_timeout_min") || "10",
    });
    if (result.status === 0 || /already running/i.test(result.stderr)) {
      repo.event(
        "local_llm_start",
        `omlx profile ${profile}: ${profile === 0 ? "standard" : profile === 1 ? "SSD cache + lower memory ceiling" : profile === 2 ? "8192 context" : "batch/concurrency 1"}`,
        taskId,
      );
      return profile;
    }
    failure = result.stderr || result.stdout;
    repo.event("local_llm_retry", `omlx profile ${profile} failed: ${failure}`, taskId);
  }
  throw new Error(`omlx start failed at every profile: ${failure}`);
}

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

export function stopLocalModel(model = LOCAL_MODEL, server: LocalLlmServer = "ollama") {
  try {
    if (server === "omlx") {
      const command = omlxStopCommand();
      localModelHost.run(command.cmd, command.args, process.env);
    } else localModelHost.ollamaStop(model.replace(/^ollama\//, ""));
  } catch {
    /* ollama not running: nothing to unload */
  }
}

// Unload the model unless a local run still needs it (daemon startup, after reaping).
export function stopLocalModelIfIdle(repo: Repo) {
  if (!localRunActive(repo)) stopLocalModel(LOCAL_MODEL, localLlmServer(repo));
}

export function stopLocalModelAfterTask(repo: Repo) {
  if (repo.getSetting("keep_warm") !== "1") stopLocalModelIfIdle(repo);
}
