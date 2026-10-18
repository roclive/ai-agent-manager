import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Repo, type Task } from "../db/index.js";
import { git } from "./process.js";
import { ensureWorktree } from "./worktree.js";
import { prompt, spawnWorker } from "../workers/index.js";
import { llmArgs, llmBackend, recordBackend } from "./llm.js";
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
  if (Date.parse(repo.getSetting("cooldown_until") || "") > Date.now())
    throw new Error("Workers are in cooldown");
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
  const worker = llmBackend(repo) === "ollama" ? "codex" : t.worker;
  const result = repo.db
    .prepare(
      "INSERT INTO runs(task_id,worker,status,started_at,start_sha,log_path,last_message_path) VALUES (?,?,'running',?,?,'','')",
    )
    .run(t.id, worker, started, startSha);
  const idRun = Number(result.lastInsertRowid);
  const runDir = resolve(repo.home, "runs", String(idRun));
  try {
    mkdirSync(runDir, { recursive: true });
    recordBackend(repo, runDir);
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
      modelArgs: llmArgs(repo),
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
      `Started ${worker} run ${idRun} (${llmBackend(repo)})`,
      t.id,
    );
    return idRun;
  } catch (e) {
    repo.db
      .prepare(
        "UPDATE runs SET status='failed',ended_at=?,summary=? WHERE id=?",
      )
      .run(new Date().toISOString(), String(e), idRun);
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
