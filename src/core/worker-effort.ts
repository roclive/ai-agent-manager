import type { Repo } from "../db/index.js";

export const WORKER_EFFORTS = ["default", "low", "medium", "high", "xhigh", "max"] as const;
export type WorkerEffort = (typeof WORKER_EFFORTS)[number];

export function parseWorkerEffort(value: unknown): WorkerEffort {
  if (typeof value !== "string" || !WORKER_EFFORTS.includes(value as WorkerEffort))
    throw new Error(`Invalid worker effort: ${String(value)}`);
  return value as WorkerEffort;
}

export function workerEffort(repo: Repo): WorkerEffort {
  return parseWorkerEffort(repo.getSetting("worker_effort") || "default");
}

export function effortSupported(worker: string) {
  return worker === "codex" || worker === "claude";
}
