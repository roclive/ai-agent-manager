import { usageState, checkQuota } from "./core/usage.js";
import { dependencyWaiting } from "./core/dispatch.js";
import { integrationStatus, integrate } from "./core/integration.js";
import { cors } from "hono/cors";
import { resolve, dirname } from "node:path";
import { uiRoutes, routineJSON, taskDetail } from "./api/ui.js";
import { statuses } from "./db/index.js";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { Repo } from "./db/index.js";
import { tick } from "./core/tick.js";
import { tail } from "./core/logs.js";
import { validateRoutine } from "./scheduler.js";
import {
  loadCodingProviders,
  providerStatuses,
} from "./workers/coding-providers.mjs";
function count(value: string | undefined, fallback: number) {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < 0 || n > 10000)
    throw new Error("Invalid count");
  return n;
}
export function createApp(
  repo: Repo,
  options: { port?: number; dist?: string } = {},
) {
  const app = new Hono();
  app.use(
    "*",
    cors({
      origin: ["http://127.0.0.1:5174", "http://localhost:5174"],
      allowHeaders: ["Content-Type", "X-AAM", "Last-Event-ID"],
      allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    }),
  );
  app.use("*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.header("X-AAM") !== "1") {
      let valid = false;
      try {
        const source = new URL(
          c.req.header("Origin") || c.req.header("Referer") || "",
        );
        valid =
          ["127.0.0.1", "localhost"].includes(source.hostname) &&
          Number(source.port || (source.protocol === "https:" ? 443 : 80)) ===
            (options.port ?? 3199);
      } catch {
        /* invalid or absent origin */
      }
      if (!valid)
        return c.json(
          { error: "X-AAM: 1 or same-origin request required" },
          403,
        );
    }
    await next();
  });
  app.onError((e, c) =>
    c.json({ error: e.message }, /not found/i.test(e.message) ? 404 : 400),
  );
  app.get("/api/projects", (c) =>
    c.json(
      repo.projects().map((p) => ({
        ...p,
        ...integrationStatus(p),
        counts: Object.fromEntries(
          statuses.map((s) => [
            s,
            repo.tasks({ project: p.key, status: s }).length,
          ]),
        ),
        running: repo
          .runs()
          .filter(
            (r) =>
              r.status === "running" &&
              repo.task(r.task_id).project_id === p.id,
          ).length,
      })),
    ),
  );
  app.get("/api/tasks", (c) =>
    c.json(
      repo
        .tasks({
          status: c.req.query("status"),
          project: c.req.query("project"),
        })
        .sort(
          (a, b) =>
            statuses.indexOf(a.status as (typeof statuses)[number]) -
              statuses.indexOf(b.status as (typeof statuses)[number]) ||
            a.sort_order - b.sort_order ||
            a.priority.localeCompare(b.priority) ||
            a.id - b.id,
        )
        .map((t) => ({ ...t, dependency_waiting: dependencyWaiting(repo, t) })),
    ),
  );
  app.post("/api/tasks", async (c) => {
    const input = await c.req.json();
    const task = repo.addTask(input);
    repo.event(
      "create",
      `Created via UI: ${Object.keys(input).join(", ")}`,
      task.id,
    );
    return c.json(task, 201);
  });
  app.get("/api/tasks/:id", (c) => c.json(taskDetail(repo, c.req.param("id"))));
  app.post("/api/tasks/:id/retry", async (c) => {
    const input = await c.req.text();
    const body: Record<string, unknown> = input ? JSON.parse(input) : {};
    if (
      !body ||
      Array.isArray(body) ||
      typeof body !== "object" ||
      Object.keys(body).some((key) => key !== "attempts") ||
      (Object.hasOwn(body, "attempts") && typeof body.attempts !== "number")
    )
      throw new Error("Invalid retry request");
    return c.json(
      repo.retryTask(c.req.param("id"), body.attempts as number | undefined),
    );
  });
  app.patch("/api/tasks/:id", async (c) => {
    const id = c.req.param("id");
    const input = await c.req.json<Record<string, unknown>>();
    const allowed = [
      "status",
      "priority",
      "title",
      "description",
      "worker",
      "sort",
      "sort_order",
      "depends_on",
      "role",
      "max_attempts",
    ];
    if (Object.keys(input).some((k) => !allowed.includes(k)))
      throw new Error("Unsupported task field");
    if (
      input.status !== undefined &&
      repo.runs(repo.task(id).id).some((r) => r.status === "running")
    )
      throw new Error("Task has a running worker");
    const { sort, ...patch } = input;
    if (sort !== undefined && patch.sort_order === undefined)
      patch.sort_order = sort;
    if (patch.depends_on !== undefined && !Array.isArray(patch.depends_on))
      throw new Error("Dependencies must be an array");
    const before = repo.task(id);
    let task = repo.updateTask(id, patch);
    if (before.status !== "done" && task.status === "done") {
      integrate(repo, id);
      task = repo.task(id);
    }
    repo.event(
      before.status !== task.status ? "move" : "edit",
      `${before.status !== task.status ? `status ${before.status} -> ${task.status} via UI; ` : "Edited via UI: "}${Object.keys(patch).join(", ")}`,
      task.id,
    );
    return c.json(task);
  });
  app.get("/api/runs/:id/:kind", (c) => {
    if (!["log", "test-log"].includes(c.req.param("kind")))
      return c.json({ error: "Not found" }, 404);
    const r = repo.runs().find((r) => r.id === Number(c.req.param("id")));
    if (!r) throw new Error("Run not found");
    return c.json({
      run_id: r.id,
      log: tail(
        c.req.param("kind") === "test-log"
          ? resolve(dirname(r.log_path), "test.log")
          : r.log_path,
        count(c.req.query("tail"), 100),
      ),
    });
  });
  app.get("/api/routines", (c) => c.json(repo.routines().map(routineJSON)));
  app.post("/api/routines", async (c) => {
    const p = await c.req.json();
    validateRoutine(p.cron, p.action, p.payload || {});
    repo.addRoutine(p.name, p.cron, p.action, p.payload || {});
    repo.event("routine", `Created ${p.name}: ${Object.keys(p).join(", ")}`);
    return c.json(
      routineJSON(repo.routines().find((r) => r.name === p.name)!),
      201,
    );
  });
  const patchRoutine = async (id: string, p: Record<string, unknown>) => {
    const r = repo.routines().find((r) => String(r.id) === id || r.name === id);
    if (!r) throw new Error("Routine not found");
    if (
      Object.keys(p).some(
        (k) =>
          !["name", "cron", "action", "payload", "enabled", "id"].includes(k),
      )
    )
      throw new Error("Unsupported routine field");
    const next = { ...r, ...p };
    if (typeof next.name !== "string" || !next.name.trim())
      throw new Error("Routine name required");
    const payload = Object.hasOwn(p, "payload")
      ? p.payload
      : JSON.parse(r.payload);
    validateRoutine(String(next.cron), String(next.action), payload);
    if (![0, 1, true, false].includes(next.enabled))
      throw new Error("Invalid enabled");
    repo.db
      .prepare(
        "UPDATE routines SET name=?,cron=?,action=?,payload=?,enabled=? WHERE id=?",
      )
      .run(
        next.name,
        next.cron,
        next.action,
        JSON.stringify(payload),
        next.enabled ? 1 : 0,
        r.id,
      );
    repo.event("routine", `Updated ${r.name}: ${Object.keys(p).join(", ")}`);
    return routineJSON(repo.routines().find((x) => x.id === r.id)!);
  };
  app.patch("/api/routines/:id", async (c) =>
    c.json(await patchRoutine(c.req.param("id"), await c.req.json())),
  );
  app.patch("/api/routines", async (c) => {
    const p = await c.req.json();
    if (p.id === undefined && p.name === undefined)
      throw new Error("Routine id or name required");
    return c.json(await patchRoutine(String(p.id ?? p.name), p));
  });
  app.post("/api/tick", (c) => {
    const ran = Boolean(tick(repo));
    repo.event("tick", `Heartbeat requested via UI: ran=${ran}`);
    return c.json({ ran });
  });
  app.get("/api/events", (c) => {
    const before = c.req.query("before");
    const limit = count(c.req.query("limit"), 50);
    if (
      before !== undefined &&
      (!/^\d+$/.test(before) || !Number.isSafeInteger(Number(before)))
    )
      throw new Error("Invalid event cursor");
    const clauses: string[] = [];
    const values: (string | number)[] = [];
    for (const [clause, value] of [
      ["e.id < ?", before],
      ["e.kind = ?", c.req.query("kind")],
      ["p.key = ?", c.req.query("project")],
    ])
      if (value) {
        clauses.push(clause!);
        values.push(value);
      }
    const task = c.req.query("task");
    if (task) {
      clauses.push("instr(lower(t.identifier), lower(?)) > 0");
      values.push(task);
    }
    return c.json(
      repo.db
        .prepare(
          `SELECT e.* FROM events e LEFT JOIN tasks t ON t.id=e.task_id LEFT JOIN projects p ON p.id=t.project_id ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY e.id DESC LIMIT ?`,
        )
        .all(...values, limit),
    );
  });
  app.get("/api/usage", (c) =>
    c.json({
      schema_version: 1,
      snapshots: repo
        .usageSnapshots(c.req.query("provider"))
        .map((snapshot) => ({
          ...snapshot,
          state: usageState(snapshot),
          warning: checkQuota(repo, snapshot.provider).warning ?? null,
        })),
    }),
  );
  app.get("/api/providers", async (c) =>
    c.json({
      schema_version: 1,
      providers: await providerStatuses(
        loadCodingProviders(resolve(repo.home, "opencode-routing.json")),
      ),
    }),
  );
  app.get("/api/settings", (c) => c.json(repo.settings()));
  app.put("/api/settings", async (c) => {
    const p = await c.req.json<Record<string, unknown>>();
    repo.db.transaction(() => {
      for (const [k, v] of Object.entries(p)) repo.setSetting(k, String(v));
    })();
    repo.event("settings", `Updated via UI: ${Object.keys(p).join(", ")}`);
    return c.json(repo.settings());
  });
  uiRoutes(app, repo, options.dist);
  return app;
}
export function startServer(repo: Repo, port = 3199) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid port");
  const server = serve({
    fetch: createApp(repo, { port }).fetch,
    hostname: "127.0.0.1",
    port,
  });
  return new Promise<void>((resolve, reject) => {
    const stop = () =>
      server.close((e) => {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        if (e) reject(e);
        else resolve();
      });
    server.on("error", reject);
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    console.log(`aam listening on http://127.0.0.1:${port}`);
  });
}
