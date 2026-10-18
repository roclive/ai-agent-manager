import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Repo, type Task } from "../db/index.js";
import { git } from "./process.js";
import { ensureWorktree } from "./worktree.js";
import { prompt, spawnWorker } from "../workers/index.js";
import { checkQuota, QuotaUnavailableError } from "./usage.js";
import {
  reserveProvider,
  releaseProvider,
  selectProvider,
} from "./providers.js";
import { providerPolicyConfigured } from "./provider-policy.js";

import { providerLlmArgs, recordBackend } from "./llm.js";
export function dependenciesDone(repo: Repo, t: Task) {
  return (JSON.parse(t.depends_on) as string[]).every((id) => {
    try {
      const dep = repo.task(id);
      return (
        dep.status === "done" &&
        (!repo.project(dep.project_id).integration_branch ||
          dep.integrated === 1)
      );
    } catch {
      return false;
    }
  });
}
// A resolution must observe a stable project tip until it has been reviewed.
// Other projects can continue using the remaining worker slots.
export function resolutionBusy(repo: Repo, t: Task) {
  return repo
    .tasks()
    .some(
      (other) =>
        other.id !== t.id &&
        other.project_id === t.project_id &&
        ["in_progress", "in_review"].includes(other.status) &&
        Boolean(t.resolves_task_id || other.resolves_task_id),
    );
}
export function dispatch(repo: Repo, id: string, force = false) {
  const t = repo.task(id);
  if (repo.runs(t.id).some((r) => r.status === "running"))
    throw new Error("Task already running");
  if (!["ready", "backlog"].includes(t.status))
    throw new Error("Task must be ready or backlog");
  if (!force && !dependenciesDone(repo, t))
    throw new Error("Dependencies not done");
  if (resolutionBusy(repo, t))
    throw new Error(
      "Project has active work or review; serialize integration resolutions",
    );
  if (
    !providerPolicyConfigured(repo.getSetting("provider_policy")) &&
    Date.parse(repo.getSetting("cooldown_until") || "") > Date.now()
  )
    throw new Error("Workers are in cooldown");

  let selected;
  try {
    selected = selectProvider(repo, t);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    repo.event("quota_deferred", message, t.id);
    throw new QuotaUnavailableError(message);
  }
  const quota = checkQuota(repo, selected.id);
  if (!quota.ok) {
    const message = quota.warning || `Quota exhausted for ${selected.id}`;
    repo.event("quota_deferred", message, t.id);
    throw new QuotaUnavailableError(message);
  }
  if (quota.warning) {
    repo.event("quota_warning", quota.warning, t.id);
  }

  let worktree: string;
  try {
    worktree = ensureWorktree(repo, t);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    repo.updateTask(t.id, { status: "blocked", blocker: message });
    repo.event("dispatch_error", message, t.id);
    throw e;
  }
  const startSha = git(worktree, ["rev-parse", "HEAD"]);
  const started = new Date().toISOString();
  const reserve = repo.db.transaction(() => {
    // Selection and reservation share the same immediate write transaction, so
    // concurrent dispatchers cannot both spend the last available capacity.
    const current = selectProvider(repo, t);
    const result = repo.db
      .prepare(
        "INSERT INTO runs(task_id,worker,provider,status,started_at,start_sha,log_path,last_message_path) VALUES (?,?,?,'running',?,?,'','')",
      )
      .run(t.id, current.worker, current.id, started, startSha);
    const runId = Number(result.lastInsertRowid);
    reserveProvider(repo, runId, current);
    selected = current;
    return runId;
  });
  let idRun: number;
  try {
    idRun = reserve.immediate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("No provider available")) {
      repo.event("quota_deferred", message, t.id);
      throw new QuotaUnavailableError(message);
    }
    throw error;
  }
  const worker = selected.worker;
  const runDir = resolve(repo.home, "runs", String(idRun));
  try {
    mkdirSync(runDir, { recursive: true });
    recordBackend(repo, runDir, selected.id);
    const promptFile = resolve(runDir, "prompt.md");
    writeFileSync(
      promptFile,
      prompt(
        repo.project(t.project_id),
        t,
        t.resolves_task_id ? repo.task(t.resolves_task_id) : undefined,
      ),
    );
    const pid = spawnWorker(worker, {
      worktree,
      promptFile,
      runDir,
      sandbox: repo.getSetting("codex_worker_sandbox"),
      // A policy-selected Ollama route is authoritative. It must not depend on
      // the legacy global fallback backend, or the Codex adapter would silently
      // use its default premium provider while accounting the run to Ollama.
      modelArgs: providerLlmArgs(repo, selected.id),
      provider: selected.id,
    });
    repo.db
      .prepare(
        "UPDATE runs SET pid=?,log_path=?,last_message_path=? WHERE id=?",
      )
      .run(
        pid,
        resolve(runDir, "worker.log"),
        resolve(runDir, "last.md"),
        idRun,
      );
    repo.updateTask(t.id, { status: "in_progress" });
    repo.event(
      "dispatch",
      `Started ${worker} run ${idRun} via ${selected.id}`,
      t.id,
    );
    return idRun;
  } catch (e) {
    repo.db
      .prepare(
        "UPDATE runs SET status='failed',ended_at=?,summary=? WHERE id=?",
      )
      .run(new Date().toISOString(), String(e), idRun);
    releaseProvider(repo, idRun);
    throw e;
  }
}

export function dependencyWaiting(repo: Repo, t: Task): string {
  return (JSON.parse(t.depends_on) as string[])
    .flatMap((id) => {
      try {
        const dep = repo.task(id);
        if (dep.status !== "done") return [`等待依赖 ${id} 完成`];
        if (repo.project(dep.project_id).integration_branch && !dep.integrated)
          return [`等待依赖 ${id} 集成`];
      } catch {
        return [`依赖 ${id} 不存在`];
      }
      return [];
    })
    .join("；");
}
