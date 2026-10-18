import { afterEach, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fixture } from "./helpers.js";
import { Repo } from "../src/db/index.js";
import {
  autopilotStatus,
  checkReviewer,
  cleanEnv,
  collectAutopilot,
  reviewerCommand,
  startAutopilot,
  validatePlan,
} from "../src/core/autopilot.js";
import { parseVerdict } from "../src/core/review.js";
let f: ReturnType<typeof fixture>;
afterEach(() => {
  f?.cleanup();
  delete process.env.AAM_FAKE_CODEX;
});
function setup() {
  f = fixture();
  f.repo.setSetting("reviewer", "codex");
  const fake = resolve(f.root, "codex.sh");
  writeFileSync(
    fake,
    `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then shift; out="$1"; fi
  shift
done
cat >/dev/null
printf 'ok' > "$out"
`,
    { mode: 0o755 },
  );
  process.env.AAM_FAKE_CODEX = fake;
  return fake;
}
it("defaults new installations to Codex and preserves configured budgets", () => {
  setup();
  const home = resolve(f.root, "fresh");
  let repo = new Repo(home);
  expect(repo.getSetting("reviewer")).toBe("codex");
  expect(repo.getSetting("auto_review_daily_max")).toBe("120");
  expect(repo.getSetting("planner_daily_max")).toBe("10");
  repo.setSetting("auto_review_daily_max", "80");
  repo.close();
  repo = new Repo(home);
  expect(repo.getSetting("auto_review_daily_max")).toBe("80");
  repo.close();
  expect(() => f.repo.setSetting("reviewer", "other")).toThrow();
});
it("builds read-only Codex argv and minimal environment, retaining Claude", () => {
  setup();
  const command = reviewerCommand(f.repo, f.path, f.root);
  expect(command.args).toEqual([
    "exec",
    "--json",
    "-s",
    "read-only",
    "-C",
    f.path,
    "-c",
    'approval_policy="never"',
    "-c",
    'model_reasoning_effort="medium"',
    "--skip-git-repo-check",
    "-o",
    resolve(f.root, "last.md"),
    "-",
  ]);
  expect(command.cwd).toBe(f.path);
  expect(Object.keys(cleanEnv()).sort()).toEqual(
    [
      "PATH",
      "HOME",
      "USER",
      "LOGNAME",
      ...(process.env.CODEX_HOME ? ["CODEX_HOME"] : []),
    ].sort(),
  );
  expect(command.env.HOME).toBe(process.env.HOME);
  f.repo.setSetting("reviewer", "claude");
  expect(reviewerCommand(f.repo, f.path, f.root)).toMatchObject({
    cmd: process.env.AAM_FAKE_CLAUDE,
    codex: false,
    args: expect.arrayContaining(["-p", "--output-format", "json"]),
  });
});
it("accepts fenced JSON and prose in verdicts and plans", () => {
  expect(
    parseVerdict('Context\n```json\n{"verdict":"approve","notes":"fine"}\n```'),
  ).toMatchObject({ verdict: "approve" });
  const tasks = Array.from({ length: 3 }, (_, i) => ({
    title: `Task ${i}`,
    description: "Test it",
    priority: "P2",
    role: "backend",
    depends_on: [],
  }));
  expect(
    validatePlan(
      `Plan follows:\n\`\`\`json\n${JSON.stringify({ tasks })}\n\`\`\``,
    ),
  ).toEqual(tasks);
});
it("checks Codex last.md, gates jobs and invalidates health on provider switch", async () => {
  setup();
  f.repo.updateProject("T", { auto_review: 1 });
  f.task({ status: "in_review" });
  startAutopilot(f.repo);
  expect(autopilotStatus(f.repo).auto_reviews_today).toBe(0);
  expect(await checkReviewer(f.repo)).toEqual({ ok: true, result: "ok" });
  expect(autopilotStatus(f.repo)).toMatchObject({
    reviewer: "codex",
    reviewer_ok: true,
    claude_ok: true,
  });
  f.repo.setSetting("reviewer", "claude");
  expect(autopilotStatus(f.repo).reviewer_ok).toBe(false);
  expect((await checkReviewer(f.repo)).ok).toBe(true);
});
it("runs detached Codex reviews and reads last.md rather than JSONL stdout", async () => {
  const fake = setup();
  writeFileSync(
    fake,
    readFileSync(fake, "utf8").replace(
      "printf 'ok'",
      `printf 'Context\\n\`\`\`json\\n{"verdict":"approve","notes":"fine"}\\n\`\`\`'`,
    ),
  );
  f.repo.setSetting("reviewer_ok", "1");
  f.repo.updateProject("T", { auto_review: 1 });
  const task = f.task({
    status: "in_review",
    branch: "main",
    worktree_path: f.path,
  });
  startAutopilot(f.repo);
  for (let i = 0; i < 100 && f.repo.task(task.id).status === "in_review"; i++) {
    await new Promise((r) => setTimeout(r, 20));
    collectAutopilot(f.repo);
  }
  expect(f.repo.task(task.id).status).toBe("done");
  expect(
    readFileSync(resolve(f.repo.home, "autopilot/1/prompt.txt"), "utf8"),
  ).toContain("you must not modify anything");
});
it.each(["review", "plan"])(
  "requeues rate limited %s jobs without consuming budget or attempts",
  (kind) => {
    setup();
    f.repo.setSetting("reviewer_ok", "1");
    f.repo.updateProject("T", { auto_review: 1, autopilot: 1, goal: "Tests" });
    const task =
      kind === "review"
        ? f.task({ status: "in_review", branch: "main", worktree_path: f.path })
        : undefined;
    f.repo.db
      .prepare(
        "INSERT INTO autopilot_jobs(kind,project_id,task_id,started_at) VALUES (?,1,?,?)",
      )
      .run(kind, task?.id || null, new Date().toISOString());
    const dir = resolve(f.repo.home, "autopilot/1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, "result.json"),
      JSON.stringify({
        status: 1,
        stdout: "",
        stderr: "Error: usage limit reached",
      }),
    );
    collectAutopilot(f.repo);
    expect(
      f.repo.db.prepare("SELECT status FROM autopilot_jobs").get(),
    ).toEqual({ status: "rate_limited" });
    expect(autopilotStatus(f.repo)).toMatchObject({
      auto_reviews_today: 0,
      planner_runs_today: 0,
    });
    if (task)
      expect(f.repo.task(task.id)).toMatchObject({
        status: "in_review",
        attempts: 0,
      });
    expect(Date.parse(f.repo.getSetting("cooldown_until")!)).toBeGreaterThan(
      Date.now(),
    );
    startAutopilot(f.repo);
    expect(
      f.repo.db.prepare("SELECT * FROM autopilot_jobs").all(),
    ).toHaveLength(1);
    f.repo.setSetting("cooldown_until", "");
    f.repo.db
      .prepare("UPDATE autopilot_jobs SET finished_at=?")
      .run(new Date(Date.now() - 31 * 60000).toISOString());
    startAutopilot(f.repo);
    expect(
      f.repo.db.prepare("SELECT * FROM autopilot_jobs").all(),
    ).toHaveLength(2);
  },
);
it("records Codex health failure and shared quota cooldown", async () => {
  const fake = setup();
  writeFileSync(
    fake,
    '#!/bin/sh\ncat >/dev/null\necho "Error: usage limit reached" >&2\nexit 1\n',
  );
  expect((await checkReviewer(f.repo)).ok).toBe(false);
  expect(autopilotStatus(f.repo)).toMatchObject({
    reviewer_ok: false,
    reviewer_error: expect.stringContaining("usage limit"),
  });
  expect(Date.parse(f.repo.getSetting("cooldown_until")!)).toBeGreaterThan(
    Date.now(),
  );
});
it("reads Codex planner results from last.md and creates tasks", async () => {
  const fake = setup();
  const tasks = Array.from({ length: 3 }, (_, i) => ({
    title: `Planned ${i}`,
    description: "Add coverage and run tests",
    priority: "P2",
    role: "testing",
    depends_on: i ? [0] : [],
  }));
  writeFileSync(
    fake,
    readFileSync(fake, "utf8").replace(
      "printf 'ok'",
      `printf '${JSON.stringify({ tasks })}'`,
    ),
  );
  f.repo.setSetting("reviewer_ok", "1");
  f.repo.updateProject("T", { autopilot: 1, goal: "Improve tests" });
  startAutopilot(f.repo);
  for (let i = 0; i < 100 && !f.repo.tasks().length; i++) {
    await new Promise((r) => setTimeout(r, 20));
    collectAutopilot(f.repo);
  }
  expect(f.repo.tasks()).toHaveLength(3);
  expect(JSON.parse(f.repo.tasks()[1]!.depends_on)).toEqual([
    f.repo.tasks()[0]!.identifier,
  ]);
});
