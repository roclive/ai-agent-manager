import { afterEach, expect, it } from "vitest";
import { dispatch } from "../src/core/dispatch.js";
import { finalize } from "../src/core/finalize.js";
import {
  activeReservation,
  freezeProvider,
  providerCooldown,
  selectProvider,
} from "../src/core/providers.js";
import { parseUsage } from "../src/workers/openusage.js";
import { fixture, waitExit } from "./helpers.js";

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
