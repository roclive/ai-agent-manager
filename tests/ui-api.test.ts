import { it, expect, afterEach, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createApp } from "../src/server.js";
import { Repo } from "../src/db/index.js";
import { fixture } from "./helpers.js";
import { daemon } from "../src/scheduler.js";
import { alive } from "../src/core/process.js";
let f: ReturnType<typeof fixture>;
afterEach(() => {
  vi.useRealTimers();
  f?.cleanup();
});
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
  expect(() => process.kill(-run.pid!, 0)).toThrow();
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
    headers: {},
  });
  const reader = response.body!.getReader();
  f.repo.event("new", "new");
  f.repo.event("new", "second");
  const result = await reader.read();
  const text = new TextDecoder().decode(result.value);
  expect(text).toContain("event: events");
  expect(text).toContain("id: 2");
  expect(text).toContain("new");
  expect(text).not.toContain("old");
  const second = new TextDecoder().decode((await reader.read()).value);
  expect(second).toContain("id: 3");
  expect(second).not.toContain("id: 2");
  await reader.cancel();
  for (const [url, headers] of [
    ["/api/stream", { "Last-Event-ID": "2" }],
    ["/api/stream?since=2", {}],
    ["/api/stream?replay=1", {}],
  ] as [string, Record<string, string>][]) {
    const resumed = await app.request(url, { headers });
    const reader = resumed.body!.getReader();
    const text = new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain("id: 3");
    expect(text).not.toContain("id: 2");
    await reader.cancel();
  }
});
it("serves missing UI notice, assets, SPA fallback and rejects symlink escapes", async () => {
  const { req, dist } = setup();
  expect(await (await req("/")).text()).toContain("UI not built");
  mkdirSync(resolve(dist, "assets"), { recursive: true });
  writeFileSync(resolve(dist, "index.html"), "<h1>App</h1>");
  writeFileSync(resolve(dist, "assets/app-abc.js"), "console.log(1)");
  mkdirSync(resolve(dist, "directory"));
  writeFileSync(resolve(dist, "plain.js"), "plain");
  for (const path of ["/", "/board", "/directory", "/index.html"]) {
    const response = await req(path);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("App");
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
  }
  expect((await req("/plain.js")).headers.get("Cache-Control")).toBe(
    "no-cache",
  );
  writeFileSync(resolve(f.root, "x"), "OUTSIDE SECRET");
  for (const path of ["/%2e%2e/x", "/a/../../x"])
    expect(await (await req(path)).text()).not.toContain("OUTSIDE SECRET");
  const asset = await req("/assets/app-abc.js");
  expect(asset.headers.get("Content-Type")).toContain("javascript");
  expect(asset.headers.get("Cache-Control")).toBe(
    "public, max-age=31536000, immutable",
  );
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

it("reports recent daemon heartbeats and records scheduler ticks", async () => {
  const { req } = setup();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T00:00:00Z"));
  const stopped = daemon(f.repo, 60);
  expect(f.repo.getSetting("last_tick_at")).toBe("2026-10-18T00:00:00.000Z");
  await vi.advanceTimersByTimeAsync(60000);
  expect(f.repo.getSetting("last_tick_at")).toBe("2026-10-18T00:01:00.000Z");
  process.emit("SIGTERM");
  await stopped;
  for (const [seconds, running] of [
    [0, true],
    [180, true],
    [181, false],
  ] as const) {
    vi.setSystemTime(
      new Date(Date.parse("2026-10-18T00:01:00Z") + seconds * 1000),
    );
    expect(await (await req("/api/status")).json()).toMatchObject({
      daemon: { running, last_tick_age_s: seconds },
    });
  }
});
it("exposes worker identity on runs, task detail and task list", async () => {
  const { req } = setup("sleep 30");
  const t = f.task();
  await req(`/api/tasks/${t.id}/run`, "POST", {});
  const run = f.repo.runs()[0];
  const runs = await (await req(`/api/runs?task=${t.identifier}`)).json();
  expect(runs[0]).toMatchObject({
    worker_kind: "fake",
    worker_label: expect.any(String),
  });
  const detail = await (await req(`/api/tasks/${t.id}`)).json();
  expect(detail.latest_worker).toMatchObject({ kind: "fake" });
  const list = await (await req("/api/tasks")).json();
  expect(list[0].latest_worker).toMatchObject({ run_id: run.id });
  await req(`/api/tasks/${t.id}/cancel`, "POST");
});
it("keeps list payloads slim and reconciles running runs with live pids", async () => {
  const { req } = setup();
  const big = "x".repeat(5000);
  const ids: number[] = [];
  for (let i = 0; i < 150; i++)
    ids.push(
      f.task({ title: `Task ${i}`, description: big, feedback: big }).id,
    );
  const insert = f.repo.db.prepare(
    "INSERT INTO runs(task_id,worker,pid,status,started_at,log_path,last_message_path,summary) VALUES(?,?,?,?,?,?,?,?)",
  );
  for (let i = 0; i < 1000; i++)
    insert.run(
      ids[i % 150],
      "codex",
      null,
      "succeeded",
      new Date(1e12 + i * 1000).toISOString(),
      "/nope/log",
      "/nope/last.md",
      big,
    );
  const sleeper = spawn("sleep", ["30"]);
  insert.run(
    ids[0],
    "codex",
    sleeper.pid!,
    "running",
    new Date().toISOString(),
    "/l",
    "/m",
    "",
  );
  insert.run(
    ids[1],
    "codex",
    2147483646,
    "running",
    new Date().toISOString(),
    "/l",
    "/m",
    "",
  );
  const tasksRes = await req("/api/tasks");
  const tasksText = await tasksRes.text();
  expect(tasksText.length).toBeLessThan(200_000);
  const tasks = JSON.parse(tasksText);
  expect(tasks).toHaveLength(150);
  expect(tasks[0].description.length).toBeLessThanOrEqual(301);
  expect(
    tasks.find((t: { id: number }) => t.id === ids[0]).last_run,
  ).toMatchObject({
    status: "running",
    live: true,
  });
  const runsText = await (await req("/api/runs")).text();
  expect(runsText.length).toBeLessThan(200_000);
  const runs = JSON.parse(runsText);
  expect(runs.length).toBe(100);
  expect(
    runs.filter(
      (r: { live: boolean; status: string }) =>
        r.status === "running" && r.live,
    ),
  ).toHaveLength(1);
  expect(
    JSON.parse(await (await req("/api/runs?limit=5&status=succeeded")).text()),
  ).toHaveLength(5);
  expect((await (await req("/api/status")).json()).running_runs).toBe(1);
  const full = await (
    await req(`/api/runs/${runs[runs.length - 1].id}`)
  ).json();
  expect(full.summary.length).toBe(5000);
  expect(
    (await (await req(`/api/tasks/${ids[2]}`)).json()).description,
  ).toHaveLength(5000);
  const projects = await (await req("/api/projects")).json();
  expect(projects[0].running).toBe(1);
  expect(projects[0].counts.ready).toBe(150);
  sleeper.kill();
});
