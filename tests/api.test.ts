import { it, expect, afterEach } from "vitest";
import { createApp } from "../src/server.js";
import { fixture } from "./helpers.js";
let f: ReturnType<typeof fixture>;
afterEach(() => f?.cleanup());
it("serves task, routine, event and settings operations with validation", async () => {
  f = fixture();
  const app = createApp(f.repo);
  const req = (path: string, method = "GET", body?: unknown) =>
    app.request(`/api/${path}`, {
      method,
      headers: { "Content-Type": "application/json", "X-AAM": "1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  expect(await (await req("projects")).json()).toHaveLength(1);
  const created = await req("tasks", "POST", { project: "T", title: "API" });
  expect(created.status).toBe(201);
  const task = await created.json();
  expect((await req(`tasks/${task.identifier}`)).status).toBe(200);
  expect(
    (
      await req(`tasks/${task.identifier}`, "PATCH", {
        status: "ready",
        priority: "P0",
        sort: 5,
      })
    ).status,
  ).toBe(200);
  expect(await (await req("tasks?status=ready&project=T")).json()).toHaveLength(
    1,
  );
  expect(
    (await req(`tasks/${task.identifier}`, "PATCH", { status: "invalid" }))
      .status,
  ).toBe(400);
  expect((await req("tasks/missing")).status).toBe(404);
  expect((await req("settings", "PUT", { max_parallel: 4 })).status).toBe(200);
  expect((await req("settings", "PUT", { max_parallel: 0 })).status).toBe(400);
  expect(await (await req("settings")).json()).toMatchObject({
    max_parallel: "4",
  });
  expect(
    (
      await req("routines", "POST", {
        name: "heartbeat",
        cron: "*/5 * * * *",
        action: "heartbeat",
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await req("routines", "POST", {
        name: "usage",
        cron: "0 * * * *",
        action: "collect_usage",
        payload: { provider: "fake" },
      })
    ).status,
  ).toBe(201);
  expect(f.repo.routines().find((routine) => routine.name === "usage")).toMatchObject({action:"collect_usage"});
  const routines = await (await req("routines")).json();
  expect(
    (await req("routines", "PATCH", { id: routines[0].id, enabled: false }))
      .status,
  ).toBe(200);
  expect(
    (await req(`routines/${routines[0].id}`, "PATCH", { enabled: true }))
      .status,
  ).toBe(200);
  expect(
    (
      await req("routines", "POST", {
        name: "bad",
        cron: "bad",
        action: "heartbeat",
      })
    ).status,
  ).toBe(400);
  expect((await req("events?limit=-1")).status).toBe(400);
  expect((await req("runs/999/log")).status).toBe(404);
  expect(await (await req("events")).json()).toHaveLength(7);
  f.repo.updateTask(task.identifier, { status: "backlog" });
  expect(await (await req("tick", "POST")).json()).toEqual({ ran: true });
});
it("records events for successful HTTP edits and skips rejected mutations", async () => {
  f = fixture();
  const app = createApp(f.repo);
  const req = (path: string, method: string, body?: unknown) =>
    app.request(`/api/${path}`, {
      method,
      headers: { "X-AAM": "1", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  await req("tasks", "POST", { project: "T", title: "Event task" });
  const task = f.repo.tasks()[0];
  expect(f.repo.events(1, task.id)[0]).toMatchObject({
    kind: "create",
    message: expect.stringContaining("title"),
  });
  await req(`tasks/${task.id}`, "PATCH", { title: "Edited" });
  expect(f.repo.events(1, task.id)[0]).toMatchObject({
    kind: "edit",
    message: expect.stringContaining("title"),
  });
  await req(`tasks/${task.id}`, "PATCH", { status: "ready", priority: "P0" });
  expect(f.repo.events(1, task.id)[0]).toMatchObject({
    kind: "move",
    message: expect.stringContaining("status backlog -> ready via UI"),
  });
  const before = f.repo.events().length;
  expect(
    (await req(`tasks/${task.id}`, "PATCH", { status: "bad" })).status,
  ).toBe(400);
  expect(f.repo.events()).toHaveLength(before);
  await req("settings", "PUT", { max_parallel: 3 });
  expect(f.repo.events(1)[0]).toMatchObject({
    kind: "settings",
    message: expect.stringContaining("max_parallel"),
  });
  await req("projects/T", "PATCH", { name: "Updated" });
  expect(f.repo.events(1)[0]).toMatchObject({
    kind: "settings",
    message: expect.stringContaining("name"),
  });
  await req("projects", "POST", {
    key: "NEW",
    name: "New project",
    repo_path: f.path,
  });
  expect(f.repo.events(1)[0]).toMatchObject({
    kind: "settings",
    message: expect.stringContaining("repo_path"),
  });
  await req("routines", "POST", {
    name: "event routine",
    cron: "*/5 * * * *",
    action: "heartbeat",
  });
  expect(f.repo.events(1)[0]).toMatchObject({
    kind: "routine",
    message: expect.stringContaining("cron"),
  });
  const routine = f.repo.routines()[0];
  await req(`routines/${routine.id}`, "PATCH", { enabled: false });
  expect(f.repo.events(1)[0]).toMatchObject({
    kind: "routine",
    message: expect.stringContaining("enabled"),
  });
  await req(`routines/${routine.id}`, "DELETE");
  expect(f.repo.events(1)[0]).toMatchObject({
    kind: "routine",
    message: expect.stringContaining("Deleted"),
  });
});

it("waits for collect-usage run-now persistence before responding", async () => {
  f = fixture();
  f.repo.addRoutine("usage-now", "0 * * * *", "collect_usage", {provider:"fake"});
  const routine = f.repo.routines()[0];
  const response = await createApp(f.repo).request(`/api/routines/${routine.id}/run`, {
    method:"POST",
    headers:{"X-AAM":"1"},
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({id:routine.id,last_run_at:expect.any(String)});
  expect(f.repo.usageSnapshots()).toHaveLength(2);
  expect(f.repo.events()).toEqual(expect.arrayContaining([
    expect.objectContaining({kind:"usage_collected"}),
    expect.objectContaining({kind:"routine",message:expect.stringContaining("collected 2 snapshots")}),
  ]));
});
it("paginates and filters activity without losing older matching events", async () => {
  f = fixture();
  const a = f.task(),
    b = f.task();
  f.repo.event("edit", "first", a.id);
  f.repo.event("move", "second", b.id);
  f.repo.event("edit", "third", a.id);
  const app = createApp(f.repo);
  const events = async (query: string) =>
    (await app.request(`/api/events?${query}`)).json();
  const first = await events("limit=2");
  expect(first.map((e: { message: string }) => e.message)).toEqual([
    "third",
    "second",
  ]);
  expect(
    (await events(`limit=2&before=${first[1].id}`)).map(
      (e: { message: string }) => e.message,
    ),
  ).toEqual(["first"]);
  expect(await events(`kind=edit&task=${a.identifier}&project=T`)).toHaveLength(
    2,
  );
  expect(await events("project=missing")).toEqual([]);
  expect((await app.request("/api/events?before=bad")).status).toBe(400);
});

it("retries with preserved feedback, validated attempts, and running-worker protection", async () => {
  f = fixture();
  const t = f.task({
    status: "blocked",
    attempts: 3,
    feedback: "[P2] Fix data loss",
    blocker: "exhausted",
  });
  const app = createApp(f.repo);
  const retry = (body?: unknown, id = t.identifier) =>
    app.request(`/api/tasks/${id}/retry`, {
      method: "POST",
      headers: { "X-AAM": "1", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  expect(await (await retry()).json()).toMatchObject({
    status: "ready",
    attempts: 2,
    blocker: "",
    feedback: t.feedback,
  });
  expect(await (await retry({ attempts: 0 })).json()).toMatchObject({
    attempts: 0,
    feedback: t.feedback,
  });
  for (const attempts of [-1, 1.5, "1", null])
    expect((await retry({ attempts })).status).toBe(400);
  expect((await retry({}, "missing")).status).toBe(404);
  f.repo.updateTask(t.id, { max_attempts: 1 });
  expect(await (await retry({})).json()).toMatchObject({ attempts: 0 });
  f.repo.db
    .prepare(
      "INSERT INTO runs(task_id,worker,status,started_at,log_path,last_message_path) VALUES (?,'codex','running',?,'','')",
    )
    .run(t.id, new Date().toISOString());
  expect((await retry()).status).toBe(400);
  expect(f.repo.task(t.id).attempts).toBe(0);
});
it("exposes executor settings, validates them and reports the effective executor", async () => {
  f = fixture();
  const app = createApp(f.repo);
  const req = (path: string, method = "GET", body?: unknown) =>
    app.request(`/api/${path}`, {
      method,
      headers: { "Content-Type": "application/json", "X-AAM": "1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const t = f.task();
  const put = await req("executors", "PUT", {
    coding_executor: "claude",
    worker_effort: "medium",
  });
  expect(put.status).toBe(200);
  const view = await put.json();
  expect(view.coding_executor).toBe("claude");
  expect(view.worker_effort).toBe("medium");
  expect(view.executors.map((e: { id: string }) => e.id)).toContain("hermes");
  expect((await req("executors", "PUT", { coding_executor: "x" })).status).toBe(400);
  expect((await req("executors", "PUT", { worker_effort: "max" })).status).toBe(400);
  expect((await (await req("executors")).json()).worker_effort).toBe("medium");
  expect((await req("executors", "PUT", { reviewer: "codex" })).status).toBe(400);
  await req("projects/T", "PATCH", { coding_executor: "pi" });
  expect((await (await req(`tasks/${t.identifier}`)).json()).effective_executor).toEqual({ value: "pi", source: "project" });
  await req(`tasks/${t.identifier}`, "PATCH", { executor: "codex" });
  const list = await (await req("tasks")).json();
  expect(list[0].effective_executor).toEqual({ value: "codex", source: "task" });
});
