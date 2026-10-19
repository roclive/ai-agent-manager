import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, readFileSync, realpathSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { Repo } from "../src/db/index.js";
import { fixture } from "./helpers.js";
import { dependenciesDone } from "../src/core/dispatch.js";
import { backlog, progress } from "../src/views/index.js";
import { rateLimited } from "../src/core/finalize.js";
import { codex, opencode, command, prompt, promptPrefix, promptPrefixHash } from "../src/workers/index.js";
import { parseVerdict, claudeReview } from "../src/core/review.js";
import { withLock } from "../src/core/lock.js";
import { plist, nodePath, daemonLogPath } from "../src/launchd.js";
import { fireRoutine, fireScheduledRoutine, validateRoutine } from "../src/scheduler.js";

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

  it("returns events in descending order by id", () => {
    f = fixture();
    const r = f.repo;
    r.event("e1", "msg1");
    r.event("e2", "msg2");
    r.event("e3", "msg3");
    const events = r.events();
    expect(events.slice(0, 3)).toMatchObject([{message: "msg3"}, {message: "msg2"}, {message: "msg1"}]);
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
    expect(() =>
      f.repo.updateTask(second.id, { depends_on: ["missing"] }),
    ).toThrow("Task not found");
    f.repo.db
      .prepare("UPDATE tasks SET depends_on=? WHERE id=?")
      .run('["missing"]', second.id);
    expect(dependenciesDone(f.repo, f.repo.task(second.id))).toBe(false);
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
  expect(codex.command({ ...c, sandbox: "danger-full-access" }).args).toContain(
    "danger-full-access",
  );
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
  const resolution = prompt(
    { ...f.repo.projects()[0]!, integration_branch: "aam/integration" },
    { ...t, resolves_task_id: t.id },
    t,
  );
  expect(resolution).toContain("First merge aam/integration");
  expect(resolution).toContain("then merge aam/T-1");
  expect(resolution).toContain("git add and git commit are REQUIRED");
  expect(resolution).not.toContain("Do not run git add or git commit");
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
    expect(args[3]).toContain("severity [P0], [P1], [P2], or [P3]");
    expect(args[3]).toContain("only findings are [P3] nits or style");
    expect(args[3]).toContain("Reject for any [P0]/[P1]/[P2]");
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

it("runs create_task and shell routines and generates launchd plist", async () => {
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
  await fireRoutine(f.repo, f.repo.routines()[0]);
  expect(f.repo.tasks()[0].title).toBe("Scheduled");
  expect(f.repo.routines()[0].last_run_at).toBeTruthy();
  f.repo.addRoutine("shell", "* * * * *", "shell", {
    cmd: "printf routine-output",
    cwd: f.path,
  });
  await fireRoutine(f.repo, f.repo.routines()[1]);
  expect(JSON.stringify(f.repo.events())).toContain("routine-output");
  const xml = plist(f.repo);
  const escape = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  expect(xml).toContain(
    `<key>WorkingDirectory</key><string>${escape(homedir())}</string>`,
  );
  for (const key of ["StandardOutPath", "StandardErrorPath"])
    expect(xml).toContain(
      `<key>${key}</key><string>${escape(daemonLogPath())}</string>`,
    );
  expect(xml).toContain(
    `<key>AAM_HOME</key><string>${escape(f.repo.home)}</string>`,
  );
  const tempPlist = resolve(f.root, "daemon.plist");
  writeFileSync(tempPlist, xml);
  expect(readFileSync(tempPlist, "utf8")).toBe(xml);
  expect(xml).toContain("RunAtLoad");
  expect(xml).toContain("KeepAlive");
  expect(xml).toContain(f.repo.home);
});

it("re-reads scheduled routines before firing disabled or edited definitions", async () => {
  f = fixture();
  f.repo.addRoutine("mutable", "* * * * *", "create_task", {
    project: "T",
    title: "stale",
  });
  const id = f.repo.routines()[0].id;
  f.repo.db
    .prepare("UPDATE routines SET enabled=0,payload=? WHERE id=?")
    .run(JSON.stringify({ project: "T", title: "current" }), id);
  await fireScheduledRoutine(f.repo, id);
  expect(f.repo.tasks()).toHaveLength(0);
  f.repo.db.prepare("UPDATE routines SET enabled=1 WHERE id=?").run(id);
  await fireScheduledRoutine(f.repo, id);
  expect(f.repo.tasks()).toMatchObject([{ title: "current" }]);
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
    logPath: resolve(homedir(), "Library/Logs/aam/daemon.log"),
    hint: expect.stringContaining("Full Disk Access"),
  });
  expect(status).toHaveProperty(
    "hint",
    expect.stringContaining(realpathSync(nodePath())),
  );
  expect(status).toHaveProperty(
    "hint",
    expect.stringContaining(
      "already keeps its cwd and logs outside protected folders",
    ),
  );
  expect(calls[1]).toEqual([
    "print",
    `gui/${process.getuid?.() ?? 0}/com.aam.daemon`,
  ]);
});

it("migrates start_sha idempotently without inventing snapshots for old runs", () => {
  f = fixture();
  const t = f.task();
  f.repo.db.exec("ALTER TABLE runs DROP COLUMN start_sha");
  f.repo.db
    .prepare(
      "INSERT INTO runs(task_id,worker,status,started_at,log_path,last_message_path) VALUES (?,'codex','lost','','','')",
    )
    .run(t.id);
  for (let i = 0; i < 2; i++) {
    const other = new Repo(f.repo.home);
    try {
      expect(other.runs()[0].start_sha).toBeNull();
    } finally {
      other.close();
    }
  }
});

it("installs, reports and removes both launchd services using an isolated home and runner", async () => {
  f = fixture();
  const { launchd } = await import("../src/launchd.js");
  const userHome = resolve(f.root, "launchd-home");
  const calls: string[][] = [];
  const run = (_cmd: string, args: string[]) => {
    calls.push(args);
    return {
      status: 0,
      stdout: "state = running\npid = 123\nlast exit code = 0",
      stderr: "",
    };
  };
  launchd(f.repo, "install", false, run, userHome);
  expect(calls).toHaveLength(0);
  for (const service of ["daemon", "ui"]) {
    const body = readFileSync(
      resolve(userHome, `Library/LaunchAgents/com.aam.${service}.plist`),
      "utf8",
    );
    expect(body).toContain(`<string>com.aam.${service}</string>`);
    expect(body).toContain(`<string>${userHome}</string>`);
    expect(body).toContain(`Library/Logs/aam/${service}.log`);
    expect(body).toContain("<key>KeepAlive</key><true/>");
    if (service === "ui")
      expect(body).toContain(
        "<string>serve</string><string>--port</string><string>3199</string>",
      );
  }
  launchd(f.repo, "install", true, run, userHome);
  expect(calls.filter((a) => a[0] === "load")).toHaveLength(2);
  expect(launchd(f.repo, "status", false, run, userHome)).toMatchObject({
    services: [
      { label: "com.aam.daemon", state: "running", pid: 123, lastExitCode: 0 },
      { label: "com.aam.ui", state: "running", pid: 123, lastExitCode: 0 },
    ],
  });
  launchd(f.repo, "uninstall", false, run, userHome);
  expect(calls.filter((a) => a[0] === "unload")).toHaveLength(2);
  expect(
    existsSync(resolve(userHome, `Library/LaunchAgents/com.aam.ui.plist`)),
  ).toBe(false);
});

it("includes review feedback and a regression test requirement in worker prompts", () => {
  f = fixture();
  const feedback = "[P2] Preserve feedback\n[P1] Prevent data loss";
  const task = f.task({ feedback });
  const text = prompt(f.repo.project("T"), task);
  expect(text).toContain(`上一轮审查意见（必须逐条处理）\n${feedback}`);
  expect(text).toContain("为每个发现添加回归测试");
  expect(prompt(f.repo.project("T"), { ...task, feedback: "" })).not.toContain(
    "上一轮审查意见",
  );
});

it("worker prompts of one project share a byte-identical prefix", () => {
  f = fixture();
  const project = f.repo.project("T");
  const a = prompt(project, f.task({ description: "alpha", feedback: "x" }));
  const b = prompt(project, f.task({ description: "beta" }));
  const prefix = promptPrefix(project);
  expect(a.startsWith(prefix)).toBe(true);
  expect(b.startsWith(prefix)).toBe(true);
  expect(prefix).not.toContain("alpha");
  expect(promptPrefixHash(project)).toMatch(/^[0-9a-f]{64}$/);
  expect(promptPrefixHash(project)).toBe(promptPrefixHash(project));
});
