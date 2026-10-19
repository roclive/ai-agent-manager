import { afterEach, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fixture, waitExit } from "./helpers.js";
import { dispatch } from "../src/core/dispatch.js";
import { finalize } from "../src/core/finalize.js";
import {
  checkReviewer,
  collectAutopilot,
  reviewerCommand,
} from "../src/core/autopilot.js";
import {
  llmArgs,
  llmBackend,
  quotaFallback,
  recordBackend,
} from "../src/core/llm.js";
import { codex } from "../src/workers/index.js";

let f: ReturnType<typeof fixture>;
afterEach(() => {
  f?.cleanup();
  delete process.env.AAM_FAKE_CODEX;
});
function setup() {
  f = fixture('echo "Error: usage limit reached" >&2\nexit 1');
  f.repo.setSetting("ollama_fallback_enabled", "1");
}
it("switches failed workers without attempts, isolates late primary failures and backs off fallback limits", async () => {
  setup();
  const a = f.task(),
    b = f.task();
  const ra = dispatch(f.repo, a.identifier),
    rb = dispatch(f.repo, b.identifier);
  await waitExit(f.repo, ra);
  await waitExit(f.repo, rb);
  finalize(f.repo, f.repo.runs(a.id)[0]!);
  expect(llmBackend(f.repo)).toBe("ollama");
  expect(f.repo.task(a.id)).toMatchObject({ status: "ready", attempts: 0 });
  finalize(f.repo, f.repo.runs(b.id)[0]!);
  expect(f.repo.getSetting("cooldown_until")).toBe("");
  const rc = dispatch(f.repo, a.identifier);
  expect(
    JSON.parse(
      readFileSync(
        resolve(f.repo.home, "runs", String(rc), "backend.json"),
        "utf8",
      ),
    ),
  ).toMatchObject({ backend: "ollama" });
  await waitExit(f.repo, rc);
  finalize(f.repo, f.repo.runs(a.id)[0]!);
  expect(Date.parse(f.repo.getSetting("cooldown_until")!)).toBeGreaterThan(
    Date.now(),
  );
  expect(f.repo.task(a.id).attempts).toBe(0);
  expect(
    f.repo.db.prepare("SELECT * FROM events WHERE kind='llm_fallback'").all(),
  ).toHaveLength(1);
});
it("isolates the primary Codex reviewer from local config and uses fallback only when selected", () => {
  setup();
  f.repo.setSetting("reviewer", "codex");
  f.repo.setSetting("primary_model", "gpt-5.6-sol");
  expect(llmArgs(f.repo)).toEqual([]);
  const primaryReviewer = reviewerCommand(f.repo, f.path, f.root);
  expect(primaryReviewer.args).toEqual(
    expect.arrayContaining([
      "--ignore-user-config",
      "--model",
      "gpt-5.6-sol",
    ]),
  );
  expect(primaryReviewer.args).not.toContain("--oss");
  quotaFallback(f.repo, "primary", "test quota");
  const args = llmArgs(f.repo);
  expect(args).toContain("gemma4:31b:cloud");
  expect(
    codex.command({
      worktree: f.path,
      runDir: f.root,
      promptFile: "prompt",
      modelArgs: args,
    }).args,
  ).toEqual(expect.arrayContaining(args));
  expect(reviewerCommand(f.repo, f.path, f.root)).toMatchObject({
    codex: true,
    args: expect.arrayContaining(args),
  });
  expect(reviewerCommand(f.repo, f.path, f.root).args).not.toContain(
    "--ignore-user-config",
  );
  for (const [key, value] of [
    ["llm_backend", "bad"],
    ["ollama_model", "bad model"],
    ["ollama_base_url", "file:///tmp/foo"],
    ["ollama_fallback_enabled", "yes"],
  ])
    expect(() => f.repo.setSetting(key!, value!)).toThrow();
  f.repo.setSetting("ollama_fallback_enabled", "0");
  expect(llmArgs(f.repo)).toEqual([]);
});
it("records an explicit primary provider independently of the legacy Ollama setting", () => {
  setup();
  f.repo.setSetting("llm_backend", "ollama");
  const dir = resolve(f.root, "explicit-primary");
  mkdirSync(dir);
  recordBackend(f.repo, dir, "codex");
  expect(
    JSON.parse(readFileSync(resolve(dir, "backend.json"), "utf8")),
  ).toMatchObject({
    backend: "primary",
    provider: "codex",
  });
});
it.each(["review", "plan"])(
  "switches rate-limited %s jobs and leaves tasks for retry",
  (kind) => {
    setup();
    f.repo.updateProject("T", { auto_review: 1, autopilot: 1, goal: "Build" });
    const task =
      kind === "review" ? f.task({ status: "in_review" }) : undefined;
    f.repo.db
      .prepare(
        "INSERT INTO autopilot_jobs(kind,project_id,task_id,started_at) VALUES (?,1,?,?)",
      )
      .run(kind, task?.id || null, new Date().toISOString());
    const dir = resolve(f.repo.home, "autopilot/1");
    mkdirSync(dir, { recursive: true });
    recordBackend(f.repo, dir);
    writeFileSync(
      resolve(dir, "result.json"),
      JSON.stringify({ status: 1, stderr: "Error: rate limit exceeded" }),
    );
    collectAutopilot(f.repo);
    expect(llmBackend(f.repo)).toBe("ollama");
    expect(f.repo.getSetting("cooldown_until")).toBe("");
    if (task)
      expect(f.repo.task(task.id)).toMatchObject({
        status: "in_review",
        attempts: 0,
      });
  },
);
it("switches on health-check quota failures and requires a fresh fallback health check", async () => {
  setup();
  f.repo.setSetting("reviewer", "codex");
  const file = resolve(f.root, "quota.sh");
  writeFileSync(
    file,
    '#!/bin/sh\ncat >/dev/null\necho "Error: usage limit reached" >&2\nexit 1\n',
    { mode: 0o755 },
  );
  process.env.AAM_FAKE_CODEX = file;
  expect((await checkReviewer(f.repo)).ok).toBe(false);
  expect(llmBackend(f.repo)).toBe("ollama");
  expect(f.repo.getSetting("reviewer_ok")).toBe("");
  expect(f.repo.getSetting("cooldown_until")).toBe("");
});
