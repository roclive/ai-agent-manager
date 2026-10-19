import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { deployRuntime } from "../src/core/deploy-runtime.js";
import { fixture } from "./helpers.js";

let f: ReturnType<typeof fixture> | undefined;
afterEach(() => {
  if (f?.repo.db.open) f.cleanup();
  else if (f) rmSync(f.root, { recursive: true, force: true });
  f = undefined;
});

function launchdFiles(root: string, oldRuntime: string) {
  const directory = resolve(root, "Library/LaunchAgents");
  mkdirSync(directory, { recursive: true });
  for (const service of ["ui", "daemon", "daemon-guard"])
    writeFileSync(
      resolve(directory, `com.aam.${service}.plist`),
      `<plist><string>${oldRuntime}/src/cli.ts</string></plist>`,
    );
}

function runningRun(taskId: number, repo: ReturnType<typeof fixture>["repo"]) {
  repo.db
    .prepare(
      "INSERT INTO runs(task_id,worker,status,started_at,log_path,last_message_path) VALUES (?,?,'running',?,?,?)",
    )
    .run(taskId, "codex", new Date().toISOString(), "worker.log", "last.md");
}

describe("runtime deployment", () => {
  it("prints a deterministic dry-run plan without creating or restarting anything", async () => {
    f = fixture();
    const calls: string[][] = [];
    const result = await deployRuntime(
      f.repo,
      { dryRun: true, sourceRoot: f.root, userHome: resolve(f.root, "home") },
      {
        now: () => new Date("2026-10-19T01:02:03.000Z"),
        run: (_cmd, args) => {
          calls.push(args);
          return { status: 0, stdout: "", stderr: "" };
        },
      },
    );
    expect(result.runtime).toBe(
      resolve(f.repo.home, "runtime/integration-20261019T010203Z"),
    );
    expect(result.steps).toContain(
      "switch and health-check com.aam.daemon-guard",
    );
    expect(calls).toEqual([]);
  });

  it("refuses a deployment while a detached worker is active unless forced", async () => {
    f = fixture();
    const task = f.task();
    runningRun(task.id, f.repo);
    await expect(
      deployRuntime(f.repo, { userHome: resolve(f.root, "home") }),
    ).rejects.toThrow("worker is active");
  });

  it("switches all services one at a time after backup and health checks", async () => {
    f = fixture();
    const userHome = resolve(f.root, "home");
    const oldRuntime = resolve(f.repo.home, "runtime/usage-reviewed");
    launchdFiles(userHome, oldRuntime);
    const task = f.task();
    runningRun(task.id, f.repo);
    const calls: string[][] = [];
    const result = await deployRuntime(
      f.repo,
      { sourceRoot: f.root, userHome, force: true },
      {
        now: () => new Date("2026-10-19T02:00:00.000Z"),
        prepareRuntime: (target) => mkdirSync(target, { recursive: true }),
        run: (_cmd, args) => {
          calls.push(args);
          return { status: 0, stdout: "", stderr: "" };
        },
        uiHealthy: async () => true,
        daemonHealthy: async () => true,
        serviceHealthy: () => true,
      },
    );
    expect(readFileSync(result.backup)).toEqual(
      readFileSync(resolve(f.repo.home, "aam.db")),
    );
    for (const service of ["ui", "daemon", "daemon-guard"])
      expect(
        readFileSync(
          resolve(userHome, `Library/LaunchAgents/com.aam.${service}.plist`),
          "utf8",
        ),
      ).toContain(result.runtime);
    expect(calls.filter((args) => args[0] === "load")).toHaveLength(3);
    expect(f.repo.runs(task.id)[0]?.status).toBe("running");
  });

  it("restores prior plists and the database when a health check fails", async () => {
    f = fixture();
    const userHome = resolve(f.root, "home");
    const oldRuntime = resolve(f.repo.home, "runtime/usage-reviewed");
    launchdFiles(userHome, oldRuntime);
    await expect(
      deployRuntime(
        f.repo,
        { sourceRoot: f.root, userHome, timeoutMs: 1 },
        {
          now: () => new Date("2026-10-19T03:00:00.000Z"),
          prepareRuntime: (target) => mkdirSync(target, { recursive: true }),
          run: () => ({ status: 0, stdout: "", stderr: "" }),
          uiHealthy: async () => false,
        },
      ),
    ).rejects.toThrow("rolled back");
    expect(
      readFileSync(
        resolve(userHome, "Library/LaunchAgents/com.aam.ui.plist"),
        "utf8",
      ),
    ).toContain(oldRuntime);
    expect(
      existsSync(resolve(f.repo.home, "backups/aam-20261019T030000Z.db")),
    ).toBe(true);
    expect(
      readFileSync(resolve(f.repo.home, "aam.db")).byteLength,
    ).toBeGreaterThan(0);
  });
});
