import { it, expect } from "vitest";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fixture } from "./helpers.js";
import { tick } from "../src/core/tick.js";
import { createApp } from "../src/server.js";
import { ensureWorktree } from "../src/core/worktree.js";
import { git } from "../src/core/process.js";
import { dependenciesDone, dependencyWaiting } from "../src/core/dispatch.js";
import {
  integrate,
  setIntegration,
  reconcileIntegration,
  promote,
} from "../src/core/integration.js";
import {
  autopilotStatus,
  checkClaude,
  collectAutopilot,
  startAutopilot,
} from "../src/core/autopilot.js";

it("backfills history in completion order and releases dependents only after integration", () => {
  const f = fixture();
  try {
    const a = f.task();
    const wt = ensureWorktree(f.repo, a);
    writeFileSync(resolve(wt, "history"), "history");
    git(wt, ["add", "."]);
    git(wt, ["commit", "-m", "history"]);
    f.repo.updateTask(a.id, { status: "done" });
    const summary = setIntegration(f.repo, "T", "on");
    expect(summary.integrated).toBe(1);
    expect(git(f.path, ["show", "aam/integration:history"])).toBe("history");
    const b = f.task({ depends_on: [a.identifier] });
    f.repo.updateTask(a.id, { integrated: 0 });
    expect(dependenciesDone(f.repo, b)).toBe(false);
    expect(dependencyWaiting(f.repo, b)).toContain("集成");
    // Already-ancestor recognition works even if the integration branch is checked out.
    const tip = git(f.path, ["rev-parse", "aam/integration"]);
    git(f.path, ["checkout", "aam/integration"]);
    reconcileIntegration(f.repo);
    expect(dependenciesDone(f.repo, b)).toBe(true);
    expect(git(f.path, ["rev-parse", "HEAD"])).toBe(tip);
    git(f.path, ["checkout", "main"]);
    promote(f.repo, "T", true);
    expect(autopilotStatus(f.repo).promotions_today).toBe(0);
    expect(
      f.repo.db
        .prepare("SELECT * FROM events WHERE kind='integration_promote'")
        .all(),
    ).toHaveLength(1);
  } finally {
    f.cleanup();
  }
});

it("retries transient errors, handles stale locks, and stops after five failures", () => {
  const f = fixture();
  try {
    setIntegration(f.repo, "T", "on");
    const t = f.task({ status: "done", branch: "missing", integrated: 0 });
    const lock = resolve(f.repo.home, "integration.lock");
    writeFileSync(lock, String(process.pid));
    reconcileIntegration(f.repo);
    expect(f.repo.task(t.id).integration_attempts).toBe(1);
    unlinkSync(lock);
    writeFileSync(lock, "99999999");
    for (let i = 0; i < 8; i++) reconcileIntegration(f.repo);
    expect(f.repo.task(t.id).integration_attempts).toBe(5);
    expect(
      f.repo.db
        .prepare("SELECT * FROM events WHERE kind='integration_blocked'")
        .all(),
    ).toHaveLength(1);
    const ok = f.task();
    ensureWorktree(f.repo, ok);
    f.repo.updateTask(ok.id, { status: "done", integrated: 0 });
    tick(f.repo);
    expect(f.repo.task(ok.id).integrated).toBe(1);
  } finally {
    f.cleanup();
  }
});

it("backfill conflicts create one resolution and reconcile does not duplicate it", () => {
  const f = fixture();
  try {
    for (const value of ["one", "two"]) {
      const t = f.task();
      const wt = ensureWorktree(f.repo, t);
      writeFileSync(resolve(wt, "initial.txt"), value);
      git(wt, ["add", "."]);
      git(wt, ["commit", "-m", value]);
      f.repo.updateTask(t.id, { status: "done" });
    }
    expect(setIntegration(f.repo, "T", "on")).toMatchObject({
      integrated: 1,
      pending: 1,
    });
    for (let i = 0; i < 3; i++) reconcileIntegration(f.repo);
    expect(f.repo.tasks().filter((t) => t.resolves_task_id)).toHaveLength(1);
  } finally {
    f.cleanup();
  }
});

it("checks Claude login asynchronously, pauses without budget use, and resumes", async () => {
  const f = fixture();
  try {
    f.repo.updateProject("T", { auto_review: 1 });
    f.task({ status: "in_review" });
    writeFileSync(
      process.env.AAM_FAKE_CLAUDE!,
      '#!/bin/sh\ncat >/dev/null\nprintf \'{"result":"Not logged in · Please run /login","is_error":true}\'\n',
    );
    const health = await checkClaude(f.repo);
    expect(health.ok).toBe(false);
    startAutopilot(f.repo);
    startAutopilot(f.repo);
    const status = await (
      await createApp(f.repo).request("/api/status")
    ).json();
    expect(status.autopilot).toMatchObject({
      claude_ok: false,
      claude_error: health.result,
    });
    expect(autopilotStatus(f.repo)).toMatchObject({
      claude_ok: false,
      auto_reviews_today: 0,
    });
    expect(
      f.repo.db
        .prepare("SELECT * FROM events WHERE kind='autopilot_paused'")
        .all(),
    ).toHaveLength(1);
    writeFileSync(
      process.env.AAM_FAKE_CLAUDE!,
      '#!/bin/sh\ncat >/dev/null\nprintf \'{"result":"ok","is_error":false}\'\n',
    );
    expect((await checkClaude(f.repo)).ok).toBe(true);
    expect(
      f.repo.db
        .prepare("SELECT * FROM events WHERE kind='autopilot_resumed'")
        .all(),
    ).toHaveLength(1);
  } finally {
    f.cleanup();
  }
});

it("does not approve an is_error Claude response even when its result contains a verdict", () => {
  const f = fixture();
  try {
    f.repo.updateProject("T", { auto_review: 1 });
    const t = f.task({ status: "in_review" });
    const job = f.repo.db
      .prepare(
        "INSERT INTO autopilot_jobs(kind,project_id,task_id,started_at) VALUES ('review',1,?,?)",
      )
      .run(t.id, new Date().toISOString());
    const dir = resolve(f.repo.home, "autopilot", String(job.lastInsertRowid));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, "result.json"),
      JSON.stringify({
        status: 0,
        stdout: JSON.stringify({
          is_error: true,
          result: '{"verdict":"approve","notes":"untrusted"}',
        }),
      }),
    );
    collectAutopilot(f.repo);
    expect(f.repo.task(t.id).status).toBe("in_review");
    expect(
      f.repo.db.prepare("SELECT status FROM autopilot_jobs").get(),
    ).toEqual({ status: "error" });
  } finally {
    f.cleanup();
  }
});
