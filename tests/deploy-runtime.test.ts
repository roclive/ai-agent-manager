import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  deployRuntime,
  DeployError,
  retargetPlist,
  type DeployDependencies,
} from "../src/core/deploy-runtime.js";
import { fixture } from "./helpers.js";

type Service = "ui" | "daemon" | "daemon-guard";
const all: Service[] = ["ui", "daemon", "daemon-guard"];

let f: ReturnType<typeof fixture> | undefined;
const extras: Database.Database[] = [];
afterEach(() => {
  for (const d of extras.splice(0)) if (d.open) d.close();
  if (f?.repo.db.open) f.cleanup();
  else if (f) rmSync(f.root, { recursive: true, force: true });
  f = undefined;
});

const tsStamp = "20261019T020000Z";
const now = () => new Date("2026-10-19T02:00:00.000Z");

function mark(home: string, value?: string) {
  const db = new Database(resolve(home, "aam.db"));
  try {
    if (value !== undefined)
      db.prepare(
        "INSERT INTO settings(key,value) VALUES('marker',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(value);
    return (
      db.prepare("SELECT value FROM settings WHERE key='marker'").get() as
        { value: string } | undefined
    )?.value;
  } finally {
    db.close();
  }
}

function plistBody(service: Service, runtime: string) {
  const args =
    service === "ui"
      ? ["serve", "--port", "3333"]
      : service === "daemon"
        ? ["daemon", "--interval", "7"]
        : ["guard", "--flag"];
  return `<plist><dict><key>Label</key><string>com.aam.${service}</string><key>ProgramArguments</key><array><string>/custom/node</string><string>${runtime}/node_modules/tsx/dist/loader.mjs</string><string>${runtime}/src/cli.ts</string>${args.map((a) => `<string>${a}</string>`).join("")}</array><key>WorkingDirectory</key><string>${runtime}</string><key>EnvironmentVariables</key><dict><key>CUSTOM_ENV</key><string>keep-me-${service}</string></dict></dict></plist>`;
}

function populateRuntime(dir: string) {
  mkdirSync(resolve(dir, "src"), { recursive: true });
  mkdirSync(resolve(dir, "node_modules/tsx/dist"), { recursive: true });
  writeFileSync(resolve(dir, "src/cli.ts"), "");
  writeFileSync(resolve(dir, "node_modules/tsx/dist/loader.mjs"), "");
}

function setup(opts: { skipGuard?: boolean; guardBody?: string } = {}) {
  f = fixture();
  const repo = f.repo;
  const userHome = resolve(f.root, "home");
  const oldRuntime = resolve(repo.home, "runtime/usage-reviewed");
  populateRuntime(oldRuntime);
  const dir = resolve(userHome, "Library/LaunchAgents");
  mkdirSync(dir, { recursive: true });
  const original: Record<string, string> = {};
  for (const s of all) {
    if (s === "daemon-guard" && opts.skipGuard) continue;
    original[s] =
      s === "daemon-guard" && opts.guardBody !== undefined
        ? opts.guardBody
        : plistBody(s, oldRuntime);
    writeFileSync(resolve(dir, `com.aam.${s}.plist`), original[s]);
  }
  mark(repo.home, "before");
  repo.setSetting("last_tick_at", "2026-10-19T00:00:00.000Z");
  const plistPath = (s: Service) => resolve(dir, `com.aam.${s}.plist`);
  const events: string[] = [];
  const loaded = new Set<Service>(all);
  const behavior = {
    failLoad: (_s: Service, _nth: number, _newRuntime: boolean) => false,
    stubbornUnload: new Set<Service>(),
    onLoad: (_s: Service, _newRuntime: boolean) => {},
  };
  const loads: Record<string, number> = {};
  const svcOf = (p: string) =>
    all.find((s) => p.endsWith(`com.aam.${s}.plist`))!;
  const run: DeployDependencies["run"] = (cmd, args) => {
    if (cmd !== "launchctl") return { status: 0, stdout: "", stderr: "" };
    const [op, arg] = args;
    if (op === "list") {
      const s = arg!.replace("com.aam.", "") as Service;
      return { status: loaded.has(s) ? 0 : 1, stdout: "", stderr: "" };
    }
    const s = svcOf(arg!);
    if (op === "unload") {
      events.push(`unload ${s}`);
      if (behavior.stubbornUnload.has(s))
        return { status: 1, stdout: "", stderr: "busy" };
      loaded.delete(s);
      return { status: 0, stdout: "", stderr: "" };
    }
    const newRuntime = !readFileSync(arg!, "utf8").includes("usage-reviewed");
    loads[s] = (loads[s] ?? 0) + 1;
    events.push(
      `load ${s} ${newRuntime ? "new" : "old"} db=${mark(repo.home)}`,
    );
    if (behavior.failLoad(s, loads[s]!, newRuntime))
      return { status: 5, stdout: "", stderr: "load boom" };
    loaded.add(s);
    behavior.onLoad(s, newRuntime);
    return { status: 0, stdout: "", stderr: "" };
  };
  const health: Record<string, (port?: number) => boolean> = {};
  const deps = (extra: DeployDependencies = {}): DeployDependencies => ({
    now,
    run,
    prepareRuntime: (target) => populateRuntime(target),
    uiHealthy: async (_t, port) => {
      events.push(`health ui ${port}`);
      return health.ui ? health.ui(port) : true;
    },
    daemonHealthy: async () => {
      events.push("health daemon");
      return health.daemon ? health.daemon() : true;
    },
    serviceHealthy: (s) => {
      events.push(`health ${s}`);
      return health[s] ? health[s]!() : true;
    },
    ...extra,
  });
  const opts2 = { sourceRoot: f.root, userHome, timeoutMs: 1 };
  return {
    repo,
    userHome,
    oldRuntime,
    original,
    plistPath,
    events,
    loaded,
    behavior,
    health,
    deps,
    opts: opts2,
    newRuntime: resolve(repo.home, `runtime/integration-${tsStamp}`),
    backup: resolve(repo.home, `backups/aam-${tsStamp}.db`),
    pre: resolve(repo.home, `backups/aam-${tsStamp}.pre-rollback.db`),
    read: (s: Service) => readFileSync(plistPath(s), "utf8"),
  };
}

/** Fails the first (new-runtime) daemon check, passes the post-rollback one. */
function failOnce() {
  let calls = 0;
  return async () => ++calls > 1;
}

function runningRun(repo: ReturnType<typeof fixture>["repo"], taskId: number) {
  repo.db
    .prepare(
      "INSERT INTO runs(task_id,worker,status,started_at,log_path,last_message_path) VALUES (?,?,'running',?,?,?)",
    )
    .run(taskId, "codex", new Date().toISOString(), "worker.log", "last.md");
}

/** The state the old stack must be back in after any rollback. */
function expectOldStack(t: ReturnType<typeof setup>) {
  for (const s of all) expect(t.read(s)).toBe(t.original[s]);
  expect(mark(t.repo.home)).toBe("before");
  expect(t.loaded).toEqual(new Set(all));
}

describe("runtime deployment", () => {
  it("prints a deterministic dry-run plan, port and problems without side effects", async () => {
    const t = setup({ skipGuard: true });
    const result = await deployRuntime(
      t.repo,
      { ...t.opts, dryRun: true },
      t.deps(),
    );
    expect(result.runtime).toBe(t.newRuntime);
    expect(result.port).toBe(3333);
    expect(result.problems.join()).toContain("com.aam.daemon-guard.plist");
    expect(t.events).toEqual([]);
    expect(existsSync(resolve(t.repo.home, "backups"))).toBe(false);
    expect(existsSync(resolve(t.repo.home, "deploy.lock"))).toBe(false);
  });

  it("switches services one at a time keeping arguments, env and port", async () => {
    const t = setup();
    const result = await deployRuntime(t.repo, t.opts, t.deps());
    for (const s of all) {
      expect(t.read(s)).toBe(retargetPlist(t.original[s]!, result.runtime));
      expect(t.read(s)).toContain(`keep-me-${s}`);
      expect(t.read(s)).not.toContain("usage-reviewed");
    }
    expect(t.read("ui")).toContain("<string>3333</string>");
    expect(t.read("daemon")).toContain("<string>--interval</string>");
    expect(t.events).toEqual([
      "unload ui",
      "load ui new db=before",
      "health ui 3333",
      "unload daemon",
      "load daemon new db=before",
      "health daemon",
      "unload daemon-guard",
      "load daemon-guard new db=before",
      "health daemon-guard",
    ]);
    const backup = new Database(result.backup, { readonly: true });
    expect(backup.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(
      (
        backup
          .prepare("SELECT value FROM settings WHERE key='marker'")
          .get() as { value: string }
      ).value,
    ).toBe("before");
    backup.close();
    expect(existsSync(resolve(t.repo.home, "deploy.lock"))).toBe(false);
  });

  it("takes a consistent backup that includes uncheckpointed WAL writes", async () => {
    const t = setup();
    const other = new Database(resolve(t.repo.home, "aam.db"));
    extras.push(other);
    other
      .prepare("UPDATE settings SET value='in-wal' WHERE key='marker'")
      .run();
    await deployRuntime(t.repo, t.opts, t.deps());
    const backup = new Database(t.backup, { readonly: true });
    expect(
      (
        backup
          .prepare("SELECT value FROM settings WHERE key='marker'")
          .get() as { value: string }
      ).value,
    ).toBe("in-wal");
    backup.close();
  });

  it("measures daemon health from a heartbeat taken after the old daemon stopped", async () => {
    const t = setup();
    const deps = t.deps();
    delete deps.daemonHealthy;
    // A load of the new daemon produces a newer heartbeat; the old value must not count.
    t.behavior.onLoad = (s) => {
      if (s === "daemon") {
        const db = new Database(resolve(t.repo.home, "aam.db"));
        db.prepare(
          "UPDATE settings SET value='2026-10-19T09:00:00.000Z' WHERE key='last_tick_at'",
        ).run();
        db.close();
      }
    };
    await deployRuntime(t.repo, { ...t.opts, timeoutMs: 600 }, deps);
    // And a daemon that never ticks is rejected and rolled back.
    const u = setup();
    const d2 = u.deps();
    delete d2.daemonHealthy;
    u.behavior.onLoad = (s, isNew) => {
      if (s === "daemon" && !isNew) {
        const db = new Database(resolve(u.repo.home, "aam.db"));
        db.prepare(
          "UPDATE settings SET value='2026-10-19T10:00:00.000Z' WHERE key='last_tick_at'",
        ).run();
        db.close();
      }
    };
    await expect(deployRuntime(u.repo, u.opts, d2)).rejects.toThrow(
      /daemon health check failed.*rolled back successfully/,
    );
    expectOldStack(u);
  });

  describe("pre-flight", () => {
    it("refuses while a worker is active unless forced", async () => {
      const t = setup();
      runningRun(t.repo, f!.task().id);
      await expect(deployRuntime(t.repo, t.opts, t.deps())).rejects.toThrow(
        "worker is active",
      );
      expect(t.events).toEqual([]);
      await deployRuntime(t.repo, { ...t.opts, force: true }, t.deps());
      expect(t.repo.runs()[0]?.status).toBe("running");
    });

    it("re-checks workers after long validation and stops before backup or any switch", async () => {
      const t = setup();
      const task = f!.task();
      await expect(
        deployRuntime(
          t.repo,
          t.opts,
          t.deps({
            prepareRuntime: (target) => {
              populateRuntime(target);
              runningRun(t.repo, task.id); // worker started during the build
            },
          }),
        ),
      ).rejects.toThrow("worker is active");
      expect(t.events).toEqual([]);
      expect(existsSync(t.backup)).toBe(false);
      expectOldStack(t);
      expect(existsSync(resolve(t.repo.home, "deploy.lock"))).toBe(false);
    });

    it("rejects a concurrent deployment, then lets a later one run; takes over a stale lock", async () => {
      const t = setup();
      let second: Promise<unknown> | undefined;
      await deployRuntime(
        t.repo,
        t.opts,
        t.deps({
          prepareRuntime: (target) => {
            populateRuntime(target);
            second = deployRuntime(
              t.repo,
              t.opts,
              t.deps({ now: () => new Date("2026-10-19T03:00:00.000Z") }),
            );
            second.catch(() => {});
          },
        }),
      );
      await expect(second).rejects.toThrow(/Another deployment is in progress/);
      expect(t.events.filter((e) => e.startsWith("load"))).toHaveLength(3);
      // the lock is gone and a stale one (dead pid) is replaced
      writeFileSync(resolve(t.repo.home, "deploy.lock"), "99999999");
      await deployRuntime(
        t.repo,
        t.opts,
        t.deps({ now: () => new Date("2026-10-19T04:00:00.000Z") }),
      );
    });

    it("releases the lock when the deployment fails", async () => {
      const t = setup();
      await expect(
        deployRuntime(
          t.repo,
          t.opts,
          t.deps({
            prepareRuntime: () => {
              throw new Error("build broke");
            },
          }),
        ),
      ).rejects.toThrow("build broke");
      expect(existsSync(resolve(t.repo.home, "deploy.lock"))).toBe(false);
    });

    it("fails before build, backup or migration when the guard plist is missing", async () => {
      const t = setup({ skipGuard: true });
      let prepared = false;
      await expect(
        deployRuntime(
          t.repo,
          t.opts,
          t.deps({
            prepareRuntime: () => {
              prepared = true;
            },
          }),
        ),
      ).rejects.toThrow(/Missing launchd plist.*daemon-guard/);
      expect(prepared).toBe(false);
      expect(existsSync(resolve(t.repo.home, "backups"))).toBe(false);
      expect(t.events).toEqual([]);
    });

    it("fails early when a plist has no runtime path to switch", async () => {
      const t = setup({
        guardBody: "<plist><string>/usr/bin/guard</string></plist>",
      });
      await expect(deployRuntime(t.repo, t.opts, t.deps())).rejects.toThrow(
        /daemon-guard.*no \.aam\/runtime/,
      );
      expect(existsSync(resolve(t.repo.home, "backups"))).toBe(false);
      expect(t.events).toEqual([]);
    });

    it("fails before backup when the new runtime lacks a path the plists reference", async () => {
      const t = setup();
      await expect(
        deployRuntime(
          t.repo,
          t.opts,
          t.deps({
            prepareRuntime: (target) => {
              populateRuntime(target);
              rmSync(resolve(target, "node_modules"), { recursive: true });
            },
          }),
        ),
      ).rejects.toThrow(/missing paths.*loader\.mjs/);
      expect(existsSync(t.backup)).toBe(false);
      expect(t.events).toEqual([]);
    });
  });

  describe("rollback", () => {
    // The "new runtime" writes to the database while it is being checked.
    function dirtyDb(t: ReturnType<typeof setup>) {
      const other = new Database(resolve(t.repo.home, "aam.db"));
      extras.push(other);
      t.behavior.onLoad = (s, isNew) => {
        if (isNew && s === "ui")
          other
            .prepare("UPDATE settings SET value='after' WHERE key='marker'")
            .run();
      };
    }

    it.each(all)(
      "restores everything when %s fails its health check",
      async (service) => {
        const t = setup();
        dirtyDb(t);
        let calls = 0;
        t.health[service] = () => ++calls > 1 || false; // fails first (new) check, passes after rollback
        const error = await deployRuntime(t.repo, t.opts, t.deps()).catch(
          (e) => e,
        );
        expect(error).toBeInstanceOf(DeployError);
        expect(error.message).toMatch(
          new RegExp(
            `${service} health check failed.*rolled back successfully`,
          ),
        );
        expect(error.rollback.ok).toBe(true);
        expectOldStack(t);
        // order: every service stopped, DB restored, only then old services loaded
        const firstOldLoad = t.events.findIndex((e) => e.includes(" old "));
        const lastNewLoad = t.events.findLastIndex((e) => e.includes(" new "));
        expect(firstOldLoad).toBeGreaterThan(lastNewLoad);
        const stopsBefore = t.events
          .slice(lastNewLoad, firstOldLoad)
          .filter((e) => e.startsWith("unload"));
        expect(stopsBefore.sort()).toEqual(
          all.map((s) => `unload ${s}`).sort(),
        );
        for (const e of t.events.filter((e) => e.includes(" old ")))
          expect(e).toMatch(/db=before/);
        // pre-restore DB (with the new runtime's writes) is retained
        expect(error.rollback.preRestoreDb).toBe(t.pre);
      },
    );

    it("keeps the pre-restore database including its WAL contents", async () => {
      const t = setup();
      dirtyDb(t);
      const error = await deployRuntime(
        t.repo,
        t.opts,
        t.deps({ daemonHealthy: failOnce() }),
      ).catch((e) => e);
      expect(error.rollback.ok).toBe(true);
      expect(existsSync(resolve(t.repo.home, "aam.db-wal"))).toBe(false);
      const kept = new Database(t.pre);
      expect(
        (
          kept
            .prepare("SELECT value FROM settings WHERE key='marker'")
            .get() as { value: string }
        ).value,
      ).toBe("after");
      kept.close();
      expectOldStack(t);
    });

    it("rolls back when loading a new service fails", async () => {
      const t = setup();
      dirtyDb(t);
      t.behavior.failLoad = (s, _n, isNew) => s === "daemon" && isNew;
      await expect(deployRuntime(t.repo, t.opts, t.deps())).rejects.toThrow(
        /load boom.*rolled back successfully/,
      );
      expectOldStack(t);
    });

    it("rolls back when writing a plist fails", async () => {
      const t = setup();
      dirtyDb(t);
      await expect(
        deployRuntime(
          t.repo,
          t.opts,
          t.deps({
            writeFile: (path, body) => {
              if (
                path.includes("daemon.plist") &&
                body.includes("integration-")
              )
                throw new Error("disk full");
              writeFileSync(path, body);
            },
          }),
        ),
      ).rejects.toThrow(/disk full.*rolled back successfully/);
      expectOldStack(t);
    });

    it("does not restore the DB or start services when a service cannot be stopped, and says so", async () => {
      const t = setup();
      dirtyDb(t);
      t.health.daemon = () => false;
      // after the switch the daemon refuses to unload and is still listed
      t.behavior.onLoad = (s, isNew) => {
        if (isNew && s === "daemon") t.behavior.stubbornUnload.add("daemon");
        if (isNew && s === "ui") mark(t.repo.home, "after");
      };
      const error = await deployRuntime(
        t.repo,
        t.opts,
        t.deps({ daemonHealthy: async () => false }),
      ).catch((e) => e);
      expect(error.message).toMatch(
        /ROLLBACK FAILED\/PARTIAL.*could not stop com\.aam\.daemon/,
      );
      expect(error.message).toMatch(/database NOT restored/);
      expect(error.rollback.ok).toBe(false);
      expect(mark(t.repo.home)).toBe("after");
      expect(t.events.filter((e) => e.includes(" old "))).toEqual([]);
      for (const s of all) expect(t.read(s)).toBe(t.original[s]); // config is restored
    });

    it("reports a failed database restore, keeps the pre-restore copy and leaves old services stopped", async () => {
      const t = setup();
      dirtyDb(t);
      const error = await deployRuntime(
        t.repo,
        t.opts,
        t.deps({
          daemonHealthy: async () => false,
          renameFile: (from, to) => {
            if (to.endsWith("aam.db")) throw new Error("rename denied");
            renameSync2(from, to);
          },
        }),
      ).catch((e) => e);
      expect(error.message).toMatch(
        /ROLLBACK FAILED\/PARTIAL.*restore database: rename denied/,
      );
      expect(error.message).toContain(t.pre);
      expect(existsSync(t.pre)).toBe(true);
      expect(t.events.filter((e) => e.includes(" old "))).toEqual([]);
      expect(error.rollback.errors.join()).toContain("left stopped");
    });

    it("reports old services that stay unhealthy after the rollback", async () => {
      const t = setup();
      dirtyDb(t);
      t.health.daemon = () => false; // before and after rollback
      const error = await deployRuntime(
        t.repo,
        t.opts,
        t.deps({ daemonHealthy: async () => false }),
      ).catch((e) => e);
      expect(error.message).toMatch(
        /ROLLBACK FAILED\/PARTIAL.*old daemon unhealthy after rollback/,
      );
      expect(mark(t.repo.home)).toBe("before");
    });

    it("reports failure to reload an old service", async () => {
      const t = setup();
      dirtyDb(t);
      t.behavior.failLoad = (s, _n, isNew) =>
        (s === "ui" && !isNew) || (s === "daemon" && isNew);
      const error = await deployRuntime(t.repo, t.opts, t.deps()).catch(
        (e) => e,
      );
      expect(error.message).toMatch(/ROLLBACK FAILED\/PARTIAL.*start ui/);
      expect(mark(t.repo.home)).toBe("before");
    });
  });
});

import { renameSync as renameSync2 } from "node:fs";
