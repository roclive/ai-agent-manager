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
  sleep: (ms: number) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
const START_WAIT_ATTEMPTS = 60;
const START_WAIT_STEP_MS = 2_000;
const OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";

export function localLlmServer(repo: Repo): LocalLlmServer {
  return repo.getSetting("local_llm_server") === "omlx" ? "omlx" : "ollama";
}

export function localLlmBaseUrl(repo: Repo) {
  return localLlmServer(repo) === "omlx" ? OMLX_BASE_URL : OLLAMA_BASE_URL;
}

// Server-side launch ladder. Profile 2 (8192 context) only changes the client, so the server
// command for it equals profile 1 and the startup retry skips it.
export const SERVER_LEVELS: LocalLlmProfile[] = [0, 1, 3];
const serverLevel = (profile: LocalLlmProfile) =>
  (profile === 2 ? 1 : profile) as LocalLlmProfile;

export function omlxStartCommand(profile: LocalLlmProfile = 0) {
  const script = fileURLToPath(new URL("../../scripts/omlx-start.sh", import.meta.url));
  const level = serverLevel(profile);
  return {
    cmd: script,
    args: ["--max-concurrent", level >= 3 ? "1" : "2"],
    env: {
      OMLX_FORCE: "1",
      ...(level >= 3
        ? { OMLX_SYSTEM_RESERVE_GB: "10" }
        : level >= 1
          ? { OMLX_SYSTEM_RESERVE_GB: "8" }
          : {}),
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

// Only resource failures (timeout, lost worker, OOM/thrash text) escalate; ordinary
// code/test failures do not make the next attempt run with a weaker profile.
const RESOURCE_FAILURE = /out of memory|\boom\b|memory pressure|swap|thrash|killed|jetsam|memory guard/i;

function previousLocalFailures(repo: Repo, taskId: number) {
  return repo
    .runs(taskId)
    .filter(
      (run) =>
        run.provider === FALLBACK_PROVIDER &&
        (["timeout", "lost"].includes(run.status) ||
          (run.status === "failed" && RESOURCE_FAILURE.test(run.summary || ""))),
    ).length;
}

export function localLlmProfile(repo: Repo, taskId: number): LocalLlmProfile {
  return Math.min(previousLocalFailures(repo, taskId), 3) as LocalLlmProfile;
}

const PROFILE_LABEL = [
  "standard",
  "SSD cache + lower memory ceiling",
  "8192 context",
  "batch/concurrency 1",
];

function stopOmlx() {
  const command = omlxStopCommand();
  try {
    localModelHost.run(command.cmd, command.args, process.env);
  } catch {
    /* nothing to stop */
  }
}

function waitHealthy(repo: Repo) {
  for (let i = 0; i < START_WAIT_ATTEMPTS; i++) {
    if (localLlmHealth(repo).ok) return true;
    localModelHost.sleep(START_WAIT_STEP_MS);
  }
  return false;
}

/**
 * Called only from dispatch, after the single-run guard has accepted the task.
 * Returns the effective profile (client context follows it) and records it.
 */
export function startLocalLlm(repo: Repo, taskId: number) {
  if (localLlmServer(repo) !== "omlx") return 0 as LocalLlmProfile;
  const required = localLlmProfile(repo, taskId);
  const level = serverLevel(required);
  const recorded = repo.getSetting("local_llm_active_profile");
  const active = recorded === "" || recorded === undefined ? 0 : Number(recorded);
  const record = (effective: LocalLlmProfile, how: string) => {
    repo.setSetting("local_llm_active_profile", String(effective));
    repo.event(
      "local_llm_start",
      `omlx ${how} at profile ${effective} (${PROFILE_LABEL[effective]}); required ${required}`,
      taskId,
    );
    return effective;
  };
  if (localLlmHealth(repo).ok) {
    // A warm server keeps its launch settings; reuse it only if it is at least as safe.
    if (active >= level) return record(Math.max(required, active) as LocalLlmProfile, "reused");
    repo.event(
      "local_llm_restart",
      `omlx running at profile ${active} but profile ${required} is required; restarting`,
      taskId,
    );
  }
  let failure = "";
  for (const attempt of SERVER_LEVELS.filter((l) => l >= level)) {
    stopOmlx(); // never leave a half-loaded server behind (pid/process group), idempotent
    const command = omlxStartCommand(attempt);
    const result = localModelHost.run(command.cmd, command.args, {
      ...process.env,
      ...command.env,
      OMLX_IDLE_MINUTES: repo.getSetting("local_llm_idle_timeout_min") || "10",
    });
    if (result.status === 0 && waitHealthy(repo))
      return record(Math.max(required, attempt) as LocalLlmProfile, "started");
    failure = result.stderr || result.stdout || "server never became healthy";
    repo.event("local_llm_retry", `omlx profile ${attempt} failed: ${failure}`, taskId);
  }
  stopOmlx();
  repo.setSetting("local_llm_active_profile", "");
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

// omlx serves the model directory name (config/omlx.env OMLX_MODEL_NAME), not the Ollama tag.
export const OMLX_SERVED_MODEL = "gemma4-e4b-mlx";

/** Model id the worker must send to the active local server. */
export function localLlmModel(repo: Repo) {
  const model = fallbackModel(repo);
  if (localLlmServer(repo) !== "omlx" || !isLocalModel(model)) return model;
  return `${model.startsWith("ollama/") ? "ollama/" : ""}${OMLX_SERVED_MODEL}`;
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
  // Stop both backends: the setting may have been switched while a model was still loaded.
  if (localRunActive(repo)) return;
  stopLocalModel(LOCAL_MODEL, "ollama");
  if (localLlmServer(repo) === "omlx" || repo.getSetting("local_llm_active_profile")) {
    stopLocalModel(LOCAL_MODEL, "omlx");
    repo.setSetting("local_llm_active_profile", "");
  }
}

export function stopLocalModelAfterTask(repo: Repo) {
  if (repo.getSetting("keep_warm") !== "1") stopLocalModelIfIdle(repo);
}
