import { checkReviewer, healthSetting } from "./core/autopilot.js";
import { keepAwake } from "./core/keep-awake.js";
import { Cron } from "croner";
import { Repo, type Routine } from "./db/index.js";
import { tick } from "./core/tick.js";
import { runner } from "./core/process.js";
import { collectUsage, JsonOpenUsageProvider, FakeOpenUsageProvider } from "./workers/openusage.js";

export function validateRoutine(
  cron: string,
  action: string,
  payload: unknown,
) {
  if (typeof cron !== "string" || !cron.trim()) throw new Error("Invalid cron");
  const c = new Cron(cron, { paused: true });
  c.stop();
  if (!["heartbeat", "create_task", "shell", "collect_usage"].includes(action))
    throw new Error("Invalid routine action");
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Payload must be an object");
  const p = payload as Record<string, unknown>;
  if (action === "create_task" && (!p.project || !p.title))
    throw new Error("create_task requires project and title");
  if (
    action === "shell" &&
    (typeof p.cmd !== "string" || typeof p.cwd !== "string")
  )
    throw new Error("shell requires cmd and cwd");
  if (action === "collect_usage" && !p.provider)
    throw new Error("collect_usage requires provider");
}

export async function fireRoutine(repo: Repo, r: Routine) {
  try {
    repo.event(
      "routine_fire",
      JSON.stringify({ routine_id: r.id, name: r.name }),
    );
    const p = JSON.parse(r.payload);
    if (r.action === "heartbeat") tick(repo);
    else if (r.action === "create_task") {
      const t = repo.addTask(p);
      repo.event("routine", `${r.name} created ${t.identifier}`, t.id);
    } else if (r.action === "collect_usage") {
      const providerName = String(p.provider);
      let provider: any;
      if (providerName === "fake") {
        provider = new FakeOpenUsageProvider();
      } else if (p.json) {
        provider = new JsonOpenUsageProvider(providerName, String(p.json));
      } else {
        throw new Error(`Unsupported provider: ${providerName}`);
      }
      const snapshots = await collectUsage(repo, provider);
      repo.event("routine", `${r.name} collected ${snapshots.length} snapshots`);
    } else {
      const result = runner("sh", ["-c", p.cmd], p.cwd, undefined, 120000);
      repo.event(
        "routine",
        `${r.name} exit ${result.status}: ${(result.stdout + result.stderr).slice(-16000)}`,
      );
    }
  } catch (e) {
    repo.event("routine_error", `${r.name}: ${String(e)}`);
  } finally {
    repo.db
      .prepare("UPDATE routines SET last_run_at=? WHERE id=?")
      .run(new Date().toISOString(), r.id);
  }
}

export function daemon(repo: Repo, interval = 60) {
  if (!Number.isFinite(interval) || interval <= 0)
    throw new Error("Interval must be positive");
  return new Promise<void>((resolve) => {
    const awake = keepAwake(repo);
    let checking: Promise<unknown> | undefined;
    let stopped = false;
    const healthDue = () => {
      const at = Date.parse(healthSetting(repo, "checked_at") || "") || 0;
      const gap = healthSetting(repo, "ok") === "1" ? 30 * 60000 : 2 * 60000;
      return Date.now() - at >= gap;
    };
    const health = (force = false) => {
      if (checking || stopped || (!force && !healthDue())) return;
      checking = checkReviewer(repo)
        .catch((e) => repo.event("daemon_error", String(e)))
        .finally(() => {
          checking = undefined;
        });
    };
    health(true);
    const healthTimer = setInterval(() => health(), 30000);
    const jobs = new Map<number, { signature: string; job: Cron }>();
    const sync = () => {
      const enabled = repo.routines().filter((r) => r.enabled);
      for (const [id, { job, signature }] of jobs) {
        const r = enabled.find((x) => x.id === id);
        if (!r || JSON.stringify(r) !== signature) {
          job.stop();
          jobs.delete(id);
        }
      }
      for (const r of enabled) {
        if (!jobs.has(r.id)) {
          try {
            const job = new Cron(r.cron, function() {
              fireRoutine(repo, r).catch((e) => repo.event("routine_error", String(e)));
            });
            jobs.set(r.id, { signature: JSON.stringify(r), job });
          } catch (e) {
            repo.event("routine_error", String(e));
          }
        }
      }
    }
    const heartbeat = () => {
      try {
        awake.check();
        tick(repo);
        sync();
      } catch (e) {
        repo.event("daemon_error", String(e));
      }
    };
    const timer = setInterval(heartbeat, interval * 1000);
    const stop = async () => {
      stopped = true;
      clearInterval(healthTimer);
      clearInterval(timer);
      awake.stop();
      for (const { job } of jobs.values()) job.stop();
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      await checking;
      resolve();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    heartbeat();
  });
}
