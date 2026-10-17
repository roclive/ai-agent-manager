import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Repo, type Task } from "../db/index.js";
import { ensureWorktree } from "./worktree.js";
import { prompt, spawnWorker } from "../workers/index.js";
export function dependenciesDone(repo: Repo, t: Task) {
  return (JSON.parse(t.depends_on) as string[]).every((id) => {
    try {
      return repo.task(id).status === "done";
    } catch {
      return false;
    }
  });
}
export function dispatch(repo: Repo, id: string, force = false) {
  const t = repo.task(id);
  if (repo.runs(t.id).some((r) => r.status === "running"))
    throw new Error("Task already running");
  if (!["ready", "backlog"].includes(t.status))
    throw new Error("Task must be ready or backlog");
  if (!force && !dependenciesDone(repo, t))
    throw new Error("Dependencies not done");
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
  const started = new Date().toISOString();
  const result = repo.db
    .prepare(
      "INSERT INTO runs(task_id,worker,status,started_at,log_path,last_message_path) VALUES (?,?,'running',?,'','')",
    )
    .run(t.id, t.worker, started);
  const idRun = Number(result.lastInsertRowid);
  const runDir = resolve(repo.home, "runs", String(idRun));
  try {
    mkdirSync(runDir, { recursive: true });
    const promptFile = resolve(runDir, "prompt.md");
    writeFileSync(promptFile, prompt(repo.project(t.project_id), t));
    const pid = spawnWorker(t.worker, { worktree, promptFile, runDir });
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
    repo.event("dispatch", `Started ${t.worker} run ${idRun}`, t.id);
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
