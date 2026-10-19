import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "../src/core/dispatch.js";
import {
  MANAGER_BACKENDS,
  RulesBackend,
  managerBackend,
  type ManagerBackend,
} from "../src/core/manager-backend.js";
import { resolveExecutor, selectExecutor } from "../src/core/executors.js";
import { selectProvider } from "../src/core/providers.js";
import { tick } from "../src/core/tick.js";
import { fixture } from "./helpers.js";

let f: ReturnType<typeof fixture>;
afterEach(() => f?.cleanup());

describe("manager decision backends", () => {
  it("defaults to rules and validates every pluggable backend name", () => {
    f = fixture();
    expect(f.repo.getSetting("manager_backend")).toBe("rules");
    for (const name of MANAGER_BACKENDS) {
      expect(() => f.repo.setSetting("manager_backend", name)).not.toThrow();
      expect(managerBackend(f.repo).name).toBe(name);
    }
    expect(() => f.repo.setSetting("manager_backend", "remote-magic")).toThrow(
      "Invalid setting value",
    );
  });

  it("preserves the old priority order and executor routing in RulesBackend", () => {
    f = fixture();
    const low = f.task({ priority: "P2", worker: "opencode" });
    const high = f.task({ priority: "P0", worker: "codex" });
    const candidates = f.repo.tasks({ status: "ready" });
    const decision = new RulesBackend().decide(candidates, { repo: f.repo });
    expect(decision.task.id).toBe(high.id);
    expect(decision.worker).toMatchObject({ id: "codex", worker: "codex" });
    expect(decision.reason).toContain("first eligible candidate");
    expect(decision.task.id).not.toBe(low.id);
  });

  it.each(["auto", "codex", "opencode", "claude"] as const)(
    "matches pre-abstraction routing for executor %s",
    (executor) => {
      f = fixture();
      f.repo.setSetting("coding_executor", executor);
      const task = f.task({ worker: "opencode" });
      const effective = resolveExecutor(f.repo, task);
      const previous = effective.value !== "auto"
        ? selectExecutor(f.repo, effective)
        : selectProvider(f.repo, task);
      expect(new RulesBackend().decide([task], { repo: f.repo }).worker).toEqual(previous);
    },
  );

  it("makes direct dispatch call the injected decision interface", () => {
    f = fixture();
    const task = f.task();
    const rules = new RulesBackend();
    const decide = vi.fn(rules.decide.bind(rules));
    const backend: ManagerBackend = { name: "rules", decide };
    dispatch(f.repo, task.identifier, false, backend);
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide.mock.calls.every(([tasks]) => tasks[0]?.id === task.id)).toBe(true);
    expect(f.repo.events().some((event) => (event as { kind: string }).kind === "manager_decision")).toBe(true);
  });

  it("lets tick choose among eligible candidates through the interface", () => {
    f = fixture();
    f.repo.setSetting("max_parallel", "1");
    const first = f.task({ priority: "P0" });
    const chosen = f.task({ priority: "P2" });
    const rules = new RulesBackend();
    const backend: ManagerBackend = {
      name: "rules",
      decide(candidates, context) {
        const reordered =
          candidates.length > 1
            ? [candidates.find((task) => task.id === chosen.id)!, ...candidates]
            : candidates;
        return rules.decide(reordered, context);
      },
    };
    tick(f.repo, undefined, backend);
    expect(f.repo.task(chosen.id).status).toBe("in_progress");
    expect(f.repo.task(first.id).status).toBe("ready");
  });
  it("defers unavailable routing and still dispatches the next candidate", () => {
    f = fixture();
    const unavailable = f.task({ priority: "P0" });
    const available = f.task({ priority: "P1" });
    const rules = new RulesBackend();
    const backend: ManagerBackend = {
      name: "rules",
      decide(candidates, context) {
        if (candidates[0]?.id === unavailable.id) throw new Error("No provider available");
        return rules.decide(candidates, context);
      },
    };
    expect(() => tick(f.repo, undefined, backend)).not.toThrow();
    expect(f.repo.task(unavailable.id).status).toBe("ready");
    expect(f.repo.task(unavailable.id).attempts).toBe(0);
    expect(f.repo.task(available.id).status).toBe("in_progress");
  });

  it("rechecks resolution eligibility after starting another task", () => {
    f = fixture();
    const first = f.task({ priority: "P0" });
    const resolution = f.task({ priority: "P1", resolves_task_id: first.id });
    tick(f.repo);
    expect(f.repo.task(first.id).status).toBe("in_progress");
    expect(f.repo.task(resolution.id).status).toBe("ready");
    expect(f.repo.task(resolution.id).attempts).toBe(0);
  });

});
