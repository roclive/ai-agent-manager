import { reconcileIntegration } from "./integration.js";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Repo } from "../db/index.js";
import { alive, killGroup, type Runner, runner } from "./process.js";
import { withLock } from "./lock.js";
import { finalize, read } from "./finalize.js";
import {
  dispatch,
  dependenciesDone,
  globalCooldownBlocks,
  resolutionBusy,
} from "./dispatch.js";
import { collectAutopilot, promoteIdle, startAutopilot } from "./autopilot.js";
import { exportViews } from "../views/index.js";
import { QuotaUnavailableError } from "./usage.js";
import {
  FALLBACK_PROVIDER,
  localRunActive,
  stopLocalModelAfterTask,
} from "./local-model.js";
import { managerBackend, type ManagerBackend } from "./manager-backend.js";
export function tick(
  repo: Repo,
  _reviewRunner: Runner = runner,
  backend: ManagerBackend = managerBackend(repo),
) {
  return withLock(repo, () => {
    repo.setSetting("last_tick_at", new Date().toISOString());
    const localBefore = repo
      .runs()
      .some((r) => r.status === "running" && r.provider === FALLBACK_PROVIDER);
    for (const r of repo.runs().filter((r) => r.status === "running")) {
      try {
        const exited = existsSync(resolve(dirname(r.log_path), "exit_code"));
        if (exited) finalize(repo, r);
        else if (
          Date.now() - Date.parse(r.started_at) >
          Number(repo.getSetting("worker_timeout_min")) * 60000
        ) {
          killGroup(r.pid);
          finalize(repo, r, "timeout");
        } else if (!alive(r.pid)) {
          const pidText = read(
            resolve(dirname(r.log_path), "worker.pid"),
          ).trim();
          const workerPid = /^[1-9]\d*$/.test(pidText) ? Number(pidText) : null;
          if (!alive(workerPid)) finalize(repo, r, "lost");
        }
      } catch (e) {
        repo.event("reap_error", String(e), r.task_id);
      }
    }
    // Unload the 9.4 GB model as soon as its run has ended (finished, failed, timed out or lost).
    if (localBefore && !localRunActive(repo)) stopLocalModelAfterTask(repo);
    reconcileIntegration(repo);
    {
      let candidates = repo
        .tasks({ status: "ready" })
        .filter(
          (t) =>
            !repo.project(t.project_id).hidden &&
            dependenciesDone(repo, t) &&
            !resolutionBusy(repo, t) &&
            !globalCooldownBlocks(repo, t),
        );
      while (candidates.length) {
        if (
          repo.runs().filter((r) => r.status === "running").length >=
          Number(repo.getSetting("max_parallel"))
        )
          break;
        // Earlier dispatches can make integration-resolution candidates busy.
        candidates = candidates.filter(
          (t) => dependenciesDone(repo, t) && !resolutionBusy(repo, t) && !globalCooldownBlocks(repo, t),
        );
        if (!candidates.length) break;
        let decision;
        try {
          decision = backend.decide(candidates, { repo });
        } catch (error) {
          // Routing failures used to be caught inside dispatch. Keep the task
          // ready and continue checking other candidates, even for malformed
          // legacy policy rows or unavailable executors.
          const deferred = candidates.shift()!;
          repo.event("quota_deferred", String(error), deferred.id);
          continue;
        }
        const t = decision.task;
        if (!candidates.some((candidate) => candidate.id === t.id))
          throw new Error("Manager selected a task outside its candidates");
        const considered = [...candidates];
        candidates = candidates.filter((candidate) => candidate.id !== t.id);
        try {
          dispatch(repo, t.identifier, false, backend, { ...decision, candidates: considered });
        } catch (e) {
          if (e instanceof QuotaUnavailableError) continue;
          repo.updateTask(t.id, { status: "blocked", blocker: String(e) });
          repo.event("dispatch_error", String(e), t.id);
        }
      }
    }
    collectAutopilot(repo);
    promoteIdle(repo);
    startAutopilot(repo);
    exportViews(repo);
    return true;
  });
}
