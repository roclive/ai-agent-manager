import { it, expect, afterEach } from "vitest";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fixture, waitExit } from "./helpers.js";
import { dispatch } from "../src/core/dispatch.js";
import { finalize } from "../src/core/finalize.js";
import { tick } from "../src/core/tick.js";
import { review } from "../src/core/review.js";
import { merge, prune } from "../src/core/worktree.js";
import { git } from "../src/core/process.js";
let f: ReturnType<typeof fixture>;
afterEach(() => f?.cleanup());
it("dispatches, reaps, commits, tests, reviews, merges and prunes without changing main checkout", async () => {
  f = fixture();
  f.repo.db
    .prepare("UPDATE projects SET test_cmd=?")
    .run("test -f changed.txt");
  const t = f.task({
    description: "literal $(touch /tmp/aam-unsafe); `exit 1`",
  });
  tick(f.repo);
  const run = f.repo.runs()[0];
  await waitExit(f.repo, run.id);
  tick(f.repo);
  expect(f.repo.task(t.id).status).toBe("in_review");
  expect(f.repo.runs()[0]).toMatchObject({
    status: "succeeded",
    exit_code: 0,
    test_exit_code: 0,
  });
  expect(
    readFileSync(
      resolve(f.repo.home, "runs", String(run.id), "prompt.md"),
      "utf8",
    ),
  ).toContain(t.description);
  expect(existsSync(resolve(f.path, "changed.txt"))).toBe(false);
  expect(git(f.path, ["status", "--porcelain"])).toBe("");
  expect(readFileSync(resolve(f.root, "BACKLOG.md"), "utf8")).toContain(
    "in_review",
  );
  review(f.repo, t.identifier, "approve", "Looks good");
  expect(() => merge(f.repo, t.identifier, "main")).toThrow("base branch");
  expect(() => merge(f.repo, t.identifier, "refs/heads/main")).toThrow(
    "base branch",
  );
  git(f.path, ["branch", "integration"]);
  merge(f.repo, t.identifier, "integration");
  expect(git(f.path, ["show", "integration:changed.txt"])).toBe("changed");
  expect(git(f.path, ["branch", "--show-current"])).toBe("main");
  prune(f.repo, t.identifier);
  expect(f.repo.task(t.id).worktree_path).toBeNull();
  expect(git(f.path, ["branch", "--list", `aam/${t.identifier}`])).toContain(
    t.identifier,
  );
});
it("retries failed workers in the same worktree and blocks at max attempts", async () => {
  f = fixture("printf failure >&2\nexit 7");
  const t = f.task({ max_attempts: 2 });
  const a = dispatch(f.repo, t.identifier);
  await waitExit(f.repo, a);
  finalize(f.repo, f.repo.runs()[0]);
  expect(f.repo.task(t.id)).toMatchObject({ status: "ready", attempts: 1 });
  const path = f.repo.task(t.id).worktree_path;
  const b = dispatch(f.repo, t.identifier);
  await waitExit(f.repo, b);
  finalize(f.repo, f.repo.runs()[0]);
  expect(f.repo.task(t.id)).toMatchObject({
    status: "blocked",
    attempts: 2,
    worktree_path: path,
  });
  expect(f.repo.task(t.id).feedback).toContain("failure");
  expect(f.repo.task(t.id).blocker).toContain("failure");
});
it("fails a successful worker when project tests fail", async () => {
  f = fixture();
  f.repo.db
    .prepare("UPDATE projects SET test_cmd=?")
    .run("printf test-failed; exit 2");
  const t = f.task();
  const id = dispatch(f.repo, t.identifier);
  await waitExit(f.repo, id);
  finalize(f.repo, f.repo.runs()[0]);
  expect(f.repo.runs()[0].test_exit_code).toBe(2);
  expect(f.repo.task(t.id)).toMatchObject({ status: "ready", attempts: 1 });
  expect(f.repo.task(t.id).feedback).toContain("test-failed");
});
it("detects rate limits and skips dispatch during cooldown without consuming attempts", async () => {
  f = fixture('echo "429 quota"; exit 1');
  const t = f.task();
  dispatch(f.repo, t.identifier);
  await waitExit(f.repo, f.repo.runs()[0].id);
  tick(f.repo);
  expect(f.repo.runs()[0].status).toBe("rate_limited");
  expect(f.repo.task(t.id)).toMatchObject({ status: "ready", attempts: 0 });
  expect(Date.parse(f.repo.getSetting("cooldown_until")!)).toBeGreaterThan(
    Date.now(),
  );
  tick(f.repo);
  expect(f.repo.runs()).toHaveLength(1);
  expect(() => dispatch(f.repo, t.identifier)).toThrow("cooldown");
});
it("respects priority, max_parallel and dependencies; forced runs bypass deps and capacity", async () => {
  f = fixture("sleep 30");
  f.repo.setSetting("max_parallel", "1");
  const low = f.task({ priority: "P3" });
  const high = f.task({ priority: "P0" });
  const dependent = f.task({ priority: "P0", depends_on: [high.identifier] });
  tick(f.repo);
  expect(f.repo.runs()).toHaveLength(1);
  expect(f.repo.runs()[0].task_id).toBe(high.id);
  expect(() => dispatch(f.repo, dependent.identifier)).toThrow("Dependencies");
  dispatch(f.repo, dependent.identifier, true);
  expect(f.repo.runs()).toHaveLength(2);
  expect(f.repo.task(low.id).status).toBe("ready");
  expect(() => dispatch(f.repo, high.identifier)).toThrow("already running");
});
it("rejects reviews with feedback, reuses branch, runs setup once, and blocks exhausted reviews", async () => {
  f = fixture();
  f.repo.db
    .prepare("UPDATE projects SET setup_cmd=?")
    .run("echo setup >> setup-count");
  const t = f.task({ max_attempts: 2 });
  let id = dispatch(f.repo, t.identifier);
  await waitExit(f.repo, id);
  finalize(f.repo, f.repo.runs()[0]);
  review(f.repo, t.identifier, "reject", "Please fix");
  expect(f.repo.task(t.id)).toMatchObject({
    status: "ready",
    attempts: 1,
    feedback: "Please fix",
  });
  id = dispatch(f.repo, t.identifier);
  await waitExit(f.repo, id);
  finalize(f.repo, f.repo.runs()[0]);
  expect(
    readFileSync(
      resolve(f.repo.task(t.id).worktree_path!, "setup-count"),
      "utf8",
    ),
  ).toBe("setup\n");
  review(f.repo, t.identifier, "reject", "Still wrong");
  expect(f.repo.task(t.id)).toMatchObject({ status: "blocked", attempts: 2 });
});
it("kills timeout groups and classifies lost runs", async () => {
  f = fixture("sleep 30");
  const t = f.task();
  dispatch(f.repo, t.identifier);
  f.repo.db.prepare("UPDATE runs SET started_at=?").run("2000-01-01T00:00:00Z");
  f.repo.setSetting(
    "cooldown_until",
    new Date(Date.now() + 60000).toISOString(),
  );
  tick(f.repo);
  expect(f.repo.runs()[0].status).toBe("timeout");
  expect(f.repo.task(t.id).attempts).toBe(1);
  f.repo.setSetting("cooldown_until", "");
  writeFileSync(f.fake, "#!/bin/sh\nsleep 30\n");
  const id = dispatch(f.repo, t.identifier);
  const run = f.repo.runs().find((r) => r.id === id)!;
  const { killGroup } = await import("../src/core/process.js");
  killGroup(run.pid);
  f.repo.db.prepare("UPDATE runs SET pid=? WHERE id=?").run(99999999, id);
  f.repo.setSetting(
    "cooldown_until",
    new Date(Date.now() + 60000).toISOString(),
  );
  tick(f.repo);
  expect(f.repo.runs()[0].status).toBe("lost");
});
it("claude mode uses injectable review runner and finalization is idempotent", async () => {
  f = fixture();
  f.repo.setSetting("review_mode", "claude");
  const t = f.task();
  dispatch(f.repo, t.identifier);
  await waitExit(f.repo, f.repo.runs()[0].id);
  const old = f.repo.runs()[0];
  let calls = 0;
  tick(f.repo, () => {
    calls++;
    return {
      status: 0,
      stdout: '{"result":"{\\"verdict\\":\\"approve\\",\\"notes\\":\\"ok\\"}"}',
      stderr: "",
    };
  });
  expect(calls).toBe(1);
  expect(f.repo.task(t.id).status).toBe("done");
  finalize(f.repo, old);
  expect(f.repo.task(t.id).status).toBe("done");
});
