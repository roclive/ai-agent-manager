import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { Repo } from "./db/index.js";
import { tick } from "./core/tick.js";
import { tail } from "./core/logs.js";
import { validateRoutine } from "./scheduler.js";
function count(value: string | undefined, fallback: number) {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < 0 || n > 10000)
    throw new Error("Invalid count");
  return n;
}
export function createApp(repo: Repo) {
  const app = new Hono();
  app.onError((e, c) =>
    c.json({ error: e.message }, /not found/i.test(e.message) ? 404 : 400),
  );
  app.get("/api/projects", (c) => c.json(repo.projects()));
  app.get("/api/tasks", (c) =>
    c.json(
      repo.tasks({
        status: c.req.query("status"),
        project: c.req.query("project"),
      }),
    ),
  );
  app.post("/api/tasks", async (c) =>
    c.json(repo.addTask(await c.req.json()), 201),
  );
  app.get("/api/tasks/:id", (c) => c.json(repo.detail(c.req.param("id"))));
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
    ];
    if (Object.keys(input).some((k) => !allowed.includes(k)))
      throw new Error("Unsupported task field");
    if (
      input.status !== undefined &&
      repo.runs(repo.task(id).id).some((r) => r.status === "running")
    )
      throw new Error("Task has a running worker");
    const { sort, ...patch } = input;
    if (sort !== undefined) patch.seq = sort;
    return c.json(repo.updateTask(id, patch));
  });
  app.get("/api/runs/:id/log", (c) => {
    const r = repo.runs().find((r) => r.id === Number(c.req.param("id")));
    if (!r) throw new Error("Run not found");
    return c.json({
      run_id: r.id,
      log: tail(r.log_path, count(c.req.query("tail"), 100)),
    });
  });
  app.get("/api/routines", (c) => c.json(repo.routines()));
  app.post("/api/routines", async (c) => {
    const p = await c.req.json();
    validateRoutine(p.cron, p.action, p.payload || {});
    repo.addRoutine(p.name, p.cron, p.action, p.payload || {});
    return c.json(
      repo.routines().find((r) => r.name === p.name),
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
    return repo.routines().find((x) => x.id === r.id);
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
  app.post("/api/tick", (c) => c.json({ ran: Boolean(tick(repo)) }));
  app.get("/api/events", (c) =>
    c.json(repo.events(count(c.req.query("limit"), 50))),
  );
  app.get("/api/settings", (c) => c.json(repo.settings()));
  app.put("/api/settings", async (c) => {
    const p = await c.req.json<Record<string, unknown>>();
    repo.db.transaction(() => {
      for (const [k, v] of Object.entries(p)) repo.setSetting(k, String(v));
    })();
    return c.json(repo.settings());
  });
  return app;
}
export function startServer(repo: Repo, port = 3199) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid port");
  const server = serve({
    fetch: createApp(repo).fetch,
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
