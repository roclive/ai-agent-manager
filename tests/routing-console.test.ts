import { afterEach, expect, it } from "vitest";
import { createApp } from "../src/server.js";
import { dispatch } from "../src/core/dispatch.js";
import { selectProvider } from "../src/core/providers.js";
import { fixture, waitExit } from "./helpers.js";

let f: ReturnType<typeof fixture>;
afterEach(() => f?.cleanup());

const provider = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  worker: "opencode",
  class: "free",
  legal: true,
  roles: ["any"],
  max_complexity: "medium",
  reserve_remaining: 0,
  reservation: { low: 1, medium: 1, high: 1 },
  ...patch,
});
function setup() {
  f = fixture();
  f.repo.setSetting(
    "provider_policy",
    JSON.stringify({
      version: 1,
      providers: [provider("free-a"), provider("free-b")],
    }),
  );
  const app = createApp(f.repo, { dist: f.root });
  const req = (path: string, method = "GET", body?: unknown) =>
    app.request(path, {
      method,
      headers: { "Content-Type": "application/json", "X-AAM": "1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return req;
}

it("reports providers with unknown quota and never exposes raw usage data", async () => {
  const req = setup();
  f.repo.addUsageSnapshot({
    provider: "free-a",
    type: "quota",
    window: "day",
    used: "unknown",
    remaining: "unknown",
    reset_at: null,
    source: "fixture",
    freshness: new Date().toISOString(),
    raw_data: JSON.stringify({ token: "sk-secret-value" }),
  });
  const res = await req("/api/routing");
  const text = await res.text();
  expect(text).not.toContain("sk-secret-value");
  const view = JSON.parse(text);
  const a = view.providers.find((p: { id: string }) => p.id === "free-a");
  expect(a).toMatchObject({ free_tier: "free", quota_known: false, paused: false });
  expect(a.quota[0].remaining).toBe("unknown");
});

it("pausing a provider reroutes selection and records the reason and switch", async () => {
  const req = setup();
  const task = f.task();
  expect((await req("/api/routing", "PUT", { paused: ["free-a"] })).status).toBe(200);
  const sel = selectProvider(f.repo, task);
  expect(sel.id).toBe("free-b");
  expect(sel.reason).toContain("free-a: paused by operator");
  const id = dispatch(f.repo, task.identifier);
  await waitExit(f.repo, id);
  const view = await (await req("/api/routing")).json();
  expect(view.history.map((h: { kind: string }) => h.kind)).toContain("route_selected");
  await req("/api/routing", "PUT", { paused: [], allowed: ["free-a"] });
  expect(selectProvider(f.repo, task).id).toBe("free-a");
  await req("/api/routing", "PUT", { allowed: null, paused: ["free-a", "free-b"] });
  expect(() => selectProvider(f.repo, task)).toThrow("No provider available");
});

it("validates routing input", async () => {
  const req = setup();
  for (const body of [
    { paused: ["nope"] },
    { allowed: [] },
    { allowed: ["bad id!"] },
    { reserve_remaining: { "free-a": -1 } },
    { reserve_remaining: { "free-a": "x" } },
    { surprise: true },
  ])
    expect((await req("/api/routing", "PUT", body)).status).toBeGreaterThanOrEqual(400);
  expect(f.repo.getSetting("routing_overrides")).toBe("");
  const ok = await req("/api/routing", "PUT", { reserve_remaining: { "free-a": 5 } });
  expect(ok.status).toBe(200);
  expect((await ok.json()).providers[0].reserve_remaining).toBe(5);
});
