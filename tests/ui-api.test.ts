import { it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createApp } from "../src/server.js";
import { Repo } from "../src/db/index.js";
import { fixture } from "./helpers.js";
import { alive } from "../src/core/process.js";
let f: ReturnType<typeof fixture>;
afterEach(() => f?.cleanup());
function setup(script?: string) {
  f = fixture(script);
  const dist = resolve(f.root, "dist");
  const app = createApp(f.repo, { dist });
  const req = (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = { "X-AAM": "1" },
  ) =>
    app.request(path, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { app, req, dist };
}
it("guards mutations and allows only configured CORS origins", async () => {
  const { req } = setup();
  for (const method of ["POST", "PATCH", "PUT", "DELETE"])
    expect((await req("/api/tasks", method, {}, {})).status).toBe(403);
  expect(
    (
      await req(
        "/api/tasks",
        "POST",
        { project: "T", title: "ok" },
        { Origin: "http://localhost:3199" },
      )
    ).status,
  ).toBe(201);
  expect(
    (await req("/api/tasks", "POST", {}, { Origin: "http://localhost:3198" }))
      .status,
  ).toBe(403);
  expect(
    (
      await req("/api/settings", "GET", undefined, {
        Origin: "https://evil.test",
      })
    ).headers.get("Access-Control-Allow-Origin"),
  ).toBeNull();
  const preflight = await req("/api/tasks", "OPTIONS", undefined, {
    Origin: "http://localhost:5174",
    "Access-Control-Request-Headers": "X-AAM",
  });
  expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain(
    "X-AAM",
  );
});
it("orders tasks without changing sequence, validates dependencies and clears blockers", async () => {
  const { req } = setup();
  const a = f.task({ status: "blocked", blocker: "old", feedback: "keep" }),
    b = f.task(),
    c = f.task({ status: "backlog" });
  expect(
    (
      await req(`/api/tasks/${a.id}`, "PATCH", {
        status: "ready",
        sort_order: -1,
        role: "backend",
        max_attempts: 4,
        depends_on: [b.identifier],
      })
    ).status,
  ).toBe(200);
  expect(f.repo.task(a.id)).toMatchObject({
    seq: 1,
    sort_order: -1,
    blocker: "",
    feedback: "keep",
  });
  expect(
    (await req(`/api/tasks/${b.id}`, "PATCH", { depends_on: [a.identifier] }))
      .status,
  ).toBe(400);
  expect(
    (await req(`/api/tasks/${b.id}`, "PATCH", { depends_on: ["T-999"] }))
      .status,
  ).toBe(404);
  expect((await req(`/api/tasks/${b.id}`, "PATCH", { seq: 99 })).status).toBe(
    400,
  );
  expect(
    (await (await req("/api/tasks")).json()).map((t: { id: number }) => t.id),
  ).toEqual([c.id, a.id, b.id]);
  expect((await req(`/api/tasks/${b.id}`, "PATCH", { sort: 0.5 })).status).toBe(
    200,
  );
});
it("supports project CRUD validation, status, review and merge guards", async () => {
  const { req } = setup();
  expect(
    (
      await req("/api/projects", "POST", {
        key: "N",
        name: "New",
        repo_path: f.path,
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await req("/api/projects/N", "PATCH", {
        name: "Changed",
        repo_path: f.root,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await req("/api/projects/N", "PATCH", {
        name: "Changed",
        base_branch: "main",
        test_cmd: "true",
        setup_cmd: null,
      })
    ).status,
  ).toBe(200);
  const t = f.task({ status: "in_review" });
  expect(await (await req("/api/status")).json()).toMatchObject({
    review_pending: 1,
    daemon: { running: false },
    counts_by_status: { in_review: 1 },
  });
  writeFileSync(resolve(f.repo.home, "tick.lock"), String(process.pid));
  expect(await (await req("/api/status")).json()).toMatchObject({
    daemon: { running: true, pid: process.pid },
  });
  expect(
    (
      await req(`/api/tasks/${t.id}/review`, "POST", {
        verdict: "reject",
        note: "retry",
      })
    ).status,
  ).toBe(200);
  f.repo.updateTask(t.id, { status: "in_review" });
  expect(
    (await req(`/api/tasks/${t.id}/review`, "POST", { verdict: "approve" }))
      .status,
  ).toBe(200);
  expect(
    (await req(`/api/tasks/${t.id}/merge`, "POST", { into: "main" })).status,
  ).toBe(400);
  expect(await (await req(`/api/tasks/${t.id}`)).json()).toMatchObject({
    diff_stat: null,
    last_message: null,
  });
  expect((await (await req("/api/projects")).json())[1]).toMatchObject({
    counts: { done: 1 },
    running: 0,
  });
});
it("dispatches and cancels a real fake process group, exposes runs and logs", async () => {
  const { req } = setup("sleep 30");
  const t = f.task();
  const response = await req(`/api/tasks/${t.id}/run`, "POST", {});
  expect(response.status).toBe(200);
  const run = f.repo.runs()[0];
  expect(alive(run.pid)).toBe(true);
  writeFileSync(run.last_message_path, "x".repeat(9000));
  writeFileSync(resolve(dirname(run.log_path), "test.log"), "one\ntwo\n");
  expect(
    (await (await req(`/api/tasks/${t.id}`)).json()).last_message,
  ).toHaveLength(8192);
  expect(
    await (await req(`/api/runs/${run.id}/test-log?tail=1`)).json(),
  ).toMatchObject({ log: "two" });
  expect((await req(`/api/runs/${run.id}/log?tail=0`)).status).toBe(200);
  expect(
    (
      await (
        await req(`/api/runs?status=running&task=${t.identifier}&limit=1`)
      ).json()
    )[0],
  ).toMatchObject({
    identifier: t.identifier,
    project_key: "T",
    elapsed_s: expect.any(Number),
  });
  expect((await req(`/api/tasks/${t.id}/cancel`, "POST")).status).toBe(200);
  await new Promise((r) => setTimeout(r, 50));
  expect(alive(run.pid)).toBe(false);
  expect(f.repo.runs()[0]).toMatchObject({
    status: "failed",
    summary: "cancelled by user",
  });
  expect(f.repo.task(t.id)).toMatchObject({
    status: "blocked",
    blocker: "cancelled",
  });
});
it("validates, updates, fires and deletes routines with firing history", async () => {
  const { req } = setup();
  expect(
    (
      await req("/api/routines", "POST", {
        name: "bad",
        cron: "bad",
        action: "heartbeat",
      })
    ).status,
  ).toBe(400);
  const res = await req("/api/routines", "POST", {
    name: "create",
    cron: "0 * * * *",
    action: "create_task",
    payload: { project: "T", title: "scheduled" },
  });
  const r = await res.json();
  expect(r.next_run_at).toEqual(expect.any(String));
  expect(
    (await req(`/api/routines/${r.id}`, "PATCH", { cron: "bad" })).status,
  ).toBe(400);
  expect(
    (
      await req(`/api/routines/${r.id}`, "PATCH", {
        enabled: false,
        name: "renamed",
      })
    ).status,
  ).toBe(200);
  expect((await req(`/api/routines/${r.id}/run`, "POST")).status).toBe(200);
  expect(await (await req(`/api/routines/${r.id}/runs`)).json()).toHaveLength(
    1,
  );
  expect((await req(`/api/routines/${r.id}`, "DELETE")).status).toBe(200);
  expect((await req(`/api/routines/${r.id}/run`, "POST")).status).toBe(404);
});
it("streams newly inserted events and resumes after last event ID", async () => {
  const { app } = setup();
  f.repo.event("old", "old");
  const response = await app.request("/api/stream", {
    headers: { "Last-Event-ID": "1" },
  });
  const reader = response.body!.getReader();
  f.repo.event("new", "new");
  const result = await reader.read();
  const text = new TextDecoder().decode(result.value);
  expect(text).toContain("event: events");
  expect(text).toContain("id: 2");
  expect(text).toContain("new");
  expect(text).not.toContain("old");
  await reader.cancel();
});
it("serves missing UI notice, assets, SPA fallback and rejects symlink escapes", async () => {
  const { req, dist } = setup();
  expect(await (await req("/")).text()).toContain("UI not built");
  mkdirSync(resolve(dist, "assets"), { recursive: true });
  writeFileSync(resolve(dist, "index.html"), "<h1>App</h1>");
  writeFileSync(resolve(dist, "assets/app-12345678.js"), "console.log(1)");
  expect(await (await req("/tasks/T-1")).text()).toContain("App");
  const asset = await req("/assets/app-12345678.js");
  expect(asset.headers.get("Content-Type")).toContain("javascript");
  expect(asset.headers.get("Cache-Control")).toContain("immutable");
  symlinkSync(resolve(f.path, "initial.txt"), resolve(dist, "escape"));
  expect((await req("/escape")).status).toBe(400);
  expect((await req("/%2e%2e%2fsecret")).status).toBe(400);
  expect((await req("/api/missing")).status).toBe(404);
});

it("migrates sort_order from seq exactly once and records ticks", async () => {
  const { req } = setup();
  const t = f.task({ status: "backlog" });
  f.repo.db.exec("ALTER TABLE tasks DROP COLUMN sort_order");
  const migrated = new Repo(f.repo.home);
  expect(migrated.task(t.id).sort_order).toBe(t.seq);
  migrated.updateTask(t.id, { sort_order: 0.25 });
  migrated.close();
  const reopened = new Repo(f.repo.home);
  expect(reopened.task(t.id).sort_order).toBe(0.25);
  reopened.close();
  expect((await req("/api/tick", "POST")).status).toBe(200);
  expect(f.repo.getSetting("last_tick_at")).toEqual(expect.any(String));
  expect(Number.isFinite(Date.parse(f.repo.getSetting("last_tick_at")!))).toBe(
    true,
  );
});
