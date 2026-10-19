import { alive } from "../core/process.js";
import { statuses, type Repo } from "../db/index.js";
export const SLIM_TEXT = 300;
export const trunc = (s: string | null | undefined, n = SLIM_TEXT) =>
  s == null ? s : s.length > n ? `${s.slice(0, n)}…` : s;
// A run row only counts as live when its status is running AND its process
// is really alive. A run without a pid yet is still being spawned.
export const runLive = (r: { status: string; pid: number | null }) =>
  r.status === "running" && (r.pid == null || alive(r.pid));
const RUN_COLS =
  "r.id,r.task_id,r.worker,r.provider,r.worker_kind,r.worker_model,r.worker_label,r.pid,r.status,r.started_at,r.ended_at,r.exit_code,r.test_exit_code";
export interface SlimRun {
  id: number;
  task_id: number;
  worker: string;
  provider: string | null;
  worker_kind: string | null;
  worker_model: string | null;
  worker_label: string | null;
  pid: number | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
  test_exit_code: number | null;
  summary: string | null;
  identifier: string;
  title: string;
  project_key: string;
}
export function slimRuns(
  repo: Repo,
  opts: { limit: number; task?: number; status?: string; before?: number },
) {
  const where: string[] = [],
    values: (string | number)[] = [];
  if (opts.task !== undefined) {
    where.push("r.task_id=?");
    values.push(opts.task);
  }
  if (opts.status) {
    where.push("r.status=?");
    values.push(opts.status);
  }
  if (opts.before !== undefined) {
    where.push("r.id<?");
    values.push(opts.before);
  }
  const base = `SELECT ${RUN_COLS},substr(r.summary,1,${SLIM_TEXT + 1}) AS summary,t.identifier,t.title,p.key AS project_key FROM runs r JOIN tasks t ON t.id=r.task_id JOIN projects p ON p.id=t.project_id`;
  const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const rows = repo.db
    .prepare(`${base}${clause} ORDER BY r.id DESC LIMIT ?`)
    .all(...values, opts.limit) as SlimRun[];
  // Running runs are always included so the board never loses a live worker.
  if (!opts.status && opts.before === undefined) {
    const seen = new Set(rows.map((r) => r.id));
    const extra = repo.db
      .prepare(
        `${base} WHERE r.status='running'${opts.task !== undefined ? " AND r.task_id=?" : ""} ORDER BY r.id DESC`,
      )
      .all(...(opts.task !== undefined ? [opts.task] : [])) as SlimRun[];
    for (const r of extra) if (!seen.has(r.id)) rows.push(r);
    rows.sort((a, b) => b.id - a.id);
  }
  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    summary: trunc(r.summary),
    live: runLive(r),
    elapsed_s: Math.max(
      0,
      (Date.parse(r.ended_at ?? new Date(now).toISOString()) -
        Date.parse(r.started_at)) /
        1000,
    ),
  }));
}
// task_id -> most recent run (one query for all tasks)
export function lastRuns(repo: Repo) {
  const rows = repo.db
    .prepare(
      "SELECT id,task_id,status,started_at,pid,worker_kind,worker_model,worker_label FROM runs WHERE id IN (SELECT MAX(id) FROM runs GROUP BY task_id)",
    )
    .all() as {
    id: number;
    task_id: number;
    status: string;
    started_at: string;
    pid: number | null;
    worker_kind: string | null;
    worker_model: string | null;
    worker_label: string | null;
  }[];
  return new Map(rows.map((r) => [r.task_id, r]));
}
export const slimTask = <
  T extends { description: string; feedback: string; blocker: string },
>(
  full: T,
) => {
  const { worktree_path: _w, ...t } = full as T & { worktree_path?: unknown };
  return {
    ...t,
    description: trunc(t.description) as string,
    feedback: trunc(t.feedback) as string,
    blocker: trunc(t.blocker) as string,
  };
};
// Live running runs grouped by project, reconciled with real pids.
export function liveRunning(repo: Repo) {
  const rows = repo.db
    .prepare(
      "SELECT r.id,r.pid,r.status,t.project_id FROM runs r JOIN tasks t ON t.id=r.task_id WHERE r.status='running'",
    )
    .all() as {
    id: number;
    pid: number | null;
    status: string;
    project_id: number;
  }[];
  return rows.filter(runLive);
}
export function statusCounts(repo: Repo, projectId?: number) {
  const rows = repo.db
    .prepare(
      `SELECT status,COUNT(*) AS n FROM tasks ${projectId === undefined ? "" : "WHERE project_id=?"} GROUP BY status`,
    )
    .all(...(projectId === undefined ? [] : [projectId])) as {
    status: string;
    n: number;
  }[];
  const by = new Map(rows.map((r) => [r.status, r.n]));
  return Object.fromEntries(statuses.map((s) => [s, by.get(s) ?? 0]));
}
