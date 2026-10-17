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
      headers: { "Content-Type": "application/json" },
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
  expect(await (await req("events")).json()).toEqual([]);
  f.repo.updateTask(task.identifier, { status: "backlog" });
  expect(await (await req("tick", "POST")).json()).toEqual({ ran: true });
});
