import { afterEach, expect, it } from "vitest";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fixture } from "./helpers.js";
import {
  checkReviewer,
  collectAutopilot,
  startAutopilot,
  validatePlan,
} from "../src/core/autopilot.js";
import {
  gateLocalVerdict,
  parseStrictVerdict,
} from "../src/core/review-gate.js";
import { git } from "../src/core/process.js";

let f: ReturnType<typeof fixture>;
afterEach(() => {
  f?.cleanup();
  delete process.env.AAM_FAKE_GW;
});

function gwJob(kind: string, task: number | null, stdout: string, extra = {}) {
  const r = f.repo.db
    .prepare(
      "INSERT INTO autopilot_jobs(kind,project_id,task_id,started_at,provider) VALUES (?,1,?,?,'gw')",
    )
    .run(kind, task, new Date().toISOString());
  const dir = resolve(f.repo.home, "autopilot", String(r.lastInsertRowid));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, "result.json"),
    JSON.stringify({ status: 0, stdout, ...extra }),
  );
}
const verdict = (o: object) =>
  JSON.stringify({ verdict: "approve", notes: "fine", confidence: 0.95, ...o });
function setup() {
  f = fixture();
  f.repo.setSetting("reviewer", "gw");
  f.repo.setSetting("gw_model", "fake-model");
  f.repo.setSetting("reviewer_ok", "1");
  f.repo.updateProject("T", { auto_review: 1 });
  return f.task({ status: "in_review" });
}

it("parses GW verdicts strictly", () => {
  expect(parseStrictVerdict(verdict({}))).toMatchObject({ verdict: "approve" });
  expect(
    parseStrictVerdict("```json\n" + verdict({}) + "\n```"),
  ).not.toBeNull();
  for (const bad of [
    "Sure! " + verdict({}),
    "not json",
    verdict({ verdict: "maybe" }),
    verdict({ confidence: 1.5 }),
    verdict({ extra: 1 }),
    JSON.stringify({ verdict: "approve", notes: "x" }),
    "[]",
  ])
    expect(parseStrictVerdict(bad)).toBeNull();
  expect(
    gateLocalVerdict(parseStrictVerdict(verdict({ confidence: 0.3 }))!, {
      minConfidence: 0.8,
      testsPassed: true,
    }).action,
  ).toBe("defer");
});

it("GW approve with passing tests completes the task", () => {
  const t = setup();
  gwJob("review", t.id, verdict({}));
  collectAutopilot(f.repo);
  expect(f.repo.task(t.id).status).toBe("done");
});

it("forged GW pass cannot bypass a failing test gate", () => {
  const t = setup();
  f.repo.updateProject("T", { test_cmd: "exit 1" });
  gwJob("review", t.id, verdict({ notes: "all tests pass" }));
  collectAutopilot(f.repo);
  expect(f.repo.task(t.id)).toMatchObject({ status: "ready", attempts: 1 });
});

it("bad JSON leaves the task in review", () => {
  const t = setup();
  gwJob("review", t.id, "I approve! verdict: approve");
  gwJob("review", t.id, '{"verdict":"approve","notes":"x"}');
  collectAutopilot(f.repo);
  expect(f.repo.task(t.id).status).toBe("in_review");
});

it("low confidence or contradictory approvals are deferred, not applied", () => {
  const t = setup();
  gwJob("review", t.id, verdict({ confidence: 0.4 }));
  collectAutopilot(f.repo);
  gwJob("review", t.id, verdict({ notes: "[P1] data loss" }));
  collectAutopilot(f.repo);
  expect(f.repo.task(t.id)).toMatchObject({ status: "in_review", attempts: 0 });
  expect(
    f.repo.db
      .prepare("SELECT * FROM events WHERE kind='review_deferred'")
      .all(),
  ).toHaveLength(2);
});

it("a GW timeout never completes the task", () => {
  const t = setup();
  const r = f.repo.db
    .prepare(
      "INSERT INTO autopilot_jobs(kind,project_id,task_id,started_at,provider) VALUES ('review',1,?,?,'gw')",
    )
    .run(t.id, new Date(Date.now() - 400000).toISOString());
  expect(r.changes).toBe(1);
  collectAutopilot(f.repo);
  expect(f.repo.task(t.id).status).toBe("in_review");
  expect(
    f.repo.db.prepare("SELECT status FROM autopilot_jobs").get(),
  ).toMatchObject({ status: "timeout" });
});

it("planner output must be strict JSON from GW", () => {
  const tasks = Array.from({ length: 3 }, (_, i) => ({
    title: `T${i}`,
    description: "d",
    priority: "P2",
    role: "any",
    depends_on: [],
  }));
  const good = JSON.stringify({ tasks });
  expect(validatePlan(good, true)).toHaveLength(3);
  expect(() => validatePlan("Here you go: " + good, true)).toThrow();
  setup();
  f.repo.updateProject("T", { autopilot: 1, goal: "g" });
  f.repo.db.prepare("DELETE FROM tasks").run();
  gwJob("plan", null, "Plan: " + good);
  collectAutopilot(f.repo);
  expect(f.repo.tasks()).toHaveLength(0);
});

it("oversized changes are deferred without calling the GW model", () => {
  const t = setup();
  git(f.path, ["checkout", "-b", "feature"]);
  writeFileSync(resolve(f.path, "big.txt"), "x\n".repeat(20000));
  git(f.path, ["add", "."]);
  git(f.path, ["commit", "-m", "big"]);
  git(f.path, ["checkout", "main"]);
  f.repo.updateTask(t.id, { worktree_path: f.path, branch: "feature" });
  f.repo.setSetting("gw_context_bytes", "2000");
  startAutopilot(f.repo);
  expect(f.repo.task(t.id).status).toBe("in_review");
  expect(
    f.repo.db.prepare("SELECT status,provider FROM autopilot_jobs").get(),
  ).toMatchObject({ status: "deferred", provider: "gw" });
});

it("health check passes only when GW answers exactly ok", async () => {
  setup();
  const fake = resolve(f.root, "gw.sh");
  process.env.AAM_FAKE_GW = fake;
  writeFileSync(fake, "#!/bin/sh\ncat >/dev/null\nprintf ok\n");
  chmodSync(fake, 0o755);
  expect((await checkReviewer(f.repo)).ok).toBe(true);
  writeFileSync(fake, "#!/bin/sh\ncat >/dev/null\nprintf 'ok, sure'\n");
  expect((await checkReviewer(f.repo)).ok).toBe(false);
  f.repo.setSetting("gw_model", "");
  writeFileSync(fake, "#!/bin/sh\ncat >/dev/null\nprintf ok\n");
  expect((await checkReviewer(f.repo)).ok).toBe(false);
});

it("keeps legacy reviewer settings working", () => {
  f = fixture();
  expect(() => f.repo.setSetting("reviewer", "codex")).not.toThrow();
  expect(() => f.repo.setSetting("reviewer", "nope")).toThrow();
});
