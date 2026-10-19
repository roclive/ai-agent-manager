import { afterEach, expect, it } from "vitest";
import { dispatch } from "../src/core/dispatch.js";
import { finalize } from "../src/core/finalize.js";
import { review } from "../src/core/review.js";
import { tick } from "../src/core/tick.js";
import { freezeProvider, providerCooldown } from "../src/core/providers.js";
import { parseUsage } from "../src/workers/openusage.js";
import { fixture, waitExit } from "./helpers.js";

let f: ReturnType<typeof fixture>;
afterEach(() => f?.cleanup());

const rule = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  worker: "opencode",
  class: "free",
  legal: true,
  roles: ["any"],
  max_complexity: "high",
  reserve_remaining: 0,
  reservation: { low: 1, medium: 1, high: 1 },
  ...patch,
});
const quota = (provider: string, remaining: number) =>
  parseUsage(
    JSON.stringify({
      schema_version: 1,
      snapshots: [
        {
          provider,
          type: "quota",
          window: "drill",
          used: Math.max(0, 10 - remaining),
          remaining,
          freshness: new Date().toISOString(),
        },
      ],
    }),
    "fixture",
  )[0];
const finish = async (id: number) => {
  await waitExit(f.repo, id);
  finalize(f.repo, f.repo.runs().find((r) => r.id === id)!);
};
const providerOf = (id: number) =>
  f.repo.runs().find((r) => r.id === id)?.provider;

it("rolls cloud-exhausted → opencode free → local → cooldown recovery with fake runners, losing no task and never double-running", async () => {
  // Fake worker: emits a 429 only while AAM_DRILL_FAIL is set.
  f = fixture(
    'if [ -n "$AAM_DRILL_FAIL" ]; then echo "Error: 429 quota exceeded"; exit 1; fi\n' +
      "printf changed > changed.txt\nexit 0",
  );
  f.repo.setSetting(
    "provider_policy",
    JSON.stringify({
      version: 1,
      providers: [
        rule("cloud"),
        rule("free"),
        rule("ollama", { worker: "codex", class: "local" }),
      ],
    }),
  );
  // 1. cloud has no remaining quota → skipped, free opencode takes it.
  f.repo.addUsageSnapshot(quota("cloud", 0));
  f.repo.addUsageSnapshot(quota("free", 5));
  f.repo.addUsageSnapshot(quota("ollama", 5));
  const t1 = f.task();
  const r1 = dispatch(f.repo, t1.identifier);
  expect(providerOf(r1)).toBe("free");
  expect(() => dispatch(f.repo, t1.identifier)).toThrow(/already running/);
  await finish(r1);
  expect(f.repo.task(t1.id).status).toBe("in_review");

  // 2. free gets rate-limited mid-night → task stays ready (no attempt used),
  //    freeze scoped to free only, local ollama picks it up.
  process.env.AAM_DRILL_FAIL = "1";
  const t2 = f.task();
  const r2 = dispatch(f.repo, t2.identifier);
  expect(providerOf(r2)).toBe("free");
  await finish(r2);
  delete process.env.AAM_DRILL_FAIL;
  expect(f.repo.task(t2.id)).toMatchObject({ status: "ready", attempts: 0 });
  expect(providerCooldown(f.repo, "free")).not.toBeNull();
  expect(providerCooldown(f.repo, "ollama")).toBeNull();
  const r3 = dispatch(f.repo, t2.identifier);
  expect(providerOf(r3)).toBe("ollama");
  await finish(r3);
  expect(f.repo.task(t2.id).status).toBe("in_review");

  // 3. review data survives; approving both completes them exactly once.
  review(f.repo, t1.identifier, "approve", "ok");
  review(f.repo, t2.identifier, "approve", "ok");
  expect(f.repo.task(t1.id).status).toBe("done");
  expect(f.repo.task(t2.id).status).toBe("done");

  // 4. cooldown expires and cloud quota is refreshed → routing recovers.
  freezeProvider(f.repo, "free", "drill expiry", -1);
  expect(providerCooldown(f.repo, "free")).toBeNull();
  f.repo.addUsageSnapshot(quota("cloud", 8));
  const t3 = f.task();
  const r4 = dispatch(f.repo, t3.identifier);
  expect(providerOf(r4)).toBe("cloud");
  await finish(r4);

  // 5. A tick over the whole state must not re-dispatch or duplicate anything.
  const before = f.repo.runs().length;
  const tasks = f.repo.tasks().map((t) => [t.identifier, t.status]);
  tick(f.repo);
  tick(f.repo);
  expect(f.repo.runs()).toHaveLength(before);
  expect(f.repo.tasks().map((t) => [t.identifier, t.status])).toEqual(tasks);
  // Exactly one successful run per completed task; one 429 run kept as history.
  for (const t of [t1, t2, t3]) {
    const runs = f.repo.runs(t.id);
    expect(runs.filter((r) => r.status === "running")).toHaveLength(0);
  }
  expect(f.repo.runs(t2.id)).toHaveLength(2);
  expect(f.repo.runs(t1.id)).toHaveLength(1);
  const routes = f.repo
    .events(200)
    .filter((e: any) => e.kind === "route_selected" && e.task_id === t2.id);
  expect(routes).toHaveLength(2);
});
