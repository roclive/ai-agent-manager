import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Repo } from "../src/db/index.js";
import { fixture } from "./helpers.js";
import { dependenciesDone } from "../src/core/dispatch.js";
import { backlog, progress } from "../src/views/index.js";
import { rateLimited } from "../src/core/finalize.js";
import { codex, opencode, command, prompt } from "../src/workers/index.js";
import { parseVerdict, claudeReview } from "../src/core/review.js";
import { withLock } from "../src/core/lock.js";
import { plist } from "../src/launchd.js";
import { fireRoutine, validateRoutine } from "../src/scheduler.js";
let f: ReturnType<typeof fixture>;
afterEach(() => f?.cleanup());
describe("repository", () => {
  it("persists defaults, projects, tasks, events and routines", () => {
    f = fixture();
    const r = f.repo;
    expect(r.settings()).toMatchObject({
      max_parallel: "2",
      worker_timeout_min: "45",
      default_worker: "codex",
      review_mode: "manual",
      cooldown_until: "",
    });
    r.init();
    r.init();
    expect(r.routines()).toHaveLength(1);
    r.setSetting("default_worker", "opencode");
    const t = f.task();
    expect(t).toMatchObject({
      identifier: "T-1",
      worker: "opencode",
      max_attempts: 3,
      attempts: 0,
    });
    expect(f.task().identifier).toBe("T-2");
    r.updateTask(t.id, { status: "backlog", description: "hello" });
    r.event("test", "hello", t.id);
    expect(r.detail(t.identifier).events).toHaveLength(1);
    const other = new Repo(r.home);
    expect(other.task(t.identifier).description).toBe("hello");
    other.close();
  });
  it("rejects invalid mutations atomically", () => {
    f = fixture();
    expect(() => f.task({ priority: "P8" })).toThrow();
    expect(f.repo.tasks()).toHaveLength(0);
    expect(() => f.task({ title: "" })).toThrow();
    expect(() => f.repo.setSetting("max_parallel", "0")).toThrow();
    expect(() => f.repo.setSetting("review_mode", "unknown")).toThrow();
    const t = f.task();
    expect(() =>
      f.repo.updateTask(t.id, { depends_on: [t.identifier] }),
    ).toThrow();
  });
  it("orders priority then sequence and checks every dependency", () => {
    f = fixture();
    const first = f.task({ priority: "P2" });
    const second = f.task({ priority: "P0", depends_on: [first.identifier] });
    f.task({ priority: "P0" });
    expect(f.repo.tasks().map((t) => t.identifier)).toEqual([
      "T-2",
      "T-3",
      "T-1",
    ]);
    expect(dependenciesDone(f.repo, second)).toBe(false);
    f.repo.updateTask(first.id, { status: "done" });
    expect(dependenciesDone(f.repo, second)).toBe(true);
    expect(
      dependenciesDone(
        f.repo,
        f.repo.updateTask(second.id, { depends_on: ["missing"] }),
      ),
    ).toBe(false);
  });
});
it("renders status groups, feedback, last 20 done and recent 50 events", () => {
  f = fixture();
  f.task({ title: "A title", feedback: "first\nsecond", status: "blocked" });
  for (let i = 0; i < 25; i++) f.task({ status: "done" });
  for (let i = 0; i < 55; i++) f.repo.event("test", `event ${i}`);
  const b = backlog(f.repo);
  expect(b).toContain("- [P1] T-1 A title (codex, attempts 0/3) — first");
  expect(b).not.toContain("second");
  expect(b.match(/attempts/g)).toHaveLength(21);
  expect(progress(f.repo).match(/\[test\]/g)).toHaveLength(50);
});
it("detects rate limit text", () => {
  for (const s of ["USAGE LIMIT", "rate limit", "429", "quota exceeded"])
    expect(rateLimited(`Error: ${s}`, 1)).toBe(true);
  expect(rateLimited("success")).toBe(false);
  for (const text of [
    "Error: rate_limited",
    '{"type":"error","message":"insufficient_quota"}',
    '{"type":"turn.failed","message":"429"}',
    '{"type":"result","error":{"message":"quota exceeded"}}',
  ]) {
    expect(rateLimited(text, 1)).toBe(true);
    expect(rateLimited(text, null)).toBe(true);
    expect(rateLimited(text, 0)).toBe(false);
  }
  for (const text of [
    "rate limit test passed",
    "Error: quota variable",
    "Error: 14290",
    '{"type":"item.completed","text":"Error: rate limit test"}',
    "Error: unrelated failure\n429 rate limit",
  ])
    expect(rateLimited(text, 1)).toBe(false);
});
it("builds safe adapter commands and full prompt", () => {
  f = fixture();
  const c = { worktree: "/tmp/w t", runDir: "/tmp/r", promptFile: "/tmp/p" };
  expect(command("codex", c)).toEqual({
    cmd: f.fake,
    args: [c.worktree, c.promptFile],
  });
  delete process.env.AAM_FAKE_WORKER;
  expect(codex.command(c)).toEqual({
    cmd: "codex",
    args: [
      "exec",
      "--json",
      "-C",
      c.worktree,
      "-s",
      "workspace-write",
      "-c",
      'approval_policy="never"',
      "-c",
      "sandbox_workspace_write.network_access=true",
      "--skip-git-repo-check",
      "-o",
      "/tmp/r/last.md",
      "-",
    ],
    stdinFile: "/tmp/p",
  });
  expect(opencode.command(c).args.slice(-2)).toEqual([
    c.worktree,
    c.promptFile,
  ]);
  const t = f.task({
    feedback: "fix tests",
    description: "Build it",
    role: "testing",
  });
  const p = prompt(f.repo.projects()[0], t);
  for (const s of [
    "Test",
    "T-1",
    "Build it",
    "testing",
    "fix tests",
    "Do not push",
    "Do not run git add or git commit; aam commits",
    "outside",
  ])
    expect(p).toContain(s);
});
it("locks concurrent ticks, releases on errors and recovers stale pids", () => {
  f = fixture();
  const path = resolve(f.repo.home, "tick.lock");
  writeFileSync(path, String(process.pid));
  expect(withLock(f.repo, () => true)).toBeUndefined();
  writeFileSync(path, "99999999");
  expect(withLock(f.repo, () => true)).toBe(true);
  expect(() =>
    withLock(f.repo, () => {
      throw new Error("test");
    }),
  ).toThrow();
  expect(withLock(f.repo, () => 42)).toBe(42);
});
it("parses nested Claude JSON and leaves invalid reviews pending", () => {
  expect(
    parseVerdict(
      JSON.stringify({
        result: 'Here: {"verdict":"approve","notes":"ok {yes}"}',
      }),
    ),
  ).toEqual({ verdict: "approve", notes: "ok {yes}" });
  expect(parseVerdict("garbage")).toBeNull();
  f = fixture();
  const t = f.task({
    status: "in_review",
    branch: "main",
    worktree_path: f.path,
  });
  claudeReview(f.repo, t.identifier, () => ({
    status: 0,
    stdout: "not JSON",
    stderr: "",
  }));
  expect(f.repo.task(t.id).status).toBe("in_review");
  expect(f.repo.events()).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: "review_error" })]),
  );
  claudeReview(f.repo, t.identifier, (cmd, args, cwd, _input, timeout) => {
    expect(cmd).toBe("claude");
    expect(args.slice(0, 3)).toEqual(["-p", "--output-format", "json"]);
    expect(cwd).toBe(f.path);
    expect(timeout).toBe(120000);
    return {
      status: 0,
      stdout: JSON.stringify({
        result: '{"verdict":"approve","notes":"fine"}',
      }),
      stderr: "",
    };
  });
  expect(f.repo.task(t.id).status).toBe("done");
});
it("runs create_task and shell routines and generates launchd plist", () => {
  f = fixture();
  validateRoutine("*/5 * * * *", "create_task", {
    project: "T",
    title: "Scheduled",
  });
  expect(() => validateRoutine("bad", "heartbeat", {})).toThrow();
  f.repo.addRoutine("create", "* * * * *", "create_task", {
    project: "T",
    title: "Scheduled",
  });
  fireRoutine(f.repo, f.repo.routines()[0]);
  expect(f.repo.tasks()[0].title).toBe("Scheduled");
  expect(f.repo.routines()[0].last_run_at).toBeTruthy();
  f.repo.addRoutine("shell", "* * * * *", "shell", {
    cmd: "printf routine-output",
    cwd: f.path,
  });
  fireRoutine(f.repo, f.repo.routines()[1]);
  expect(JSON.stringify(f.repo.events())).toContain("routine-output");
  const xml = plist(f.repo, "/tmp/a&b");
  expect(xml).toContain("/tmp/a&amp;b");
  expect(xml).toContain("RunAtLoad");
  expect(xml).toContain("KeepAlive");
  expect(xml).toContain(f.repo.home);
});
it("keeps identifiers monotonic when the API reorders sequence values", () => {
  f = fixture();
  const t = f.task();
  f.repo.updateTask(t.id, { seq: 10 });
  const next = f.task();
  expect(next.identifier).toBe("T-2");
  expect(next.seq).toBe(2);
});

it("prefers the stable Homebrew node path and falls back to the current executable", async () => {
  const { nodePath } = await import("../src/launchd.js");
  expect(nodePath(() => true)).toBe("/opt/homebrew/bin/node");
  expect(nodePath(() => false)).toBe(process.execPath);
});

it("migrates existing tasks with a persistent default lost counter", () => {
  f = fixture();
  const t = f.task();
  f.repo.db.exec("ALTER TABLE tasks DROP COLUMN lost_count");
  const other = new Repo(f.repo.home);
  try {
    expect(other.task(t.id).lost_count).toBe(0);
    other.updateTask(t.id, { lost_count: 2 });
  } finally {
    other.close();
  }
  expect(f.repo.task(t.id).lost_count).toBe(2);
});

it("reports launchd exit 78 with a privacy hint for protected repos", async () => {
  f = fixture();
  const { homedir } = await import("node:os");
  const { launchd } = await import("../src/launchd.js");
  f.repo.db
    .prepare("UPDATE projects SET repo_path=?")
    .run(resolve(homedir(), "Desktop", "project"));
  const calls: string[][] = [];
  const status = launchd(f.repo, "status", false, (_cmd, args) => {
    calls.push(args);
    return {
      status: 0,
      stdout: args[0] === "print" ? "last exit code = 78" : "",
      stderr: "",
    };
  });
  expect(status).toMatchObject({
    loaded: true,
    lastExitCode: 78,
    hint: expect.stringContaining("Full Disk Access"),
  });
  expect(calls[1]).toEqual([
    "print",
    `gui/${process.getuid?.() ?? 0}/com.aam.daemon`,
  ]);
});
