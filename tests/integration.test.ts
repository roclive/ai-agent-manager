import { it, expect, afterEach } from "vitest";
import {
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  mkdirSync,
} from "node:fs";
import { resolve } from "node:path";
import { fixture, waitExit } from "./helpers.js";
import { dispatch } from "../src/core/dispatch.js";
import { finalize } from "../src/core/finalize.js";
import { tick } from "../src/core/tick.js";
import { review } from "../src/core/review.js";
import { ensureWorktree, merge, prune } from "../src/core/worktree.js";
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
  f = fixture('echo "Error: 429 quota exceeded"; exit 1');
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

it.each([
  undefined,
  "   ",
  "\n\nImplemented safe commits\n\nDetails: é" + "é".repeat(3000),
])("commits with a bounded worker summary or fallback (%s)", async (last) => {
  f = fixture();
  const t = f.task();
  const id = dispatch(f.repo, t.identifier);
  await waitExit(f.repo, id);
  const run = f.repo.runs()[0];
  if (last !== undefined) writeFileSync(run.last_message_path, last);
  finalize(f.repo, run);
  const path = f.repo.task(t.id).worktree_path!;
  expect(git(path, ["log", "-1", "--format=%s"])).toBe(
    last?.trim() ? "T-1: Implemented safe commits" : "aam: T-1 Example",
  );
  const body = git(path, ["log", "-1", "--format=%b"]);
  expect(Buffer.byteLength(body)).toBeLessThanOrEqual(4096);
  if (last?.trim()) expect(body).toContain("Details: é");
});
it("bounds summary lines to 72 characters", async () => {
  f = fixture();
  const t = f.task();
  const id = dispatch(f.repo, t.identifier);
  await waitExit(f.repo, id);
  const run = f.repo.runs()[0];
  writeFileSync(run.last_message_path, "x".repeat(100));
  finalize(f.repo, run);
  expect(
    git(f.repo.task(t.id).worktree_path!, ["log", "-1", "--format=%s"]),
  ).toBe("T-1: " + "x".repeat(72));
});
it.each([0, 1])(
  "does not pause on ordinary rate-limit output (exit %s)",
  async (code) => {
    f = fixture(`echo 'rate limit quota 429'; exit ${code}`);
    const t = f.task();
    const id = dispatch(f.repo, t.identifier);
    await waitExit(f.repo, id);
    finalize(f.repo, f.repo.runs()[0]);
    expect(f.repo.runs()[0].status).toBe(code === 0 ? "succeeded" : "failed");
    expect(f.repo.getSetting("cooldown_until")).toBe("");
  },
);
it("merges dependencies on creation and retry, skips contained and absent branches", () => {
  f = fixture();
  const dep = f.task({ status: "done" });
  const missing = f.task({ status: "done" });
  const depPath = ensureWorktree(f.repo, dep);
  const commit = (name: string) => {
    writeFileSync(resolve(depPath, name), name);
    git(depPath, ["add", "."]);
    git(depPath, ["commit", "-m", name]);
  };
  commit("dependency.txt");
  const t = f.task({ depends_on: [dep.identifier, missing.identifier] });
  const path = ensureWorktree(f.repo, t);
  expect(readFileSync(resolve(path, "dependency.txt"), "utf8")).toBe(
    "dependency.txt",
  );
  ensureWorktree(f.repo, f.repo.task(t.id));
  expect(
    f.repo.db
      .prepare("SELECT * FROM events WHERE kind = ?")
      .all("dependency_merge"),
  ).toHaveLength(1);
  // Diverge to exercise a real merge on retry.
  writeFileSync(resolve(path, "own.txt"), "own");
  git(path, ["add", "."]);
  git(path, ["commit", "-m", "own"]);
  commit("later.txt");
  ensureWorktree(f.repo, f.repo.task(t.id));
  expect(existsSync(resolve(path, "later.txt"))).toBe(true);
  prune(f.repo, t.identifier);
  commit("after-prune.txt");
  ensureWorktree(f.repo, f.repo.task(t.id));
  expect(existsSync(resolve(path, "after-prune.txt"))).toBe(true);
  expect(
    f.repo.db
      .prepare("SELECT * FROM events WHERE kind = ?")
      .all("dependency_merge"),
  ).toHaveLength(3);
});
it.each([false, true])(
  "blocks dependency conflicts and cleans up only new branches (existing %s)",
  (existing) => {
    f = fixture();
    const deps = [f.task({ status: "done" }), f.task({ status: "done" })];
    for (const [i, dep] of deps.entries()) {
      const path = ensureWorktree(f.repo, dep);
      writeFileSync(resolve(path, "initial.txt"), `change ${i}`);
      git(path, ["add", "."]);
      git(path, ["commit", "-m", `change ${i}`]);
    }
    const t = f.task();
    if (existing) ensureWorktree(f.repo, t);
    f.repo.updateTask(t.id, { depends_on: deps.map((d) => d.identifier) });
    const message = `dependency merge conflict: ${deps[1].identifier}`;
    expect(() => dispatch(f.repo, t.identifier)).toThrow(message);
    expect(f.repo.task(t.id)).toMatchObject({
      status: "blocked",
      blocker: message,
      attempts: 0,
    });
    expect(f.repo.runs()).toHaveLength(0);
    expect(
      existsSync(resolve(f.repo.home, "worktrees", "T", t.identifier)),
    ).toBe(existing);
    expect(
      Boolean(git(f.path, ["branch", "--list", `aam/${t.identifier}`])),
    ).toBe(existing);
    expect(f.repo.events()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "dispatch_error", message }),
      ]),
    );
    tick(f.repo);
    expect(f.repo.runs()).toHaveLength(0);
  },
);
it("blocks setup failures with an event", () => {
  f = fixture();
  f.repo.db.prepare("UPDATE projects SET setup_cmd=?").run("exit 1");
  const t = f.task();
  expect(() => dispatch(f.repo, t.identifier)).toThrow("Setup failed");
  expect(f.repo.task(t.id).status).toBe("blocked");
  expect(f.repo.events()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "dispatch_error" }),
    ]),
  );
});

it("excludes setup symlinks from commits using the common exclude file", async () => {
  f = fixture();
  const outside = resolve(f.root, "dependencies");
  mkdirSync(outside);
  f.repo.db
    .prepare("UPDATE projects SET setup_cmd=?")
    .run(
      `ln -s '${outside}' node_modules; mkdir -p cache; echo setup > cache/data`,
    );
  const t = f.task();
  const id = dispatch(f.repo, t.identifier);
  await waitExit(f.repo, id);
  finalize(f.repo, f.repo.runs()[0]);
  const path = f.repo.task(t.id).worktree_path!;
  expect(f.repo.task(t.id).status).toBe("in_review");
  expect(git(path, ["show", "HEAD:changed.txt"])).toBe("changed");
  expect(git(path, ["ls-tree", "--name-only", "HEAD"])).not.toMatch(
    /node_modules|cache/,
  );
  const exclude = resolve(
    path,
    git(path, ["rev-parse", "--git-common-dir"]),
    "info/exclude",
  );
  expect(readFileSync(exclude, "utf8")).toContain("/node_modules\n");
  expect(readFileSync(exclude, "utf8")).toContain("/cache\n");
  expect(f.repo.events()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "setup_exclude",
        message: expect.stringContaining("node_modules"),
      }),
    ]),
  );
});
it.each([false, true])(
  "skips external symlinks at finalize (pre-staged %s)",
  async (staged) => {
    f = fixture();
    const t = f.task();
    const id = dispatch(f.repo, t.identifier);
    await waitExit(f.repo, id);
    const path = f.repo.task(t.id).worktree_path!;
    symlinkSync(f.path, resolve(path, "external link"));
    symlinkSync("changed.txt", resolve(path, "internal link"));
    if (staged) git(path, ["add", "--", "external link"]);
    finalize(f.repo, f.repo.runs()[0]);
    expect(f.repo.task(t.id).status).toBe("in_review");
    expect(git(path, ["show", "HEAD:changed.txt"])).toBe("changed");
    expect(git(path, ["ls-tree", "--name-only", "HEAD"])).not.toContain(
      "external link",
    );
    expect(git(path, ["show", "HEAD:internal link"])).toBe("changed.txt");
    expect(f.repo.events()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "finalize_skip_symlink",
          message: expect.stringContaining("external link"),
        }),
      ]),
    );
  },
);
it("succeeds when external symlinks are the only worker changes", async () => {
  f = fixture("ln -s /tmp external");
  const t = f.task();
  const id = dispatch(f.repo, t.identifier);
  await waitExit(f.repo, id);
  finalize(f.repo, f.repo.runs()[0]);
  expect(f.repo.task(t.id).status).toBe("in_review");
  expect(
    git(f.repo.task(t.id).worktree_path!, ["log", "-1", "--format=%s"]),
  ).toBe("initial");
});
