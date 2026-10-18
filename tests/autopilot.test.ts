import { afterEach, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fixture } from "./helpers.js";
import { Repo } from "../src/db/index.js";
import {
  autopilotStatus,
  collectAutopilot,
  promoteIdle,
  startAutopilot,
  validatePlan,
} from "../src/core/autopilot.js";
import { createApp } from "../src/server.js";
import { keepAwake } from "../src/core/keep-awake.js";
let f: ReturnType<typeof fixture>;
afterEach(() => {
  f?.cleanup();
  delete process.env.AAM_FAKE_CLAUDE;
});
function pending(kind: string, task: number | null, result: unknown) {
  const r = f.repo.db
    .prepare(
      "INSERT INTO autopilot_jobs(kind,project_id,task_id,started_at) VALUES (?,1,?,?)",
    )
    .run(kind, task, new Date().toISOString());
  const dir = resolve(f.repo.home, "autopilot", String(r.lastInsertRowid));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "result.json"),
    JSON.stringify({ status: 0, stdout: JSON.stringify(result) }),
  );
}
const planned = () => ({
  tasks: Array.from({ length: 3 }, (_, i) => ({
    title: `Task ${i}`,
    description: "Acceptance: test passes; add regression test",
    priority: "P2",
    role: "backend",
    depends_on: i ? [i - 1] : [],
  })),
});
it("migrates project opt-ins idempotently and validates updates/budgets", () => {
  f = fixture();
  expect(f.repo.project("T")).toMatchObject({
    auto_review: 0,
    autopilot: 0,
    goal: "",
    autopilot_rank: 100,
    context_file: null,
  });
  const other = new Repo(f.repo.home);
  other.close();
  expect(() => f.repo.updateProject("T", { auto_review: "1" })).toThrow();
  expect(() => f.repo.setSetting("planner_daily_max", "-1")).toThrow();
  f.repo.updateProject("T", { auto_review: 1, autopilot: true, goal: "tests" });
  expect(f.repo.project("T").autopilot).toBe(1);
});
it("never reviews or promotes non-opted-in projects even with legacy global mode", () => {
  f = fixture();
  f.repo.setSetting("review_mode", "claude");
  const t = f.task({ status: "in_review" });
  f.task({ status: "backlog" });
  startAutopilot(f.repo);
  expect(promoteIdle(f.repo)).toBe(0);
  expect(autopilotStatus(f.repo).auto_reviews_today).toBe(0);
  pending("review", t.id, { verdict: "approve", notes: "ok" });
  collectAutopilot(f.repo);
  expect(f.repo.task(t.id).status).toBe("in_review");
});
it.each(["approve", "reject"])(
  "applies async %s and blocks after two consecutive rejects",
  (verdict) => {
    f = fixture();
    f.repo.updateProject("T", { auto_review: 1 });
    const t = f.task({ status: "in_review" });
    pending("review", t.id, { verdict, notes: "review notes" });
    collectAutopilot(f.repo);
    expect(f.repo.task(t.id).status).toBe(
      verdict === "approve" ? "done" : "ready",
    );
    if (verdict === "reject") {
      f.repo.updateTask(t.id, { status: "in_review" });
      pending("review", t.id, { verdict, notes: "again" });
      collectAutopilot(f.repo);
      expect(f.repo.task(t.id)).toMatchObject({
        status: "blocked",
        attempts: 2,
        blocker: "auto-review rejected twice: again",
      });
    }
  },
);
it("rejects failed/missing tests without calling Claude and respects review budget", () => {
  f = fixture();
  f.repo.updateProject("T", { auto_review: 1, test_cmd: "exit 1" });
  const t = f.task({ status: "in_review" });
  startAutopilot(f.repo);
  expect(f.repo.task(t.id)).toMatchObject({ status: "ready", attempts: 1 });
  f.repo.setSetting("auto_review_daily_max", "0");
  f.repo.updateTask(t.id, { status: "in_review" });
  f.repo.db
    .prepare("UPDATE autopilot_jobs SET started_at=?")
    .run(new Date(Date.now() - 120000).toISOString());
  startAutopilot(f.repo);
  startAutopilot(f.repo);
  expect(f.repo.task(t.id).status).toBe("in_review");
  expect(
    f.repo.db
      .prepare("SELECT * FROM events WHERE kind='auto_review_budget'")
      .all(),
  ).toHaveLength(1);
});
it("leaves malformed reviews pending after one retry", () => {
  f = fixture();
  f.repo.updateProject("T", { auto_review: 1 });
  const t = f.task({ status: "in_review" });
  pending("review", t.id, { wrong: true });
  collectAutopilot(f.repo);
  pending("review", t.id, { wrong: true });
  collectAutopilot(f.repo);
  f.repo.db
    .prepare("UPDATE autopilot_jobs SET started_at=?")
    .run(new Date(Date.now() - 120000).toISOString());
  // Preserve the task's review epoch while making the launch throttle expire.
  f.repo.db
    .prepare("UPDATE tasks SET updated_at=? WHERE id=?")
    .run(new Date(Date.now() - 180000).toISOString(), t.id);
  startAutopilot(f.repo);
  expect(f.repo.db.prepare("SELECT * FROM autopilot_jobs").all()).toHaveLength(
    2,
  );
  expect(f.repo.task(t.id).status).toBe("in_review");
});
it("promotes by rank, rotates projects, caps at free slots and respects dependencies", () => {
  f = fixture();
  f.repo.updateProject("T", { autopilot: 1, autopilot_rank: 10 });
  f.repo.addProject({ key: "U", name: "U", repo_path: f.path });
  f.repo.updateProject("U", { autopilot: 1, autopilot_rank: 10 });
  const blocked = f.task({ status: "blocked" });
  f.task({
    status: "backlog",
    depends_on: [blocked.identifier],
    priority: "P0",
  });
  const first = f.task({ status: "backlog", priority: "P2" });
  f.task({ status: "backlog", priority: "P3" });
  const second = f.repo.addTask({
    project: "U",
    title: "U",
    status: "backlog",
  });
  expect(promoteIdle(f.repo)).toBe(2);
  expect(f.repo.tasks({ status: "ready" }).map((t) => t.id)).toEqual(
    expect.arrayContaining([first.id, second.id]),
  );
  expect(promoteIdle(f.repo)).toBe(0);
  expect(autopilotStatus(f.repo).promotions_today).toBe(2);
});
it("validates planner JSON, sizes, types and dependency cycles", () => {
  expect(validatePlan(JSON.stringify(planned()))).toHaveLength(3);
  expect(() => validatePlan("bad")).toThrow();
  const p = planned();
  p.tasks.push(...p.tasks);
  expect(() => validatePlan(JSON.stringify(p))).toThrow();
  const cycle = planned();
  cycle.tasks[0]!.depends_on = [2];
  expect(() => validatePlan(JSON.stringify(cycle))).toThrow("cycle");
  const bad = planned();
  bad.tasks[0]!.depends_on = [8];
  expect(() => validatePlan(JSON.stringify(bad))).toThrow();
});
it("creates planner tasks atomically with shared context and translated dependencies", () => {
  f = fixture();
  writeFileSync(resolve(f.path, "context.md"), "Shared rules");
  f.repo.updateProject("T", {
    autopilot: 1,
    goal: "Improve tests",
    context_file: "context.md",
  });
  pending("plan", null, planned());
  collectAutopilot(f.repo);
  const ts = f.repo.tasks();
  expect(ts).toHaveLength(3);
  expect(ts[0]!.description).toContain("Shared rules\n\n");
  expect(JSON.parse(ts[1]!.depends_on)).toEqual([ts[0]!.identifier]);
  expect(promoteIdle(f.repo)).toBe(1);
});
it("backs off failed plans, enforces planner budget and reports status", async () => {
  f = fixture();
  f.repo.updateProject("T", { autopilot: 1, goal: "Test" });
  pending("plan", null, { tasks: [] });
  collectAutopilot(f.repo);
  startAutopilot(f.repo);
  expect(f.repo.db.prepare("SELECT * FROM autopilot_jobs").all()).toHaveLength(
    1,
  );
  f.repo.setSetting("planner_daily_max", "0");
  f.repo.db
    .prepare("UPDATE autopilot_jobs SET started_at=?,finished_at=?")
    .run(
      new Date(Date.now() - 3600000).toISOString(),
      new Date(Date.now() - 3600000).toISOString(),
    );
  startAutopilot(f.repo);
  expect(f.repo.tasks()).toHaveLength(0);
  const response = await createApp(f.repo).request("/api/status");
  expect((await response.json()).autopilot).toMatchObject({
    planner_max: 0,
    caffeinate: false,
    promotions_today: 0,
  });
});
it("runs fake Claude via stdin asynchronously and limits launches", async () => {
  f = fixture();
  f.repo.updateProject("T", { auto_review: 1 });
  const fake = resolve(f.root, "claude.sh");
  writeFileSync(
    fake,
    '#!/bin/sh\ncat > /dev/null\nprintf \'{"verdict":"approve","notes":"ok"}\'\n',
    { mode: 0o755 },
  );
  process.env.AAM_FAKE_CLAUDE = fake;
  const t = f.task({
    status: "in_review",
    worktree_path: f.path,
    branch: "main",
  });
  f.task({ status: "in_review", worktree_path: f.path, branch: "main" });
  startAutopilot(f.repo);
  startAutopilot(f.repo);
  expect(autopilotStatus(f.repo).auto_reviews_today).toBe(1);
  for (let i = 0; i < 100 && f.repo.task(t.id).status === "in_review"; i++) {
    await new Promise((r) => setTimeout(r, 20));
    collectAutopilot(f.repo);
  }
  expect(f.repo.task(t.id).status).toBe("done");
});
it("starts caffeinate once, restarts after death and stops when disabled", () => {
  f = fixture();
  const kill = vi.fn(),
    spawn = vi.fn(() => ({ pid: 123, on: vi.fn(), kill }));
  let living = true;
  const awake = keepAwake(f.repo, {
    exists: () => true,
    spawn: spawn as never,
    alive: () => living,
  });
  awake.check();
  awake.check();
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(spawn.mock.calls[0]).toEqual([
    "/usr/bin/caffeinate",
    ["-i", "-m", "-w", String(process.pid)],
    expect.anything(),
  ]);
  living = false;
  awake.check();
  expect(spawn).toHaveBeenCalledTimes(2);
  f.repo.setSetting("keep_awake", "0");
  awake.check();
  expect(kill).toHaveBeenCalled();
  expect(f.repo.getSetting("keep_awake_pid")).toBe("");
});

it("patches opt-in fields through API without enabling other projects", async () => {
  f = fixture();
  f.repo.addProject({ key: "U", name: "Other", repo_path: f.path });
  const app = createApp(f.repo);
  const send = (body: unknown) =>
    app.request("/api/projects/T", {
      method: "PATCH",
      headers: { "X-AAM": "1", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  expect(
    (
      await send({
        auto_review: true,
        autopilot: 1,
        goal: "Improve tests",
        autopilot_rank: 5,
        context_file: "context.md",
      })
    ).status,
  ).toBe(200);
  expect(f.repo.project("T")).toMatchObject({
    auto_review: 1,
    autopilot: 1,
    goal: "Improve tests",
    autopilot_rank: 5,
  });
  expect(f.repo.project("U")).toMatchObject({ auto_review: 0, autopilot: 0 });
  expect((await send({ autopilot: "on" })).status).toBe(400);
  expect((await send({ autopilot_rank: 1.5 })).status).toBe(400);
});

it("cancels pending planning results after opting out", () => {
  f = fixture();
  f.repo.updateProject("T", { autopilot: 1, goal: "Tests" });
  pending("plan", null, planned());
  f.repo.updateProject("T", { autopilot: 0 });
  collectAutopilot(f.repo);
  expect(f.repo.tasks()).toHaveLength(0);
});
