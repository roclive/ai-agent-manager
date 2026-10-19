import { afterEach, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fixture } from "./helpers.js";
import { Repo } from "../src/db/index.js";
import {
  reviewPrompt,
  autopilotStatus,
  cleanEnv,
  collectAutopilot,
  promoteIdle,
  startAutopilot,
  validatePlan,
} from "../src/core/autopilot.js";
import { git } from "../src/core/process.js";
import { createApp } from "../src/server.js";
import { keepAwake } from "../src/core/keep-awake.js";
import { activeReservation, providerCooldown } from "../src/core/providers.js";
let f: ReturnType<typeof fixture>;
afterEach(() => {
  f?.cleanup();
  delete process.env.AAM_FAKE_CLAUDE;
  delete process.env.AAM_FAKE_CODEX;
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
  f.repo.setSetting("claude_ok", "1");
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
  f.repo.setSetting("claude_ok", "1");
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
  "applies async %s and blocks only when attempts are exhausted",
  (verdict) => {
    f = fixture();
    f.repo.setSetting("claude_ok", "1");
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
        status: "ready",
        attempts: 2,
        feedback: "again",
        blocker: "",
      });
      f.repo.updateTask(t.id, { status: "in_review" });
      pending("review", t.id, { verdict, notes: "final finding" });
      collectAutopilot(f.repo);
      expect(f.repo.task(t.id)).toMatchObject({
        status: "blocked",
        attempts: 3,
        feedback: "final finding",
        blocker: "auto-review rejected 3 times: final finding",
      });
    }
  },
);
it("rejects failed/missing tests without calling Claude and respects review budget", () => {
  f = fixture();
  f.repo.setSetting("claude_ok", "1");
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
  f.repo.setSetting("claude_ok", "1");
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
  f.repo.setSetting("claude_ok", "1");
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
  f.repo.setSetting("claude_ok", "1");
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
  f.repo.setSetting("claude_ok", "1");
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
  f.repo.setSetting("claude_ok", "1");
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
  expect(autopilotStatus(f.repo).auto_reviews_today).toBe(2);
  for (let i = 0; i < 100 && f.repo.task(t.id).status === "in_review"; i++) {
    await new Promise((r) => setTimeout(r, 20));
    collectAutopilot(f.repo);
  }
  expect(f.repo.task(t.id).status).toBe("done");
});

it("reserves advanced-judgment capacity and scopes its 429 breaker to the selected provider", () => {
  f = fixture();
  f.repo.setSetting("claude_ok", "1");
  f.repo.setSetting(
    "provider_policy",
    JSON.stringify({
      version: 1,
      providers: [
        {
          id: "claude",
          worker: "claude",
          class: "premium",
          legal: true,
          roles: ["any"],
          max_complexity: "high",
          reserve_remaining: 0,
          reservation: { low: 1, medium: 1, high: 1 },
        },
        {
          id: "codex",
          worker: "codex",
          class: "premium",
          legal: true,
          roles: ["any"],
          max_complexity: "high",
          reserve_remaining: 0,
          reservation: { low: 1, medium: 1, high: 1 },
        },
      ],
    }),
  );
  f.repo.setSetting(
    "cooldown_until",
    new Date(Date.now() + 60_000).toISOString(),
  );
  f.repo.updateProject("T", { auto_review: 1 });
  const task = f.task({
    status: "in_review",
    worktree_path: f.path,
    branch: "main",
  });
  const fake = resolve(f.root, "slow-reviewer.sh");
  writeFileSync(fake, "#!/bin/sh\ncat >/dev/null\nsleep 2\n", { mode: 0o755 });
  process.env.AAM_FAKE_CLAUDE = fake;
  startAutopilot(f.repo);
  const job = f.repo.db
    .prepare("SELECT * FROM autopilot_jobs WHERE task_id=?")
    .get(task.id) as {
    id: number;
    provider: string;
    reservation_amount: number;
  };
  expect(job).toMatchObject({ provider: "claude", reservation_amount: 1 });
  expect(activeReservation(f.repo, "claude")).toBe(1);
  const dir = resolve(f.repo.home, "autopilot", String(job.id));
  writeFileSync(
    resolve(dir, "result.json"),
    JSON.stringify({ status: 1, stderr: "Error: 429 rate limit exceeded" }),
  );
  collectAutopilot(f.repo);
  expect(activeReservation(f.repo, "claude")).toBe(0);
  expect(providerCooldown(f.repo, "claude")).not.toBeNull();
  expect(providerCooldown(f.repo, "codex")).toBeNull();
  expect(f.repo.getSetting("cooldown_until")).not.toBe("");
});
it("starts caffeinate once, restarts after death and stops when disabled", () => {
  f = fixture();
  f.repo.setSetting("claude_ok", "1");
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
  f.repo.setSetting("claude_ok", "1");
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
  f.repo.setSetting("claude_ok", "1");
  f.repo.updateProject("T", { autopilot: 1, goal: "Tests" });
  pending("plan", null, planned());
  f.repo.updateProject("T", { autopilot: 0 });
  collectAutopilot(f.repo);
  expect(f.repo.tasks()).toHaveLength(0);
});

it("gives Claude the minimal env incl. USER/LOGNAME (keychain login fails without them)", () => {
  const env = cleanEnv();
  expect(Object.keys(env).sort()).toEqual(["HOME", "LOGNAME", "PATH", "USER"]);
  expect(env.USER).not.toBe("");
  expect(env.LOGNAME).not.toBe("");
});

it("fills concurrent review slots in order, excludes pending tasks and obeys budget/health", async () => {
  f = fixture();
  f.repo.updateProject("T", { auto_review: 1 });
  const tasks = Array.from({ length: 5 }, (_, i) =>
    f.task({
      title: String(i),
      status: "in_review",
      worktree_path: f.path,
      branch: "main",
    }),
  );
  tasks.forEach((t, i) =>
    f.repo.db
      .prepare("UPDATE tasks SET updated_at=? WHERE id=?")
      .run(new Date(Date.now() - (5 - i) * 1000).toISOString(), t.id),
  );
  expect(f.repo.getSetting("auto_review_concurrency")).toBe("3");
  for (const v of ["0", "6", "1.5"])
    expect(() => f.repo.setSetting("auto_review_concurrency", v)).toThrow();
  startAutopilot(f.repo);
  expect(autopilotStatus(f.repo).auto_reviews_today).toBe(0);
  f.repo.setSetting("claude_ok", "1");
  startAutopilot(f.repo);
  startAutopilot(f.repo);
  const rows = f.repo.db
    .prepare("SELECT task_id FROM autopilot_jobs ORDER BY id")
    .all();
  expect(rows).toEqual(tasks.slice(0, 3).map((t) => ({ task_id: t.id })));
  f.repo.setSetting("auto_review_concurrency", "5");
  f.repo.setSetting("auto_review_daily_max", "4");
  startAutopilot(f.repo);
  expect(autopilotStatus(f.repo)).toMatchObject({
    auto_reviews_today: 4,
    waiting_for_review: 5,
    auto_review_concurrency: 5,
  });
  // Let detached fake launchers finish before removing their temporary directory.
  await new Promise((r) => setTimeout(r, 300));
});

it("expires missing results, retries after 20 seconds and pauses only a task after three timeouts", () => {
  f = fixture();
  f.repo.setSetting("claude_ok", "1");
  f.repo.updateProject("T", { auto_review: 1 });
  const t = f.task({ status: "in_review" });
  const insert = () =>
    f.repo.db
      .prepare(
        "INSERT INTO autopilot_jobs(kind,project_id,task_id,started_at) VALUES ('review',1,?,?)",
      )
      .run(t.id, new Date(Date.now() - 361000).toISOString());
  insert();
  collectAutopilot(f.repo);
  expect(
    f.repo.db.prepare("SELECT status,notes FROM autopilot_jobs").get(),
  ).toMatchObject({
    status: "timeout",
    notes: expect.stringContaining("ETIMEDOUT"),
  });
  startAutopilot(f.repo);
  expect(autopilotStatus(f.repo).auto_reviews_today).toBe(1);
  f.repo.db
    .prepare("UPDATE autopilot_jobs SET finished_at=?")
    .run(new Date(Date.now() - 21000).toISOString());
  startAutopilot(f.repo); // Eligible, but no worktree: prompt error, no real Claude.
  expect(autopilotStatus(f.repo).auto_reviews_today).toBe(2);
  f.repo.db.prepare("DELETE FROM autopilot_jobs WHERE status='error'").run();
  insert();
  collectAutopilot(f.repo);
  insert();
  collectAutopilot(f.repo);
  expect(
    (f.repo.events(20) as { kind: string; message: string }[]).some(
      (e) => e.kind === "review_error" && e.message.includes("30 minutes"),
    ),
  ).toBe(true);
  f.repo.db
    .prepare("UPDATE autopilot_jobs SET finished_at=?")
    .run(new Date(Date.now() - 61000).toISOString());
  startAutopilot(f.repo);
  expect(autopilotStatus(f.repo).auto_reviews_today).toBe(3);
  const other = f.task({ status: "in_review" });
  startAutopilot(f.repo);
  expect(
    f.repo.db
      .prepare("SELECT task_id FROM autopilot_jobs ORDER BY id DESC LIMIT 1")
      .get(),
  ).toEqual({ task_id: other.id });
  f.repo.db
    .prepare("UPDATE autopilot_jobs SET finished_at=? WHERE task_id=?")
    .run(new Date(Date.now() - 1801000).toISOString(), t.id);
  startAutopilot(f.repo);
  expect(
    f.repo.db
      .prepare("SELECT task_id FROM autopilot_jobs ORDER BY id DESC LIMIT 1")
      .get(),
  ).toEqual({ task_id: t.id });
});

it("reports review bottlenecks only when promotion leaves capacity, throttled for 15 minutes", () => {
  f = fixture();
  const review = f.task({ status: "in_review" });
  f.repo.updateProject("T", { autopilot: 1 });
  f.task({ status: "backlog", depends_on: [review.identifier] });
  promoteIdle(f.repo);
  promoteIdle(f.repo);
  const events = () =>
    (f.repo.events(20) as { kind: string; message: string }[]).filter(
      (e) => e.kind === "review_bottleneck",
    );
  expect(events()).toHaveLength(1);
  expect(JSON.parse(events()[0]!.message)).toMatchObject({
    free_slots: 2,
    waiting_for_review: 1,
    promoted: 0,
  });
  f.repo.db
    .prepare("UPDATE events SET ts=? WHERE kind='review_bottleneck'")
    .run(new Date(Date.now() - 901000).toISOString());
  promoteIdle(f.repo);
  expect(events()).toHaveLength(2);
  f.task({ status: "backlog" });
  f.task({ status: "backlog" });
  f.repo.db
    .prepare("UPDATE events SET ts=? WHERE kind='review_bottleneck'")
    .run(new Date(Date.now() - 901000).toISOString());
  expect(promoteIdle(f.repo)).toBe(2);
  expect(events()).toHaveLength(2);
});

it("lists every changed file and omits large file contents on both sides of the diff", () => {
  f = fixture();
  writeFileSync(
    resolve(f.path, "large.json"),
    "SENSITIVE_LARGE_DATA".repeat(2000),
  );
  git(f.path, ["add", "."]);
  git(f.path, ["commit", "-m", "base data"]);
  git(f.path, ["checkout", "-b", "review"]);
  writeFileSync(resolve(f.path, "large.json"), "small replacement");
  writeFileSync(resolve(f.path, "small.txt"), "review this change");
  git(f.path, ["add", "."]);
  git(f.path, ["commit", "-m", "changes"]);
  const t = f.task({
    status: "in_review",
    branch: "review",
    worktree_path: f.path,
  });
  const prompt = reviewPrompt(f.repo, t.id);
  expect(prompt).toContain("severity [P0], [P1], [P2], or [P3]");
  expect(prompt).toContain("only findings are [P3] nits or style");
  expect(prompt).toContain("Reject for any [P0]/[P1]/[P2]");
  expect(prompt).toContain('"large.json": 40000 bytes (diff omitted)');
  expect(prompt).toContain('"small.txt"');
  expect(prompt).toContain("+review this change");
  expect(prompt).not.toContain("SENSITIVE_LARGE_DATA");
  expect(prompt).not.toContain("+small replacement");
});

it.each([1, 5])(
  "uses configured max_attempts %s and keeps up to 8 KB of notes",
  (max_attempts) => {
    f = fixture();
    f.repo.updateProject("T", { auto_review: 1 });
    const t = f.task({
      status: "in_review",
      max_attempts,
      attempts: max_attempts - 1,
    });
    const notes = "[P2] " + "详细发现".repeat(1500);
    pending("review", t.id, { verdict: "reject", notes });
    collectAutopilot(f.repo);
    const updated = f.repo.task(t.id);
    expect(updated.status).toBe("blocked");
    expect(updated.attempts).toBe(max_attempts);
    expect(Buffer.byteLength(updated.feedback)).toBeLessThanOrEqual(8192);
    expect(notes.startsWith(updated.feedback)).toBe(true);
    expect(updated.feedback.length).toBeGreaterThan(2000);
    expect(updated.blocker).toBe(
      `auto-review rejected ${max_attempts} times: ${updated.feedback}`,
    );
  },
);

it.each(["AAM_OUTPUT_TOO_LARGE", "ENOBUFS"])(
  "stops %s retries without misclassifying quoted quota errors",
  (code) => {
    f = fixture();
    f.repo.setSetting("claude_ok", "1");
    f.repo.updateProject("T", { auto_review: 1 });
    const t = f.task({ status: "in_review" });
    pending("review", t.id, {});
    const job = f.repo.db
      .prepare("SELECT id FROM autopilot_jobs ORDER BY id DESC LIMIT 1")
      .get() as { id: number };
    writeFileSync(
      resolve(f.repo.home, "autopilot", String(job.id), "result.json"),
      JSON.stringify({
        status: -1,
        code,
        output:
          '{"type":"item.completed","item":{"error":"historical rate limit 429"}}',
        stderr: "Final reviewer response exceeds 64 MiB",
      }),
    );
    collectAutopilot(f.repo);
    expect(
      f.repo.db
        .prepare("SELECT status FROM autopilot_jobs WHERE id=?")
        .get(job.id),
    ).toEqual({ status: "output_limit" });
    f.repo.db
      .prepare("UPDATE autopilot_jobs SET finished_at=? WHERE id=?")
      .run(new Date(Date.now() - 120000).toISOString(), job.id);
    startAutopilot(f.repo);
    startAutopilot(f.repo);
    expect(
      f.repo.db.prepare("SELECT count(*) n FROM autopilot_jobs").get(),
    ).toEqual({ n: 1 });
    expect(f.repo.task(t.id).attempts).toBe(0);
    expect(autopilotStatus(f.repo).stalled_reviews).toContain(t.identifier);
    expect(f.repo.getSetting("llm_backend")).toBe("primary");
    expect(
      f.repo.db
        .prepare("SELECT count(*) n FROM events WHERE kind='review_stalled'")
        .get(),
    ).toEqual({ n: 1 });
  },
);
