import { promote, setIntegration } from "../core/integration.js";
import {
  readFileSync,
  realpathSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { resolve, dirname, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Cron } from "croner";
import { Repo, statuses, type Routine } from "../db/index.js";
import { alive, git, killGroup } from "../core/process.js";
import { resolveExecutor, executorsView } from "../core/executors.js";
import { dispatch } from "../core/dispatch.js";
import { review } from "../core/review.js";
import { merge } from "../core/worktree.js";
import { autopilotStatus } from "../core/autopilot.js";
import { fireRoutine } from "../scheduler.js";
import { releaseProvider } from "../core/providers.js";
export const routineJSON = (r: Routine) => {
  const cron = new Cron(r.cron, { paused: true });
  try {
    return {
      ...r,
      next_run_at: r.enabled ? (cron.nextRun()?.toISOString() ?? null) : null,
    };
  } finally {
    cron.stop();
  }
};
export function taskDetail(repo: Repo, id: string) {
  const detail = {
    ...repo.detail(id),
    effective_executor: resolveExecutor(repo, repo.task(id)),
  };
  let diff_stat: string | null = null,
    last_message: string | null = null;
  try {
    if (detail.branch)
      diff_stat = git(repo.project(detail.project_id).repo_path, [
        "diff",
        "--stat",
        `${repo.project(detail.project_id).base_branch}...${detail.branch}`,
        "--",
      ]);
  } catch {
    /* branch may not exist yet */
  }
  const last = detail.runs[0];
  if (last) {
    let fd: number | undefined;
    try {
      fd = openSync(last.last_message_path, "r");
      const buffer = Buffer.alloc(8192);
      last_message = new TextDecoder().decode(
        buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, 0)),
        { stream: true },
      );
    } catch {
      /* worker may not have written last.md */
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  return { ...detail, diff_stat, last_message };
}
export function uiRoutes(
  app: Hono,
  repo: Repo,
  dist = fileURLToPath(new URL("../../ui/dist", import.meta.url)),
) {
  app.post("/api/projects", async (c) => {
    const p = await c.req.json();
    validateProject(p);
    const project = repo.addProject(p);
    repo.event(
      "settings",
      `Created project ${project.key}: ${Object.keys(p).join(", ")}`,
    );
    return c.json(project, 201);
  });
  app.post("/api/projects/:key/promote", async (c) => {
    const p = await c.req.json();
    promote(repo, c.req.param("key"), p.confirm === true, p.into);
    return c.json({ promoted: true });
  });
  app.patch("/api/projects/:key", async (c) => {
    const p = await c.req.json<Record<string, unknown>>();
    const { integration, ...patch } = p;
    const next = { ...repo.project(c.req.param("key")), ...patch };
    validateProject(next);
    repo.updateProject(c.req.param("key"), patch);
    if (integration !== undefined)
      setIntegration(repo, c.req.param("key"), String(integration));
    repo.event(
      "settings",
      `Updated project ${next.key}: ${Object.keys(p).join(", ")}`,
    );
    return c.json(repo.project(next.id));
  });
  app.post("/api/tasks/:id/review", async (c) => {
    const p = await c.req.json();
    if (p.note !== undefined && typeof p.note !== "string")
      throw new Error("Invalid note");
    review(repo, c.req.param("id"), p.verdict, p.note);
    return c.json(taskDetail(repo, c.req.param("id")));
  });
  app.post("/api/tasks/:id/run", async (c) => {
    const text = await c.req.text();
    const p = text.trim() ? JSON.parse(text) : {};
    if (p.force !== undefined && typeof p.force !== "boolean")
      throw new Error("Invalid force");
    return c.json({ run_id: dispatch(repo, c.req.param("id"), p.force) });
  });
  app.post("/api/tasks/:id/merge", async (c) => {
    const p = await c.req.json();
    if (typeof p.into !== "string" || !p.into)
      throw new Error("Target branch required");
    merge(repo, c.req.param("id"), p.into);
    return c.json({ merged: true });
  });
  app.post("/api/tasks/:id/cancel", (c) => {
    const t = repo.task(c.req.param("id"));
    for (const r of repo.runs(t.id).filter((r) => r.status === "running")) {
      if (alive(r.pid)) killGroup(r.pid);
      repo.db
        .prepare(
          "UPDATE runs SET status='failed',ended_at=?,summary='cancelled by user' WHERE id=?",
        )
        .run(new Date().toISOString(), r.id);
      releaseProvider(repo, r.id);
    }
    repo.updateTask(t.id, { status: "blocked", blocker: "cancelled" });
    repo.event("cancel", "cancelled by user", t.id);
    return c.json(repo.task(t.id));
  });
  app.get("/api/runs", (c) => {
    const limit = Number(c.req.query("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 0 || limit > 10000)
      throw new Error("Invalid limit");
    const task = c.req.query("task");
    const taskId = task ? repo.task(task).id : undefined;
    return c.json(
      repo
        .runs(taskId)
        .filter(
          (r) => !c.req.query("status") || r.status === c.req.query("status"),
        )
        .slice(0, limit)
        .map((r) => {
          const t = repo.task(r.task_id);
          return {
            ...r,
            identifier: t.identifier,
            title: t.title,
            project_key: repo.project(t.project_id).key,
            elapsed_s: Math.max(
              0,
              (Date.parse(r.ended_at ?? new Date().toISOString()) -
                Date.parse(r.started_at)) /
                1000,
            ),
          };
        }),
    );
  });
  app.get("/api/status", (c) => {
    let pid = 0;
    try {
      pid = Number(readFileSync(resolve(repo.home, "tick.lock"), "utf8"));
    } catch {
      /* idle */
    }
    const lockAlive = Number.isInteger(pid) && pid > 0 && alive(pid);
    const now = Date.now();
    const lastTick = repo.getSetting("last_tick_at") || null;
    const timestamp = Date.parse(lastTick ?? "");
    const age = Number.isFinite(timestamp)
      ? Math.max(0, (now - timestamp) / 1000)
      : null;
    const running = lockAlive || (age !== null && age <= 180);
    return c.json({
      now: new Date(now).toISOString(),
      daemon: {
        running,
        ...(lockAlive ? { pid } : {}),
        last_tick_at: lastTick,
        last_tick_age_s: age,
      },
      cooldown_until: repo.getSetting("cooldown_until"),
      executors: executorsView(repo),
      running_runs: repo.runs().filter((r) => r.status === "running").length,
      max_parallel: Number(repo.getSetting("max_parallel")),
      counts_by_status: Object.fromEntries(
        statuses.map((s) => [s, repo.tasks({ status: s }).length]),
      ),
      autopilot: autopilotStatus(repo),
      keep_awake_pid: Number(repo.getSetting("keep_awake_pid")) || null,
      review_pending: repo.tasks({ status: "in_review" }).length,
    });
  });
  app.get("/api/stream", (c) => {
    const raw = c.req.header("Last-Event-ID") ?? c.req.query("since");
    const replay = c.req.query("replay") ?? "0";
    for (const value of [raw, replay])
      if (
        value !== undefined &&
        (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
      )
        throw new Error("Invalid event ID or replay count");
    const latest = (
      repo.db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM events").get() as {
        id: number;
      }
    ).id;
    let cursor = raw === undefined ? latest : Number(raw);
    if (raw === undefined && Number(replay) > 0) {
      const rows = repo.db
        .prepare("SELECT id FROM events ORDER BY id DESC LIMIT ?")
        .all(Number(replay)) as { id: number }[];
      if (rows.length) cursor = rows[rows.length - 1].id - 1;
    }
    return streamSSE(c, async (stream) => {
      let stopped = false;
      stream.onAbort(() => {
        stopped = true;
      });
      let ping = Date.now();
      while (!stopped) {
        const rows = repo.db
          .prepare("SELECT * FROM events WHERE id>? ORDER BY id LIMIT 1000")
          .all(cursor) as { id: number }[];
        for (const row of rows) {
          await stream.writeSSE({
            event: "events",
            id: String(row.id),
            data: JSON.stringify(row),
          });
          cursor = row.id;
        }
        if (Date.now() - ping >= 20000) {
          await stream.writeSSE({
            event: "ping",
            data: new Date().toISOString(),
          });
          ping = Date.now();
        }
        await stream.sleep(1000);
      }
    });
  });
  const routine = (id: string) => {
    const r = repo.routines().find((r) => String(r.id) === id || r.name === id);
    if (!r) throw new Error("Routine not found");
    return r;
  };
  app.delete("/api/routines/:id", (c) => {
    const r = routine(c.req.param("id"));
    repo.db.prepare("DELETE FROM routines WHERE id=?").run(r.id);
    repo.event("routine", `Deleted ${r.name}: name`);
    return c.json({ deleted: true });
  });
  app.post("/api/routines/:id/run", async (c) => {
    const r = routine(c.req.param("id"));
    await fireRoutine(repo, r);
    return c.json(routineJSON(routine(String(r.id))));
  });
  app.get("/api/routines/:id/runs", (c) => {
    const r = routine(c.req.param("id"));
    return c.json(
      repo.db
        .prepare(
          "SELECT * FROM events WHERE kind='routine_fire' AND json_extract(message,'$.routine_id')=? ORDER BY id DESC LIMIT 20",
        )
        .all(r.id),
    );
  });
  app.get("*", (c) => {
    if (c.req.path === "/api" || c.req.path.startsWith("/api/"))
      return c.json({ error: "Not found" }, 404);
    let path: string;
    try {
      path = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return c.json({ error: "Invalid path" }, 400);
    }
    if (
      path.includes("\\") ||
      path.includes("\0") ||
      path.split("/").includes("..")
    )
      return c.json({ error: "Invalid path" }, 400);
    let root: string;
    try {
      root = realpathSync(dist);
    } catch {
      return c.html(
        "<!doctype html><p>UI not built — run npm run ui:build</p>",
      );
    }
    const safeFile = (candidate: string) => {
      const file = realpathSync(candidate);
      if (file !== root && !file.startsWith(root + sep))
        throw new Error("Invalid path");
      return file;
    };
    let file: string;
    try {
      file = safeFile(resolve(root, "." + path));
      if (!statSync(file).isFile())
        file = safeFile(resolve(root, "index.html"));
    } catch (e) {
      if (e instanceof Error && e.message === "Invalid path")
        return c.json({ error: "Invalid path" }, 400);
      file = safeFile(resolve(root, "index.html"));
    }
    const types: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".ico": "image/x-icon",
      ".woff2": "font/woff2",
      ".woff": "font/woff",
      ".webp": "image/webp",
    };
    c.header(
      "Content-Type",
      types[extname(file)] ?? "application/octet-stream",
    );
    c.header(
      "Cache-Control",
      file.startsWith(root + sep + "assets" + sep) &&
        /[.-][\w-]+\.[^.]+$/.test(file) &&
        extname(file) !== ".html"
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    );
    return c.body(readFileSync(file));
  });
}
function validateProject(p: Record<string, unknown>) {
  for (const k of ["name", "repo_path"])
    if (typeof p[k] !== "string" || !String(p[k]).trim())
      throw new Error(`Invalid ${k}`);
  for (const k of ["base_branch", "test_cmd", "setup_cmd"])
    if (p[k] !== undefined && p[k] !== null && typeof p[k] !== "string")
      throw new Error(`Invalid ${k}`);
  git(resolve(p.repo_path as string), ["rev-parse", "--git-dir"]);
}
