import { afterEach, expect, it } from "vitest";
import { dispatch } from "../src/core/dispatch.js";
import { finalize } from "../src/core/finalize.js";
import { tick } from "../src/core/tick.js";
import { llmArgs, providerLlmArgs, readBackend } from "../src/core/llm.js";
import {
  activeReservation,
  freezeProvider,
  providerCooldown,
  selectProvider,
} from "../src/core/providers.js";
import { parseUsage } from "../src/workers/openusage.js";
import { fixture, waitExit } from "./helpers.js";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";

let f: ReturnType<typeof fixture>;
afterEach(() => f?.cleanup());

const policy = (providers: unknown[]) =>
  JSON.stringify({ version: 1, providers });
const provider = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  worker: "opencode",
  class: "free",
  legal: true,
  roles: ["any"],
  max_complexity: "medium",
  reserve_remaining: 0,
  reservation: { low: 1, medium: 1, high: 1 },
  ...patch,
});
const quota = (providerId: string, remaining: number | "unknown") =>
  parseUsage(
    JSON.stringify({
      schema_version: 1,
      snapshots: [
        {
          provider: providerId,
          type: "quota",
          window: "test",
          used:
            remaining === "unknown" ? "unknown" : Math.max(0, 10 - remaining),
          remaining,
          freshness: new Date().toISOString(),
        },
      ],
    }),
    "fixture",
  )[0];

it("rejects an explicitly empty provider allowlist instead of enabling legacy routing", () => {
  f = fixture();
  expect(() => f.repo.setSetting("provider_policy", policy([]))).toThrow(
    "provider_policy.providers must not be empty",
  );
  expect(f.repo.getSetting("provider_policy")).toBe("");

  // Protect dispatch even if an older database already contains this value.
  f.repo.db
    .prepare("UPDATE settings SET value=? WHERE key='provider_policy'")
    .run(policy([]));
  const task = f.task();
  expect(() => selectProvider(f.repo, task)).toThrow(
    "provider_policy.providers must not be empty",
  );
  expect(f.repo.runs(task.id)).toHaveLength(0);
});

it("validates the complete provider policy before persisting it", () => {
  f = fixture();
  const valid = policy([provider("free")]);
  f.repo.setSetting("provider_policy", valid);

  for (const invalid of [
    JSON.stringify({ version: 2, providers: [provider("free")] }),
    policy([provider("free", { roles: [] })]),
    policy([provider("free", { reserve_remaining: -1 })]),
    policy([provider("free", { reservation: { low: 1, medium: 1 } })]),
  ]) {
    expect(() => f.repo.setSetting("provider_policy", invalid)).toThrow();
    expect(f.repo.getSetting("provider_policy")).toBe(valid);
  }
});

it("keeps heartbeat services running when a legacy database contains a malformed policy", () => {
  f = fixture();
  f.repo.db
    .prepare("UPDATE settings SET value=? WHERE key='provider_policy'")
    .run(JSON.stringify({ version: 1, providers: "invalid" }));
  const task = f.task();

  expect(() => tick(f.repo)).not.toThrow();
  expect(f.repo.task(task.id).status).toBe("ready");
  expect(f.repo.runs(task.id)).toHaveLength(0);
  expect(
    f.repo
      .events(20)
      .some(
        (event: unknown) =>
          typeof event === "object" &&
          event !== null &&
          "kind" in event &&
          "message" in event &&
          event.kind === "quota_deferred" &&
          String(event.message).includes("provider_policy requires version 1"),
      ),
  ).toBe(true);
});

it("prefers legal free/local capability while unknown quota remains explicit and high work is reserved for premium", () => {
  f = fixture();
  f.repo.setSetting(
    "provider_policy",
    policy([
      provider("illegal", { legal: false }),
      provider("local", { class: "local" }),
      provider("premium", {
        class: "premium",
        max_complexity: "high",
        worker: "codex",
      }),
    ]),
  );
  const ordinary = f.task({ role: "testing", complexity: "low" });
  expect(selectProvider(f.repo, ordinary)).toMatchObject({
    id: "local",
    class: "local",
  });
  const high = f.task({ complexity: "high" });
  expect(selectProvider(f.repo, high)).toMatchObject({
    id: "premium",
    class: "premium",
  });
});

it("reserves before spawn so concurrent dispatch moves to a provider with available headroom", () => {
  f = fixture("sleep 30");
  f.repo.setSetting(
    "provider_policy",
    policy([
      provider("free", { reserve_remaining: 1 }),
      provider("premium", {
        class: "premium",
        max_complexity: "high",
        worker: "codex",
      }),
    ]),
  );
  f.repo.addUsageSnapshot(quota("free", 2));
  f.repo.addUsageSnapshot(quota("premium", 20));
  const first = f.task({ complexity: "low" });
  const second = f.task({ complexity: "low" });
  const firstRun = dispatch(f.repo, first.identifier);
  const secondRun = dispatch(f.repo, second.identifier);
  expect(f.repo.runs().find((run) => run.id === firstRun)?.provider).toBe(
    "free",
  );
  expect(f.repo.runs().find((run) => run.id === secondRun)?.provider).toBe(
    "premium",
  );
  expect(activeReservation(f.repo, "free")).toBe(1);
});

it("routes a policy-selected Ollama provider even while the legacy backend is primary", () => {
  f = fixture("sleep 30");
  f.repo.setSetting(
    "provider_policy",
    policy([
      provider("ollama", {
        worker: "codex",
        class: "local",
        max_complexity: "high",
      }),
    ]),
  );
  f.repo.setSetting("ollama_fallback_enabled", "0");
  f.repo.setSetting("llm_backend", "primary");
  const task = f.task();
  const runId = dispatch(f.repo, task.identifier);
  const run = f.repo.runs().find((candidate) => candidate.id === runId)!;
  const runDir = dirname(run.log_path);

  expect(llmArgs(f.repo)).toEqual([]);
  expect(llmArgs(f.repo, "ollama")).toContain('model_provider="aam-fallback"');
  expect(providerLlmArgs(f.repo, "ollama")).toEqual(llmArgs(f.repo, "ollama"));
  expect(readBackend(runDir)).toBe("ollama");
  expect(
    JSON.parse(readFileSync(`${runDir}/backend.json`, "utf8")),
  ).toMatchObject({ backend: "ollama", provider: "ollama" });
  expect(run).toMatchObject({ worker: "codex", provider: "ollama" });
});

it("scopes 429 cooldown to one provider and safely retries in the same worktree without consuming attempts", async () => {
  f = fixture('echo "Error: 429 quota exceeded"; exit 1');
  f.repo.setSetting(
    "provider_policy",
    policy([
      provider("free"),
      provider("premium", {
        class: "premium",
        max_complexity: "high",
        worker: "codex",
      }),
    ]),
  );
  const task = f.task();
  const first = dispatch(f.repo, task.identifier);
  await waitExit(f.repo, first);
  finalize(
    f.repo,
    f.repo.runs().find((run) => run.id === first)!,
  );
  const after = f.repo.task(task.id);
  expect(after).toMatchObject({ status: "ready", attempts: 0 });
  expect(providerCooldown(f.repo, "free")).not.toBeNull();
  expect(providerCooldown(f.repo, "premium")).toBeNull();
  expect(f.repo.getSetting("cooldown_until")).toBe("");
  const retry = dispatch(f.repo, task.identifier);
  expect(f.repo.runs().find((run) => run.id === retry)).toMatchObject({
    provider: "premium",
  });
  expect(f.repo.task(task.id).worktree_path).toBe(after.worktree_path);
});

it("does not invoke legacy global fallback for a configured provider 429", async () => {
  f = fixture('echo "Error: 429 quota exceeded"; exit 1');
  f.repo.setSetting("ollama_fallback_enabled", "1");
  f.repo.setSetting("llm_backend", "primary");
  f.repo.setSetting("reviewer_ok", "1");
  f.repo.setSetting("reviewer_checked_at", "preserved");
  f.repo.setSetting(
    "provider_policy",
    policy([
      provider("free"),
      provider("ollama", {
        worker: "codex",
        class: "local",
        max_complexity: "high",
      }),
    ]),
  );
  const task = f.task();
  const runId = dispatch(f.repo, task.identifier);
  await waitExit(f.repo, runId);
  finalize(
    f.repo,
    f.repo.runs().find((run) => run.id === runId)!,
  );

  expect(f.repo.getSetting("llm_backend")).toBe("primary");
  expect(f.repo.getSetting("reviewer_ok")).toBe("1");
  expect(f.repo.getSetting("reviewer_checked_at")).toBe("preserved");
  expect(providerCooldown(f.repo, "free")).not.toBeNull();
  expect(providerCooldown(f.repo, "ollama")).toBeNull();
  expect(
    f.repo
      .events(50)
      .some(
        (event: unknown) =>
          typeof event === "object" &&
          event !== null &&
          "kind" in event &&
          event.kind === "llm_fallback",
      ),
  ).toBe(false);
});

it("recovers an expired provider breaker and reports all-provider failure without blocking the task", () => {
  f = fixture();
  f.repo.setSetting("provider_policy", policy([provider("free")]));
  const task = f.task();
  f.repo.addUsageSnapshot(quota("free", 0));
  expect(() => dispatch(f.repo, task.identifier)).toThrow(
    "No provider available",
  );
  expect(f.repo.task(task.id).status).toBe("ready");
  f.repo.addUsageSnapshot(quota("free", 10));
  freezeProvider(f.repo, "free", "test", -1);
  expect(providerCooldown(f.repo, "free")).toBeNull();
  expect(() => dispatch(f.repo, task.identifier)).not.toThrow();
});
