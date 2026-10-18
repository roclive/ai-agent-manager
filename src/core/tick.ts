import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Repo } from "../db/index.js";
import { alive, killGroup, type Runner, runner } from "./process.js";
import { withLock } from "./lock.js";
import { finalize, read } from "./finalize.js";
import { dispatch, dependenciesDone } from "./dispatch.js";
import { claudeReview } from "./review.js";
import { exportViews } from "../views/index.js";
export function tick(repo: Repo, reviewRunner: Runner = runner) {
  return withLock(repo, () => {
    repo.setSetting("last_tick_at", new Date().toISOString());
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
    if (!(Date.parse(repo.getSetting("cooldown_until") || "") > Date.now()))
      for (const t of repo.tasks({ status: "ready" })) {
        if (
          repo.runs().filter((r) => r.status === "running").length >=
          Number(repo.getSetting("max_parallel"))
        )
          break;
        if (!dependenciesDone(repo, t)) continue;
        try {
          dispatch(repo, t.identifier);
        } catch (e) {
          repo.updateTask(t.id, { status: "blocked", blocker: String(e) });
          repo.event("dispatch_error", String(e), t.id);
        }
      }
    if (repo.getSetting("review_mode") === "claude")
      for (const t of repo.tasks({ status: "in_review" })) {
        try {
          claudeReview(repo, t.identifier, reviewRunner);
        } catch (e) {
          repo.event("review_error", String(e), t.id);
        }
      }
    exportViews(repo);
    return true;
  });
}
