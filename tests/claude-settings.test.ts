import { afterEach, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fixture } from "./helpers.js";
import * as workers from "../src/workers/index.js";
import { dispatch } from "../src/core/dispatch.js";
import { claude, command } from "../src/workers/index.js";
import { detectIdentity } from "../src/workers/identity.js";
import { claudeReviewerArgs, reviewerCommand } from "../src/core/autopilot.js";

let f: ReturnType<typeof fixture>;
afterEach(() => {
  f?.cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const ctx = { worktree: "/w", promptFile: "/p", runDir: "/r" };
const setting = (args: string[]) =>
  JSON.parse(args[args.indexOf("--settings") + 1]!);

it("defaults Claude worker and reviewer to opus, max and fast, retaining reviewer isolation", () => {
  f = fixture();
  expect(claude.command(ctx).args.slice(1)).toEqual([
    "/w",
    "/p",
    "opus",
    "max",
    "true",
    "45",
  ]);
  const args = claudeReviewerArgs(f.repo);
  expect(args.slice(-4)).toEqual(["--model", "opus", "--effort", "max"]);
  expect(setting(args)).toEqual({ disableAllHooks: true, fastMode: true });
  expect(args).toContain("--strict-mcp-config");
  f.repo.setSetting("reviewer", "claude");
  expect(reviewerCommand(f.repo, "/w", "/r").args).toEqual(args);
  expect(detectIdentity("claude", {}, "")).toEqual({
    kind: "claude",
    model: "opus",
    label: "Claude (opus, max, fast)",
  });
});

it("validates and persists independent worker and reviewer controls", () => {
  f = fixture();
  for (const key of ["worker_fast_mode", "reviewer_fast_mode"]) {
    expect(f.repo.getSetting(key)).toBe("1");
    expect(() => f.repo.setSetting(key, "true")).toThrow();
    f.repo.setSetting(key, "0");
  }
  for (const key of ["worker_effort", "reviewer_effort"]) {
    for (const value of ["low", "medium", "high", "xhigh", "max"])
      f.repo.setSetting(key, value);
    expect(() => f.repo.setSetting(key, "extreme")).toThrow();
  }
  expect(() => f.repo.setSetting("reviewer_model", "bad")).toThrow();
  f.repo.setSetting("reviewer_model", "sonnet");
  f.repo.setSetting("reviewer_effort", "high");
  const args = claudeReviewerArgs(f.repo);
  expect(args.slice(-4)).toEqual(["--model", "sonnet", "--effort", "high"]);
  expect(setting(args).fastMode).toBe(false);
  expect(
    claude
      .command({
        ...ctx,
        model: "sonnet",
        effort: "low",
        fast: false,
        timeoutMin: 60,
      })
      .args.slice(-4),
  ).toEqual(["sonnet", "low", "false", "60"]);
  expect(
    detectIdentity(
      "claude",
      { model: "sonnet", effort: "low", fast: false },
      "",
    ).label,
  ).toBe("Claude (sonnet, low)");
});

it("environment overrides both commands and the recorded identity", () => {
  f = fixture();
  vi.stubEnv("AAM_CLAUDE_MODEL", "haiku");
  vi.stubEnv("AAM_CLAUDE_EFFORT", "xhigh");
  vi.stubEnv("AAM_CLAUDE_FAST", "false");
  expect(
    claude.command({ ...ctx, model: "opus", effort: "high" }).args.slice(-4),
  ).toEqual(["haiku", "xhigh", "false", "45"]);
  expect(claudeReviewerArgs(f.repo).slice(-4)).toEqual([
    "--model",
    "haiku",
    "--effort",
    "xhigh",
  ]);
  expect(setting(claudeReviewerArgs(f.repo)).fastMode).toBe(false);
  expect(detectIdentity("claude", { model: "opus" }, "").label).toBe(
    "Claude (haiku, xhigh)",
  );
});

it("worker script passes settings, stdin and the configured alarm to a stub executable", () => {
  f = fixture();
  const home = join(f.repo.home, "stub-home");
  const bin = join(home, ".local/bin");
  mkdirSync(bin, { recursive: true });
  const out = join(home, "args");
  // The injected absolute executable prevents tests from invoking an installed Claude.
  writeFileSync(
    join(bin, "claude"),
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$HOME/args"\ncat > "$HOME/input"\n',
    { mode: 0o755 },
  );
  const prompt = join(home, "prompt");
  writeFileSync(prompt, "task with $(literal) text");
  const script = resolve("scripts/claude-worker.sh");
  const result = spawnSync(
    "sh",
    [script, home, prompt, "sonnet", "high", "false", "60"],
    {
      env: {
        HOME: home,
        PATH: "/usr/bin:/bin",
        AAM_FAKE_CLAUDE: join(bin, "claude"),
      },
      encoding: "utf8",
    },
  );
  expect(result.status, result.stderr).toBe(0);
  const args = readFileSync(out, "utf8").trim().split("\n");
  expect(args.slice(0, 7)).toEqual([
    "-p",
    "--model",
    "sonnet",
    "--effort",
    "high",
    "--settings",
    '{"fastMode":false}',
  ]);
  expect(readFileSync(join(home, "input"), "utf8")).toBe(
    "task with $(literal) text",
  );
  writeFileSync(join(bin, "claude"), "#!/bin/sh\nexec sleep 10\n", {
    mode: 0o755,
  });
  const timed = spawnSync(
    "sh",
    [script, home, prompt, "opus", "max", "true", "0.02"],
    {
      env: {
        HOME: home,
        PATH: "/usr/bin:/bin",
        AAM_FAKE_CLAUDE: join(bin, "claude"),
      },
      timeout: 4000,
      stdio: "ignore",
    },
  );
  expect(timed.error).toBeUndefined();
  expect(timed.signal).toBe("SIGALRM");
});

it("changing reviewer or Claude controls resets only health, preserving saved settings", () => {
  f = fixture();
  f.repo.setSetting("reviewer_model", "sonnet");
  f.repo.setSetting("reviewer_effort", "low");
  f.repo.setSetting("reviewer_fast_mode", "0");
  f.repo.setSetting("reviewer_ok", "1");
  f.repo.setSetting("reviewer", "codex");
  expect(f.repo.getSetting("reviewer_ok")).toBe("");
  expect(f.repo.getSetting("reviewer_model")).toBe("sonnet");
  expect(f.repo.getSetting("reviewer_effort")).toBe("low");
  expect(f.repo.getSetting("reviewer_fast_mode")).toBe("0");
  f.repo.setSetting("reviewer_ok", "1");
  f.repo.setSetting("reviewer_effort", "max");
  expect(f.repo.getSetting("reviewer_ok")).toBe("");
});

it("the managed Claude script override receives saved controls and records actual identity", () => {
  vi.stubEnv("AAM_FAKE_WORKER", resolve("scripts/claude-worker.sh"));
  const configured = {
    ...ctx,
    model: "gpt-5.6-sol",
    effort: "high" as const,
    fast: false,
    timeoutMin: 60,
  };
  expect(command("codex", configured).args.slice(-4)).toEqual([
    "opus",
    "high",
    "false",
    "60",
  ]);
  expect(detectIdentity("codex", configured).label).toBe(
    "Claude (opus, high)",
  );
});

it("dispatch passes saved worker effort, fast mode and timeout to the adapter", () => {
  f = fixture();
  f.repo.setSetting("coding_executor", "claude-opus");
  f.repo.setSetting("worker_effort", "max");
  f.repo.setSetting("worker_fast_mode", "0");
  f.repo.setSetting("worker_timeout_min", "60");
  const spawn = vi.spyOn(workers, "spawnWorker");
  dispatch(f.repo, f.task().identifier);
  expect(spawn).toHaveBeenCalledWith(
    "claude",
    expect.objectContaining({
      model: "opus",
      effort: "max",
      fast: false,
      timeoutMin: 60,
    }),
  );
});
