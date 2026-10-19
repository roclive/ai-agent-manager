import { afterEach, expect, it } from "vitest";
import { fixture, waitExit } from "./helpers.js";
import { dispatch } from "../src/core/dispatch.js";
import { tick } from "../src/core/tick.js";
import { review } from "../src/core/review.js";
import { freezeProvider, providerCooldown } from "../src/core/providers.js";
import {
  executorHost,
  executorsView,
  resolveExecutor,
} from "../src/core/executors.js";
import { claude, codex, hermes, pi, command } from "../src/workers/index.js";
import { providerLlmArgs } from "../src/core/llm.js";
import { detectIdentity } from "../src/workers/identity.js";
import { QuotaUnavailableError } from "../src/core/usage.js";

let f: ReturnType<typeof fixture>;
afterEach(() => f?.cleanup());

it("resolves executor task > project > global > auto", () => {
  f = fixture();
  const t = f.task();
  expect(resolveExecutor(f.repo, t)).toEqual({ value: "auto", source: "global" });
  f.repo.setSetting("coding_executor", "codex");
  expect(resolveExecutor(f.repo, t)).toEqual({ value: "codex-sol", source: "global" });
  f.repo.updateProject("T", { coding_executor: "claude" });
  expect(resolveExecutor(f.repo, t)).toEqual({ value: "claude", source: "project" });
  const t2 = f.repo.updateTask(t.id, { executor: "pi" });
  expect(resolveExecutor(f.repo, t2)).toEqual({ value: "pi", source: "task" });
  expect(() => f.repo.setSetting("coding_executor", "nope")).toThrow();
  expect(() => f.repo.updateTask(t.id, { executor: "nope" })).toThrow();
  expect(() => f.repo.setSetting("executor_fallback", "claude,x")).toThrow();
});

it("auto-review reject redispatches to the selected executor, never Codex", () => {
  f = fixture();
  f.repo.setSetting("coding_executor", "claude");
  const t = f.task({ worker: "codex" });
  for (let i = 0; i < 2; i++) {
    const id = dispatch(f.repo, t.identifier);
    f.repo.db.prepare("UPDATE runs SET status='failed' WHERE id=?").run(id);
    f.repo.updateTask(t.id, { status: "in_review" });
    review(f.repo, t.identifier, "reject", "fix");
  }
  dispatch(f.repo, t.identifier);
  const runs = f.repo.runs();
  expect(runs).toHaveLength(3);
  expect(runs.every((r) => r.worker === "claude" && r.provider === "claude")).toBe(true);
});

it("cooldown is scoped per executor", () => {
  f = fixture();
  freezeProvider(f.repo, "codex", "limit");
  f.repo.setSetting("coding_executor", "codex");
  const a = f.task();
  expect(() => dispatch(f.repo, a.identifier)).toThrow(QuotaUnavailableError);
  expect(f.repo.task(a.id).status).toBe("ready");
  // Claude is unaffected, even with the legacy global cooldown set.
  f.repo.setSetting("cooldown_until", new Date(Date.now() + 60000).toISOString());
  const b = f.task({ executor: "claude" });
  expect(() => dispatch(f.repo, b.identifier)).not.toThrow();
  expect(providerCooldown(f.repo, "claude")).toBeNull();
  // auto still honours the legacy global cooldown
  const c = f.task({ executor: "auto" });
  expect(() => dispatch(f.repo, c.identifier)).toThrow(/cooldown/);
});

it("follows executor_fallback only when the user listed it", () => {
  f = fixture();
  freezeProvider(f.repo, "codex", "limit");
  f.repo.setSetting("coding_executor", "codex");
  const t = f.task();
  expect(() => dispatch(f.repo, t.identifier)).toThrow(QuotaUnavailableError);
  f.repo.setSetting("executor_fallback", "claude");
  const id = dispatch(f.repo, t.identifier);
  expect(f.repo.runs().find((r) => r.id === id)!.provider).toBe("claude");
});

it("tick dispatches with the explicit executor while another is cooling down", async () => {
  f = fixture();
  freezeProvider(f.repo, "codex", "limit");
  f.repo.updateProject("T", { coding_executor: "claude" });
  f.task();
  tick(f.repo);
  const run = f.repo.runs()[0];
  expect(run.provider).toBe("claude");
  await waitExit(f.repo, run.id);
});

it("a rate-limited explicit executor sets only its own breaker", async () => {
  f = fixture('echo "Error: 429 quota exceeded"; exit 1');
  f.repo.setSetting("coding_executor", "claude");
  const t = f.task();
  const id = dispatch(f.repo, t.identifier);
  await waitExit(f.repo, id);
  tick(f.repo);
  expect(f.repo.runs()[0].status).toBe("rate_limited");
  expect(providerCooldown(f.repo, "claude")).not.toBeNull();
  expect(providerCooldown(f.repo, "codex")).toBeNull();
  expect(f.repo.getSetting("cooldown_until")).toBe("");
});

it("uninstalled executors are reported and never dispatched", () => {
  f = fixture();
  const real = executorHost.which;
  executorHost.which = (b) => b !== "hermes";
  delete process.env.AAM_FAKE_WORKER;
  try {
    const v = executorsView(f.repo).executors.find((e) => e.id === "hermes")!;
    expect(v.installed).toBe(false);
    expect(v.install_hint).toContain("hermes");
    f.repo.setSetting("coding_executor", "hermes");
    const t = f.task();
    expect(() => dispatch(f.repo, t.identifier)).toThrow(/not installed/);
  } finally {
    executorHost.which = real;
  }
});

it("builds pi, hermes and claude adapter commands", () => {
  delete process.env.AAM_FAKE_WORKER;
  const ctx = { worktree: "/w", promptFile: "/r/prompt.md", runDir: "/r" };
  const p = pi.command(ctx);
  expect(p.cmd).toBe("pi");
  expect(p.args).toContain("-p");
  expect(p.args).toContain("@/r/prompt.md");
  const h = hermes.command(ctx);
  expect(h.args.join(" ")).toContain("hermes chat --quiet -q");
  expect(h.args).toContain("/r/prompt.md");
  const c = claude.command(ctx);
  expect(c.args.slice(1)).toEqual(["/w", "/r/prompt.md", "sonnet", "default"]);
  expect(c.args[0]).toMatch(/scripts\/claude-worker\.sh$/);
  expect(command("pi", ctx).cmd).toBe("pi");
  expect(() => command("nope", ctx)).toThrow();
});

it("passes worker effort as separate CLI arguments and leaves defaults unchanged", () => {
  delete process.env.AAM_FAKE_WORKER;
  const ctx = { worktree: "/w", promptFile: "/r/prompt.md", runDir: "/r" };
  const defaultCodex = codex.command(ctx).args;
  expect(defaultCodex.some((arg) => arg.includes("model_reasoning_effort"))).toBe(false);
  expect(codex.command({ ...ctx, effort: "high" }).args).toContain(
    'model_reasoning_effort="high"',
  );
  expect(claude.command({ ...ctx, model: "opus", effort: "medium" }).args.slice(-4))
    .toEqual(["/w", "/r/prompt.md", "opus", "medium"]);
});

it("persists supported effort and only dispatches it to Claude or Codex", () => {
  f = fixture();
  f.repo.setSetting("worker_effort", "high");
  expect(executorsView(f.repo).worker_effort).toBe("high");
  expect(() => f.repo.setSetting("worker_effort", "max")).toThrow(/Invalid worker effort/);
  expect(executorsView(f.repo).executors.find((e) => e.id === "claude")?.effort_supported)
    .toBe(true);
  expect(executorsView(f.repo).executors.find((e) => e.id === "opencode")?.effort_supported)
    .toBe(false);
});

it("model variants build the right command, identity and accounting", () => {
  f = fixture();
  const cases = [
    ["codex-sol", "codex", "codex", "gpt-6.1-sol"],
    ["codex-luna", "codex", "codex", "gpt-5.6-luna"],
    ["claude-opus", "claude", "claude", "opus"],
    ["claude", "claude", "claude", "sonnet"],
  ] as const;
  for (const [executor, worker, provider, model] of cases) {
    const t = f.task({ executor });
    const id = dispatch(f.repo, t.identifier);
    const run = f.repo.runs().find((r) => r.id === id)!;
    expect(run.worker).toBe(worker);
    expect(run.provider).toBe(provider);
    const routed = f.repo.db
      .prepare("SELECT message FROM events WHERE kind='route_selected' AND task_id=?")
      .get(t.id) as { message: string };
    expect(JSON.parse(routed.message).model).toBe(model);
    // The fake worker declares its own identity; the real one reports the selected model.
    const real = detectIdentity(worker, { model }, "");
    expect(real.model).toBe(model);
  }
  delete process.env.AAM_FAKE_WORKER;
  const ctx = { worktree: "/w", promptFile: "/p", runDir: "/r" };
  const sol = command("codex", { ...ctx, modelArgs: providerLlmArgs(f.repo, "codex", "gpt-6.1-sol") });
  expect(sol.args).toContain("--model");
  expect(sol.args[sol.args.indexOf("--model") + 1]).toBe("gpt-6.1-sol");
  const luna = command("codex", { ...ctx, modelArgs: providerLlmArgs(f.repo, "codex", "gpt-5.6-luna") });
  expect(luna.args).toContain("--model");
  expect(luna.args[luna.args.indexOf("--model") + 1]).toBe("gpt-5.6-luna");
  const opus = command("claude", { ...ctx, model: "opus" });
  expect(opus.args.slice(-4)).toEqual(["/w", "/p", "opus", "default"]);
});

it("legacy codex ids alias to Codex (Sol) and the API lists distinct variants", () => {
  f = fixture();
  const t = f.task({ executor: "codex" });
  expect(resolveExecutor(f.repo, t).value).toBe("codex-sol");
  f.repo.setSetting("executor_fallback", "codex,claude-opus");
  const view = executorsView(f.repo);
  expect(view.executor_fallback).toEqual(["codex-sol", "claude-opus"]);
  const byId = Object.fromEntries(view.executors.map((e) => [e.id, e]));
  expect(byId["codex-sol"].label).toBe("Codex (Sol)");
  expect(byId["codex-luna"].label).toBe("Codex (Luna)");
  expect(byId["claude-opus"].label).toBe("Claude (Opus)");
  expect(byId["claude"].label).toBe("Claude (Sonnet)");
  f.repo.setSetting("coding_executor", "codex-luna");
  expect(f.repo.getSetting("coding_executor")).toBe("codex-luna");
  f.repo.updateProject("T", { coding_executor: "claude-opus" });
  expect(resolveExecutor(f.repo, t.executor ? { ...t, executor: "" } : t)).toEqual({ value: "claude-opus", source: "project" });
});
