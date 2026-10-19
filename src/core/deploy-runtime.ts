import Database from "better-sqlite3";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { Repo } from "../db/index.js";
import { alive, runner, type Runner } from "./process.js";

const services = ["ui", "daemon", "daemon-guard"] as const;
type Service = (typeof services)[number];

export interface DeployOptions {
  dryRun?: boolean;
  force?: boolean;
  name?: string;
  timeoutMs?: number;
  sourceRoot?: string;
  userHome?: string;
}

export interface DeployDependencies {
  run?: Runner;
  now?: () => Date;
  prepareRuntime?: (target: string, sourceRoot: string, run: Runner) => void;
  uiHealthy?: (timeoutMs: number, port: number) => Promise<boolean>;
  daemonHealthy?: (
    previousHeartbeat: string,
    timeoutMs: number,
  ) => Promise<boolean>;
  serviceHealthy?: (service: Service, run: Runner, userHome: string) => boolean;
  /** Writes a plist (or any small file); injectable for failure tests. */
  writeFile?: (path: string, body: string) => void;
  /** Atomic replacement used for plists and the database restore. */
  renameFile?: (from: string, to: string) => void;
}

export interface RollbackReport {
  ok: boolean;
  errors: string[];
  preRestoreDb: string | null;
  notes: string[];
}

export interface DeployResult {
  dryRun: boolean;
  runtime: string;
  backup: string;
  previousRuntime: string | null;
  port: number;
  problems: string[];
  steps: string[];
}

export class DeployError extends Error {
  constructor(
    message: string,
    readonly rollback: RollbackReport | null = null,
  ) {
    super(message);
    this.name = "DeployError";
  }
}

function stamp(date: Date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function checked(run: Runner, cmd: string, args: string[], cwd: string) {
  const result = run(cmd, args, cwd);
  if (result.status !== 0)
    throw new Error(
      `${cmd} ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  return result;
}

function linkOrInstall(target: string, source: string, run: Runner) {
  const modules = resolve(source, "node_modules");
  if (existsSync(modules))
    symlinkSync(modules, resolve(target, "node_modules"), "dir");
  else checked(run, "npm", ["ci", "--offline"], target);
}

export function prepareRuntime(
  target: string,
  sourceRoot: string,
  run: Runner,
) {
  mkdirSync(dirname(target), { recursive: true });
  checked(
    run,
    "git",
    ["rev-parse", "--verify", "aam/integration^{commit}"],
    sourceRoot,
  );
  checked(
    run,
    "git",
    ["worktree", "add", "--detach", target, "aam/integration"],
    sourceRoot,
  );
  linkOrInstall(target, sourceRoot, run);
  checked(run, "npm", ["test"], target);
  checked(run, "npm", ["run", "typecheck"], target);
  const ui = resolve(target, "ui");
  linkOrInstall(ui, resolve(sourceRoot, "ui"), run);
  checked(run, "npm", ["test"], ui);
  checked(run, "npm", ["run", "typecheck"], ui);
  checked(run, "npm", ["run", "build"], ui);
}

const xml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const RUNTIME_PATH = /[^<>\s"']*\/\.aam\/runtime\/[^/<>\s"']+/g;

export function runtimesInPlist(body: string) {
  return [...new Set(body.match(RUNTIME_PATH) ?? [])];
}

/** Rewrites only the runtime directory; arguments, environment and port stay as they are. */
export function retargetPlist(body: string, runtime: string) {
  return body.replace(RUNTIME_PATH, () => xml(runtime));
}

export function plistPort(body: string) {
  const match =
    body.match(/<string>--port<\/string>\s*<string>(\d+)<\/string>/) ??
    body.match(/--port=(\d+)/);
  return match ? Number(match[1]) : 3199;
}

function missingPaths(body: string, runtime: string) {
  const prefix = xml(runtime);
  return [...body.matchAll(/<string>([^<]*)<\/string>/g)]
    .map((m) => m[1]!)
    .filter((v) => v === prefix || v.startsWith(`${prefix}/`))
    .filter((v) => !existsSync(v.replace(/&amp;/g, "&")));
}

function acquireLock(home: string) {
  mkdirSync(home, { recursive: true });
  const path = resolve(home, "deploy.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      try {
        writeFileSync(fd, String(process.pid));
      } finally {
        closeSync(fd);
      }
      return () => {
        try {
          if (readFileSync(path, "utf8") === String(process.pid))
            unlinkSync(path);
        } catch {
          /* lock already gone */
        }
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let pid = NaN;
      try {
        pid = Number(readFileSync(path, "utf8"));
        const fresh =
          !Number.isInteger(pid) && Date.now() - statSync(path).mtimeMs < 30000;
        if ((Number.isInteger(pid) && pid > 0 && alive(pid)) || fresh)
          throw new DeployError(
            `Another deployment is in progress (lock ${path}, pid ${pid})`,
          );
        unlinkSync(path);
      } catch (inner) {
        if (inner instanceof DeployError) throw inner;
        if ((inner as NodeJS.ErrnoException).code !== "ENOENT") throw inner;
      }
    }
  }
  throw new DeployError(`Could not acquire deployment lock ${path}`);
}

function readHeartbeat(home: string) {
  const path = resolve(home, "aam.db");
  if (!existsSync(path)) return "";
  const db = new Database(path, { readonly: true });
  try {
    const row = db
      .prepare("SELECT value FROM settings WHERE key='last_tick_at'")
      .get() as { value: string } | undefined;
    return row?.value ?? "";
  } finally {
    db.close();
  }
}

async function poll(timeoutMs: number, test: () => Promise<boolean>) {
  const end = Date.now() + timeoutMs;
  do {
    if (await test()) return true;
    await new Promise((done) => setTimeout(done, Math.min(500, timeoutMs)));
  } while (Date.now() < end);
  return false;
}

async function defaultUiHealth(timeoutMs: number, port: number) {
  return poll(timeoutMs, async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/status`);
      return response.ok;
    } catch {
      return false;
    }
  });
}

/** Online, transaction-consistent snapshot (SQLite backup API), verified before use. */
async function consistentBackup(repo: Repo, backup: string) {
  mkdirSync(dirname(backup), { recursive: true });
  const partial = `${backup}.partial`;
  rmSync(partial, { force: true });
  await repo.db.backup(partial);
  const check = new Database(partial, { readonly: true });
  try {
    const verdict = check.pragma("integrity_check", { simple: true });
    if (verdict !== "ok")
      throw new Error(`Backup integrity check failed: ${String(verdict)}`);
  } finally {
    check.close();
  }
  renameSync(partial, backup);
}

export async function deployRuntime(
  repo: Repo,
  options: DeployOptions = {},
  dependencies: DeployDependencies = {},
): Promise<DeployResult> {
  const run = dependencies.run ?? runner;
  const writeFile = dependencies.writeFile ?? writeFileSync;
  const renameFile = dependencies.renameFile ?? renameSync;
  const userHome = resolve(options.userHome ?? homedir());
  const sourceRoot = resolve(options.sourceRoot ?? dirname(repo.home));
  const home = repo.home;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const timestamp = stamp((dependencies.now ?? (() => new Date()))());
  const name = options.name ?? "integration";
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error("Invalid runtime name");
  const runtime = resolve(home, "runtime", `${name}-${timestamp}`);
  const backup = resolve(home, "backups", `aam-${timestamp}.db`);
  const plistPaths = Object.fromEntries(
    services.map((service) => [
      service,
      resolve(userHome, "Library/LaunchAgents", `com.aam.${service}.plist`),
    ]),
  ) as Record<Service, string>;
  const existing = Object.fromEntries(
    services.map((service) => [
      service,
      existsSync(plistPaths[service])
        ? readFileSync(plistPaths[service], "utf8")
        : null,
    ]),
  ) as Record<Service, string | null>;

  const problems: string[] = [];
  for (const service of services) {
    const body = existing[service];
    if (body === null)
      problems.push(`Missing launchd plist: ${plistPaths[service]}`);
    else if (runtimesInPlist(body).length === 0)
      problems.push(
        `${plistPaths[service]} has no .aam/runtime/<name> path to switch`,
      );
  }
  const previousRuntime =
    (existing.daemon && runtimesInPlist(existing.daemon)[0]) || null;
  const port = existing.ui ? plistPort(existing.ui) : 3199;
  const steps = [
    "take deployment lock; validate launchd plists (runtime paths present)",
    "verify aam/integration and run npm test + typecheck",
    "run UI tests + typecheck and build",
    `create immutable runtime ${runtime}`,
    "re-check that no worker is active",
    `consistent SQLite online backup to ${backup}`,
    "migrate database using additive migrations",
    "re-check that no worker is active immediately before switching",
    ...services.map(
      (service) =>
        `switch (keeping arguments/env/port ${port}) and health-check com.aam.${service}`,
    ),
    "on failure: stop all three services, close DB, keep a copy of the current DB, atomically restore backup (dropping -wal/-shm), restore plists, start old services, health-check them",
  ];
  const result: DeployResult = {
    dryRun: Boolean(options.dryRun),
    runtime,
    backup,
    previousRuntime,
    port,
    problems,
    steps,
  };
  if (options.dryRun) return result;

  const release = acquireLock(home);
  try {
    if (problems.length) throw new DeployError(problems.join("; "));
    const activeCheck = () => {
      if (
        !options.force &&
        repo.runs().some((item) => item.status === "running")
      )
        throw new DeployError("A worker is active; wait for it or use --force");
    };
    activeCheck();

    (dependencies.prepareRuntime ?? prepareRuntime)(runtime, sourceRoot, run);
    const nextBodies = Object.fromEntries(
      services.map((s) => [s, retargetPlist(existing[s]!, runtime)]),
    ) as Record<Service, string>;
    const absent = services.flatMap((s) =>
      missingPaths(nextBodies[s], runtime),
    );
    if (absent.length)
      throw new DeployError(
        `New runtime is missing paths referenced by the plists: ${[...new Set(absent)].join(", ")}`,
      );

    // Long validation is over: from here until the switch, keep the window small.
    activeCheck();
    await consistentBackup(repo, backup);
    const planDir = resolve(home, "backups", `plists-${timestamp}`);
    mkdirSync(planDir, { recursive: true });
    for (const s of services)
      writeFileSync(resolve(planDir, `com.aam.${s}.plist`), existing[s]!);
    try {
      // Repo construction is the migration entry point. All migrations in Repo are additive.
      new Repo(home).close();
    } catch (error) {
      throw new DeployError(
        `Database migration failed (services untouched; backup at ${backup}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    activeCheck();

    const attempted: Service[] = [];
    const stop = (service: Service) =>
      stopService(service, plistPaths[service], run);
    const start = (service: Service) =>
      checked(run, "launchctl", ["load", plistPaths[service]], userHome);
    const healthy = (service: Service, before: string) =>
      checkHealth(
        service,
        before,
        port,
        timeoutMs,
        home,
        run,
        userHome,
        dependencies,
      );
    const writeAtomic = (path: string, body: string) => {
      writeFile(`${path}.tmp`, body);
      renameFile(`${path}.tmp`, path);
    };
    try {
      for (const service of services) {
        attempted.push(service);
        stop(service);
        const before = readHeartbeat(home);
        writeAtomic(plistPaths[service], nextBodies[service]);
        start(service);
        if (!(await healthy(service, before)))
          throw new Error(`${service} health check failed`);
      }
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      const report = await rollback();
      const detail = report.ok
        ? "rolled back successfully; previous services are healthy"
        : `ROLLBACK FAILED/PARTIAL: ${report.errors.join("; ")}`;
      const kept = report.preRestoreDb
        ? ` Pre-rollback database kept at ${report.preRestoreDb}.`
        : "";
      throw new DeployError(
        `Deploy failed (${cause}); ${detail}.${kept} Backup: ${backup}.`,
        report,
      );
    }

    async function rollback(): Promise<RollbackReport> {
      const report: RollbackReport = {
        ok: true,
        errors: [],
        preRestoreDb: null,
        notes: [],
      };
      const fail = (message: string) => {
        report.ok = false;
        report.errors.push(message);
      };
      const attempt = (label: string, fn: () => void) => {
        try {
          fn();
          return true;
        } catch (e) {
          fail(`${label}: ${e instanceof Error ? e.message : String(e)}`);
          return false;
        }
      };
      // 1. Stop everything that may touch the database (guard first so it cannot respawn).
      let stopped = true;
      for (const service of [...services].reverse())
        stopped = attempt(`stop ${service}`, () => stop(service)) && stopped;
      // 2. Close our handle and restore the database only when nothing can write to it.
      let restored = false;
      if (!stopped)
        fail("database NOT restored: some services may still be running");
      else {
        const db = resolve(home, "aam.db");
        restored = attempt("restore database", () => {
          repo.close();
          const keep = resolve(
            home,
            "backups",
            `aam-${timestamp}.pre-rollback.db`,
          );
          report.preRestoreDb = keep;
          for (const suffix of ["", "-wal", "-shm"])
            if (existsSync(db + suffix))
              copyFileSync(db + suffix, keep + suffix);
          const staged = `${db}.restore`;
          copyFileSync(backup, staged);
          rmSync(`${db}-wal`, { force: true });
          rmSync(`${db}-shm`, { force: true });
          renameFile(staged, db);
        });
      }
      // 3. Original plists (all that we may have rewritten).
      const plistsBack = new Set<Service>();
      for (const service of attempted)
        if (
          attempt(`restore plist ${service}`, () =>
            writeAtomic(plistPaths[service], existing[service]!),
          )
        )
          plistsBack.add(service);
      // 4. Start old services only against a restored database.
      if (!restored) {
        fail("old services left stopped because the database was not restored");
        return report;
      }
      const started: Service[] = [];
      const beforeStart = new Map<Service, string>();
      for (const service of services) {
        // Services never rewritten were still stopped above, so they restart too.
        if (attempted.includes(service) && !plistsBack.has(service)) continue;
        try {
          beforeStart.set(service, readHeartbeat(home));
        } catch {
          beforeStart.set(service, "");
        }
        if (attempt(`start ${service}`, () => start(service)))
          started.push(service);
      }
      // 5. Verify the old services actually came back.
      for (const service of started) {
        const before = beforeStart.get(service) ?? "";
        let ok = false;
        try {
          ok = await healthy(service, before);
        } catch (e) {
          fail(
            `health ${service}: ${e instanceof Error ? e.message : String(e)}`,
          );
          continue;
        }
        if (!ok) fail(`old ${service} unhealthy after rollback`);
      }
      return report;
    }
  } finally {
    release();
  }
  return result;
}

function stopService(service: Service, path: string, run: Runner) {
  const cwd = dirname(path);
  const unloaded = run("launchctl", ["unload", path], cwd);
  if (unloaded.status === 0) return;
  // A non-zero unload is fine only if the job is not loaded any more.
  if (run("launchctl", ["list", `com.aam.${service}`], cwd).status !== 0)
    return;
  throw new Error(
    `could not stop com.aam.${service}: ${unloaded.stderr || unloaded.stdout}`,
  );
}

async function checkHealth(
  service: Service,
  before: string,
  port: number,
  timeoutMs: number,
  home: string,
  run: Runner,
  userHome: string,
  dependencies: DeployDependencies,
) {
  if (service === "ui")
    return (dependencies.uiHealthy ?? defaultUiHealth)(timeoutMs, port);
  if (service === "daemon")
    return (
      dependencies.daemonHealthy ??
      ((since, timeout) =>
        poll(timeout, async () => readHeartbeat(home) > since))
    )(before, timeoutMs);
  return (
    dependencies.serviceHealthy ??
    ((s, execute, cwd) =>
      execute("launchctl", ["list", `com.aam.${s}`], cwd).status === 0)
  )(service, run, userHome);
}
