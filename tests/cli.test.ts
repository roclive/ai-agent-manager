import { it, expect, afterEach } from "vitest";
import { spawnSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { fixture, waitExit } from "./helpers.js";
import { tick } from "../src/core/tick.js";
let f: ReturnType<typeof fixture>;
afterEach(() => f?.cleanup());
const executable = resolve("bin/aam");
it("runs executable CLI management commands and reaps workers after the launching CLI exits", async () => {
  f = fixture("sleep 0.1\nprintf from-cli > cli.txt\nexit 0");
  const run = (args: string[], ok = true) => {
    const r = spawnSync(executable, args, {
      cwd: f.root,
      env: { ...process.env, AAM_HOME: f.repo.home },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(r.status, `${args.join(" ")}: ${r.stderr}`).toBe(ok ? 0 : 1);
    return r.stdout;
  };
  expect(run(["init"])).toContain("Initialized");
  expect(run(["project", "list"])).toContain("Test");
  expect(
    run([
      "task",
      "add",
      "--project",
      "T",
      "--title",
      "CLI task",
      "--desc",
      "literal $(false)",
      "--ready",
    ]),
  ).toContain("T-1");
  expect(run(["task", "list", "--json"])).toContain("CLI task");
  expect(run(["task", "show", "T-1"])).toContain("literal $(false)");
  run(["task", "edit", "T-1", "--title", "Edited", "--priority", "P0"]);
  const feedback = resolve(f.root, "feedback.txt");
  writeFileSync(feedback, "literal $(false)\nfeedback");
  run(["task", "edit", "T-1", "--attempts", "2", "--feedback-file", feedback]);
  expect(f.repo.task("T-1")).toMatchObject({
    attempts: 2,
    feedback: "literal $(false)\nfeedback",
  });
  for (const invalid of ["-1", "1.5", "NaN"])
    run(["task", "edit", "T-1", "--attempts", invalid], false);
  run(["task", "move", "T-1", "blocked", "--note", "Human note"]);
  expect(f.repo.task("T-1").feedback).toBe("literal $(false)\nfeedback");
  expect(JSON.stringify(f.repo.events(10))).toContain("Human note");
  f.repo.updateTask("T-1", { blocker: "exhausted" });
  run(["task", "move", "T-1", "ready"]);
  expect(f.repo.task("T-1")).toMatchObject({
    blocker: "",
    attempts: 2,
    feedback: "literal $(false)\nfeedback",
  });
  run(["task", "retry", "T-1"]);
  expect(f.repo.task("T-1").attempts).toBe(2);
  for (const invalid of ["-1", "1.5", "NaN"])
    run(["task", "retry", "T-1", "--attempts", invalid], false);
  run(["task", "retry", "T-1", "--attempts", "0"]);
  expect(f.repo.task("T-1")).toMatchObject({
    status: "ready",
    attempts: 0,
    feedback: "literal $(false)\nfeedback",
  });
  run(["settings", "set", "max_parallel", "1"]);
  expect(run(["settings", "get", "max_parallel"])).toContain("1");
  run([
    "routine",
    "add",
    "--name",
    "sweep",
    "--cron",
    "0 0 * * *",
    "--action",
    "create_task",
    "--payload",
    '{"project":"T","title":"Sweep"}',
  ]);
  run(["routine", "disable", "sweep"]);
  run(["routine", "enable", "sweep"]);
  expect(run(["routine", "list"])).toContain("sweep");
  run(["run", "T-1"]);
  await waitExit(f.repo, f.repo.runs()[0].id);
  run(["tick"]);
  expect(f.repo.task("T-1").status).toBe("in_review");
  expect(
    readFileSync(resolve(f.repo.task("T-1").worktree_path!, "cli.txt"), "utf8"),
  ).toBe("from-cli");
  expect(run(["logs", "T-1", "--tail", "10"])).toBe("\n");
  run(["review", "T-1", "approve", "--note", "Reviewed"]);
  run(["merge", "T-1", "--into", "main"], false);
  run(["worktree", "prune", "T-1"]);
  run(["task", "move", "T-1", "backlog", "--note", "Reopen"]);
  expect(f.repo.task("T-1").status).toBe("backlog");
});
it("stops daemon gracefully while its detached worker continues", async () => {
  f = fixture("sleep 0.5\nprintf detached > detached.txt\nexit 0");
  f.task();
  const child = spawn(executable, ["daemon", "--interval", "0.1"], {
    cwd: f.root,
    env: { ...process.env, AAM_HOME: f.repo.home },
    stdio: "ignore",
  });
  try {
    for (let i = 0; i < 100 && f.repo.runs().length === 0; i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(f.repo.runs()).toHaveLength(1);
    const run = f.repo.runs()[0];
    const ended = new Promise<number | null>((r) => child.once("exit", r));
    child.kill("SIGTERM");
    expect(await ended).toBe(0);
    await waitExit(f.repo, run.id);
    tick(f.repo);
    expect(f.repo.task(run.task_id).status).toBe("in_review");
  } finally {
    child.kill("SIGKILL");
  }
});

it("reports Claude health and integration backfill summary through CLI", () => {
  f = fixture();
  const run = (args: string[]) =>
    spawnSync(executable, args, {
      cwd: f.root,
      env: { ...process.env, AAM_HOME: f.repo.home },
      encoding: "utf8",
      timeout: 5000,
    });
  expect(run(["autopilot", "check"])).toMatchObject({
    status: 0,
    stdout: expect.stringContaining("ok: ok"),
  });
  expect(run(["project", "edit", "T", "--integration", "on"]).stdout).toContain(
    '"pending": 0',
  );
  writeFileSync(
    process.env.AAM_FAKE_CLAUDE!,
    `#!/bin/sh\ncat >/dev/null\nprintf '{"result":"Please run /login","is_error":true}'\n`,
  );
  expect(run(["autopilot", "check"])).toMatchObject({
    status: 1,
    stdout: expect.stringContaining("error: Please run /login"),
  });
});
