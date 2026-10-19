import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

const start = resolve("scripts/omlx-start.sh");
const stop = resolve("scripts/omlx-stop.sh");

function env(withWeights: boolean) {
  const d = mkdtempSync(join(tmpdir(), "omlx-"));
  const w = join(d, "w");
  mkdirSync(w);
  if (withWeights) writeFileSync(join(w, "config.json"), "{}");
  const f = join(d, "omlx.env");
  writeFileSync(
    f,
    `OMLX_HOST=127.0.0.1\nOMLX_PORT=8000\nOMLX_MODEL_NAME=g\nOMLX_MODEL_DIR=${d}/m\nOMLX_SSD_CACHE_DIR=${d}/c\nOMLX_SSD_CACHE_MAX=20GB\nOMLX_SYSTEM_RESERVE_GB=6\nOMLX_MAX_CONCURRENT=2\nOMLX_IDLE_MINUTES=10\nOMLX_WEIGHT_CANDIDATES="${w}"\n`,
  );
  return { ...process.env, OMLX_ENV: f, OMLX_STATE_DIR: join(d, "s"), OMLX_MEM_BYTES: String(16 * 1073741824), OMLX_BIN: "/nonexistent/omlx" };
}

it("dry run resolves limits and starts nothing", () => {
  const out = execFileSync(start, ["--dry-run"], { env: env(true), encoding: "utf8" });
  expect(out).toContain("memory ceiling 10GB");
  expect(out).toContain("--host 127.0.0.1");
  expect(out).toContain("--paged-ssd-cache-max-size 20GB");
  expect(out).toContain("no server started");
});

it("real start refuses when weights are missing", () => {
  const r = spawnSync(start, [], { env: env(false), encoding: "utf8" });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("never downloads");
});

it("stop is idempotent without pid file", () => {
  expect(execFileSync(stop, [], { env: env(true), encoding: "utf8" })).toContain("not running");
});

it("stop never signals a stale pid that belongs to another process", async () => {
  const { spawn } = await import("node:child_process");
  const { existsSync, readFileSync } = await import("node:fs");
  const e = env(true) as NodeJS.ProcessEnv;
  const victim = spawn("sleep", ["30"], { stdio: "ignore" });
  try {
    mkdirSync(e.OMLX_STATE_DIR!, { recursive: true });
    writeFileSync(join(e.OMLX_STATE_DIR!, "omlx.pid"), String(victim.pid));
    const out = execFileSync(stop, [], { env: e, encoding: "utf8" });
    expect(out).toContain("not signaled");
    expect(() => process.kill(victim.pid!, 0)).not.toThrow();
    expect(existsSync(join(e.OMLX_STATE_DIR!, "omlx.pid"))).toBe(false);
    void readFileSync;
  } finally {
    victim.kill("SIGKILL");
  }
});

it("stop removes a non-numeric pid file without signaling", () => {
  const e = env(true) as NodeJS.ProcessEnv;
  mkdirSync(e.OMLX_STATE_DIR!, { recursive: true });
  writeFileSync(join(e.OMLX_STATE_DIR!, "omlx.pid"), "-1\n");
  expect(execFileSync(stop, [], { env: e, encoding: "utf8" })).toContain("stale");
});
