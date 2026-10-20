import { isClaudeWorkerScript } from "../workers/claude-script.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Repo, type Task } from "../db/index.js";
import { git } from "./process.js";
import { ensureWorktree } from "./worktree.js";
import { prompt, promptPrefixHash, spawnWorker } from "../workers/index.js";
import { detectIdentity, type WorkerIdentity } from "../workers/identity.js";
import { checkQuota, QuotaUnavailableError } from "./usage.js";
import { reserveProvider, releaseProvider } from "./providers.js";
import { providerPolicyConfigured } from "./provider-policy.js";
import {
  FALLBACK_PROVIDER,
  fallbackModel,
  localLlmModel,
  fallbackSelection,
  localModelWait,
  recordLocalModelMemory,
  localRunActive,
  startLocalLlm,
  stopLocalModelAfterTask,
  localLlmBaseUrl,
  markLocalModelActive,
} from "./local-model.js";

import { providerLlmArgs, recordBackend } from "./llm.js";
import { effortSupported, workerEffort } from "./worker-effort.js";
import { managerBackend, RulesBackend, recordManagerDecision, type ManagerBackend, type ManagerDecision } from "./manager-backend.js";
import { resolveExecutor } from "./executors.js";
import type { ProviderSelection } from "./providers.js";
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
// Low-quota fallback bypasses provider policy and quota: it is the last resort.
// An explicitly chosen coding executor is authoritative: neither the legacy low-quota
// fallback nor quota-aware routing may substitute another worker for it.
function choose(repo: Repo, t: Task, backend: ManagerBackend) {
  return backend.decide([t], { repo });
}
// The legacy single cooldown only gates quota-aware ("auto") routing; explicit executors
// carry their own per-executor cooldown (provider_breakers).
export function globalCooldownBlocks(repo: Repo, t: Task) {
  return (
    !providerPolicyConfigured(repo.getSetting("provider_policy")) &&
    Date.parse(repo.getSetting("cooldown_until") || "") > Date.now() &&
    resolveExecutor(repo, t).value === "auto"
  );
}
// Preview the same provider selection as dispatch without reserving or spawning work.
export function dispatchAvailability(repo: Repo, task: Task): string | null {
  try {
    // Availability is a read-only preview used by board/API reads. Keep it
    // deterministic and free of manager model calls or call-cap consumption.
    const selected = new RulesBackend().decide([task], { repo }).worker;
    const quota = selected.id === FALLBACK_PROVIDER ? { ok: true } : checkQuota(repo, selected.id);
    return quota.ok ? null : quota.warning || "执行器额度不可用";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function dispatch(
  repo: Repo,
  id: string,
  force = false,
  backend: ManagerBackend = managerBackend(repo),
  plannedDecision?: ManagerDecision,
) {
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
  if (globalCooldownBlocks(repo, t))
    throw new Error("Workers are in cooldown");

  let selected: ProviderSelection;
  let identity!: WorkerIdentity;
  try {
    const decision = plannedDecision ?? choose(repo, t, backend);
    if (decision.task.id !== t.id) throw new Error("Manager decision task does not match dispatch task");
    selected = decision.worker;
    recordManagerDecision(repo, backend.name, decision.candidates ?? [t], decision, decision.fallback);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    repo.event("quota_deferred", message, t.id);
    throw new QuotaUnavailableError(message);
  }
  const fallback = selected.id === FALLBACK_PROVIDER;
  if (fallback) {
    const wait = localModelWait(repo, t.id);
    if (wait) throw new QuotaUnavailableError(wait);
    recordLocalModelMemory(repo, t.id);
  }
  const quota = fallback ? { ok: true } : checkQuota(repo, selected.id);
  if (!quota.ok) {
    const message = quota.warning || `Quota exhausted for ${selected.id}`;
    repo.event("quota_deferred", message, t.id);
    throw new QuotaUnavailableError(message);
  }
  if ("warning" in quota && quota.warning) {
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
    // Keep the manager's chosen worker authoritative. Revalidate current worker
    // availability and reservation capacity, but never run a second decision.
    const current = selected;
    // Re-check the single-run lock inside the write transaction.
    if (current.id === FALLBACK_PROVIDER && localRunActive(repo))
      throw new Error("No provider available (local model run active)");
    identity = detectIdentity(current.worker, {
      modelArgs: providerLlmArgs(repo, current.id, current.model),
      effort: workerEffort(repo),
      fast: repo.getSetting("worker_fast_mode") !== "0",
      ...(current.id === FALLBACK_PROVIDER
        ? { model: fallbackModel(repo) }
        : current.model
          ? { model: current.model }
          : {}),
    });
    const result = repo.db
      .prepare(
        "INSERT INTO runs(task_id,worker,provider,worker_kind,worker_model,worker_label,status,started_at,start_sha,log_path,last_message_path) VALUES (?,?,?,?,?,?,'running',?,?,'','')",
      )
      .run(
        t.id,
        current.worker,
        current.id,
        identity.kind,
        identity.model,
        identity.label,
        started,
        startSha,
      );
    const runId = Number(result.lastInsertRowid);
    reserveProvider(repo, runId, current);
    const previous = repo.runs(t.id).find((r) => r.id !== runId && r.provider);
    repo.event(
      "route_selected",
      JSON.stringify({ provider: current.id, ...(current.model ? { model: current.model } : {}), reason: current.reason ?? "" }),
      t.id,
    );
    if (previous && previous.provider !== current.id)
      repo.event(
        "route_switch",
        JSON.stringify({ from: previous.provider, to: current.id }),
        t.id,
      );
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
    recordBackend(repo, runDir, selected.id, identity);
    const promptFile = resolve(runDir, "prompt.md");
    writeFileSync(
      promptFile,
      prompt(
        repo.project(t.project_id),
        t,
        t.resolves_task_id ? repo.task(t.resolves_task_id) : undefined,
      ),
    );
    repo.event(
      "prompt_prefix",
      promptPrefixHash(repo.project(t.project_id)),
      t.id,
    );
    if (fallback) markLocalModelActive(repo, t.id);
    const localProfile = fallback ? startLocalLlm(repo, t.id) : 0;
    const pid = spawnWorker(worker, {
      worktree,
      promptFile,
      runDir,
      sandbox: repo.getSetting("codex_worker_sandbox"),
      // A policy-selected Ollama route is authoritative. It must not depend on
      // the legacy global fallback backend, or the Codex adapter would silently
      // use its default premium provider while accounting the run to Ollama.
      modelArgs: providerLlmArgs(repo, selected.id, selected.model),
      provider: selected.id,
      ...(effortSupported(worker) || (process.env.AAM_FAKE_WORKER && isClaudeWorkerScript(process.env.AAM_FAKE_WORKER))
        ? { effort: workerEffort(repo) } : {}),
      fast: repo.getSetting("worker_fast_mode") !== "0",
      timeoutMin: Number(repo.getSetting("worker_timeout_min") || 45),
      ...(selected.id === FALLBACK_PROVIDER
        ? {
            model: selected.model || localLlmModel(repo),
            localBaseUrl: localLlmBaseUrl(repo),
            localContext: localProfile >= 2 ? 8192 : 32768,
          }
        : selected.model
          ? { model: selected.model }
          : {}),
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
      `Started ${identity.kind} run ${idRun}${identity.model ? ` (${identity.model})` : ""} via ${selected.id}`,
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
    // omlx may already be up (spawn failed afterwards): honor keep_warm on this task-end path.
    if (selected.id === FALLBACK_PROVIDER) stopLocalModelAfterTask(repo);
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
