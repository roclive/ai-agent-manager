import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { Repo } from "../db/index.js";
import { nodePath } from "../launchd.js";
import { runner, type Runner } from "./process.js";

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
  uiHealthy?: (timeoutMs: number) => Promise<boolean>;
  daemonHealthy?: (
    previousHeartbeat: string,
    timeoutMs: number,
  ) => Promise<boolean>;
  serviceHealthy?: (service: Service, run: Runner, userHome: string) => boolean;
}

export interface DeployResult {
  dryRun: boolean;
  runtime: string;
  backup: string;
  previousRuntime: string | null;
  steps: string[];
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

export function runtimePlist(
  repo: Repo,
  runtime: string,
  service: "daemon" | "ui",
  userHome = homedir(),
) {
  const args = [
    nodePath(),
    "--import",
    resolve(runtime, "node_modules/tsx/dist/loader.mjs"),
    resolve(runtime, "src/cli.ts"),
    ...(service === "ui" ? ["serve", "--port", "3199"] : ["daemon"]),
  ];
  const label = `com.aam.${service}`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${label}</string>\n<key>ProgramArguments</key><array>${args.map((a) => `<string>${xml(a)}</string>`).join("")}</array>\n<key>WorkingDirectory</key><string>${xml(runtime)}</string>\n<key>EnvironmentVariables</key><dict><key>AAM_HOME</key><string>${xml(repo.home)}</string><key>PATH</key><string>${xml(`/opt/homebrew/bin:${userHome}/.local/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}`)}</string></dict>\n<key>KeepAlive</key><true/><key>RunAtLoad</key><true/>\n<key>StandardOutPath</key><string>${xml(resolve(userHome, `Library/Logs/aam/${service}.log`))}</string>\n<key>StandardErrorPath</key><string>${xml(resolve(userHome, `Library/Logs/aam/${service}.log`))}</string>\n</dict></plist>\n`;
}

function runtimeFromPlist(body: string) {
  return (
    body.match(/([^<]*\/\.aam\/runtime\/[^/<]+)\/src\/cli\.ts/)?.[1] ?? null
  );
}

function restart(service: Service, path: string, run: Runner) {
  const cwd = dirname(path);
  run("launchctl", ["unload", path], cwd);
  checked(run, "launchctl", ["load", path], cwd);
}

async function poll(timeoutMs: number, test: () => Promise<boolean>) {
  const end = Date.now() + timeoutMs;
  do {
    if (await test()) return true;
    await new Promise((done) => setTimeout(done, Math.min(500, timeoutMs)));
  } while (Date.now() < end);
  return false;
}

async function defaultUiHealth(timeoutMs: number) {
  return poll(timeoutMs, async () => {
    try {
      const response = await fetch("http://127.0.0.1:3199/api/status");
      return response.ok;
    } catch {
      return false;
    }
  });
}

async function defaultDaemonHealth(
  repo: Repo,
  before: string,
  timeoutMs: number,
) {
  return poll(
    timeoutMs,
    async () => (repo.getSetting("last_tick_at") || "") > before,
  );
}

export async function deployRuntime(
  repo: Repo,
  options: DeployOptions = {},
  dependencies: DeployDependencies = {},
): Promise<DeployResult> {
  const run = dependencies.run ?? runner;
  const userHome = resolve(options.userHome ?? homedir());
  const sourceRoot = resolve(options.sourceRoot ?? dirname(repo.home));
  const timestamp = stamp((dependencies.now ?? (() => new Date()))());
  const name = options.name ?? "integration";
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error("Invalid runtime name");
  const runtime = resolve(repo.home, "runtime", `${name}-${timestamp}`);
  const backup = resolve(repo.home, "backups", `aam-${timestamp}.db`);
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
  const previousRuntime = existing.daemon
    ? runtimeFromPlist(existing.daemon)
    : null;
  const steps = [
    "verify aam/integration and run npm test + typecheck",
    "run UI tests + typecheck and build",
    `create immutable runtime ${runtime}`,
    `backup database to ${backup}`,
    "migrate database using additive migrations",
    ...services.map((service) => `switch and health-check com.aam.${service}`),
    "rollback plists and database automatically on failure",
  ];
  const result = {
    dryRun: Boolean(options.dryRun),
    runtime,
    backup,
    previousRuntime,
    steps,
  };
  if (options.dryRun) return result;
  if (!options.force && repo.runs().some((item) => item.status === "running"))
    throw new Error("A worker is active; wait for it or use --force");
  for (const service of services)
    if (!existing[service])
      throw new Error(`Missing launchd plist: ${plistPaths[service]}`);

  (dependencies.prepareRuntime ?? prepareRuntime)(runtime, sourceRoot, run);
  mkdirSync(dirname(backup), { recursive: true });
  repo.db.pragma("wal_checkpoint(TRUNCATE)");
  copyFileSync(resolve(repo.home, "aam.db"), backup);
  // Repo construction is the migration entry point. All migrations in Repo are additive.
  const migrated = new Repo(repo.home);
  migrated.close();

  const nextBodies: Record<Service, string> = {
    ui: runtimePlist(repo, runtime, "ui", userHome),
    daemon: runtimePlist(repo, runtime, "daemon", userHome),
    "daemon-guard": existing["daemon-guard"]!.replace(
      /[^<\s]*\/\.aam\/runtime\/[^/<\s]+/g,
      runtime,
    ),
  };
  if (!nextBodies["daemon-guard"].includes(runtime))
    throw new Error("daemon-guard plist does not contain a runtime path");

  const switched: Service[] = [];
  const heartbeat = repo.getSetting("last_tick_at") || "";
  try {
    for (const service of services) {
      writeFileSync(plistPaths[service], nextBodies[service]);
      switched.push(service);
      restart(service, plistPaths[service], run);
      const healthy =
        service === "ui"
          ? await (dependencies.uiHealthy ?? defaultUiHealth)(
              options.timeoutMs ?? 60_000,
            )
          : service === "daemon"
            ? await (
                dependencies.daemonHealthy ??
                ((before, timeout) =>
                  defaultDaemonHealth(repo, before, timeout))
              )(heartbeat, options.timeoutMs ?? 60_000)
            : (
                dependencies.serviceHealthy ??
                ((name, execute, home) =>
                  execute("launchctl", ["list", `com.aam.${name}`], home)
                    .status === 0)
              )(service, run, userHome);
      if (!healthy) throw new Error(`${service} health check failed`);
    }
  } catch (error) {
    for (const service of switched.reverse()) {
      writeFileSync(plistPaths[service], existing[service]!);
      try {
        restart(service, plistPaths[service], run);
      } catch {
        /* retain original failure */
      }
    }
    repo.db.pragma("wal_checkpoint(TRUNCATE)");
    repo.close();
    copyFileSync(backup, resolve(repo.home, "aam.db"));
    throw new Error(
      `Deploy failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return result;
}
