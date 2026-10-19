import { afterEach, beforeEach, expect, it } from "vitest";
import { writeFileSync, readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fixture, waitExit } from "./helpers.js";
import { dispatch } from "../src/core/dispatch.js";
import { tick } from "../src/core/tick.js";
import { opencode } from "../src/workers/index.js";
import { alive, killGroup } from "../src/core/process.js";
import {
  availableGb,
  fallbackActive,
  localModelHost,
  stopLocalModelIfIdle,
} from "../src/core/local-model.js";
import {
  fallbackProvider,
  fallbackRunArgs,
} from "../src/workers/opencode-fallback.mjs";
import { openCodeConfigContent } from "../src/workers/coding-providers.mjs";

const vm = (gb: number) =>
  `Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:   ${Math.round((gb * 1024 ** 3) / 16384 / 2)}.\nPages active: 100.\nPages inactive:   ${Math.round((gb * 1024 ** 3) / 16384 / 2)}.\nPages speculative: 0.\n`;
let f: ReturnType<typeof fixture>;
let stops: string[];
let memory: number;
const real = { ...localModelHost };
beforeEach(() => {
  stops = [];
  memory = 20;
  localModelHost.vmStat = () => vm(memory);
  localModelHost.ollamaStop = (m) => {
    stops.push(m);
  };
});
afterEach(() => {
  Object.assign(localModelHost, real);
  f?.cleanup();
});
function enable() {
  f.repo.setSetting("fallback_worker", "opencode");
  writeFileSync(resolve(f.repo.home, "manager-owner"), "opencode-fallback\n");
}
const waits = () =>
  f.repo
    .events(100)
    .filter((e: any) => e.kind === "local_model_waiting_memory");

it("has safe defaults and validates the new settings", () => {
  f = fixture();
  expect(f.repo.getSetting("fallback_worker")).toBe("none");
  expect(f.repo.getSetting("opencode_fallback_model")).toBe(
    "ollama/gemma4:e4b-mlx",
  );
  expect(f.repo.getSetting("local_model_min_free_gb")).toBe("0");
  expect(() => f.repo.setSetting("fallback_worker", "codex")).toThrow();
  expect(() =>
    f.repo.setSetting("opencode_fallback_model", "no-slash"),
  ).toThrow();
  expect(() => f.repo.setSetting("local_model_min_free_gb", "-1")).toThrow();
});

it("builds the opencode command with -m only for the fallback", () => {
  const c = { worktree: "/w", promptFile: "/r/p.md", runDir: "/r" };
  expect(opencode.command(c).args.slice(3)).toEqual([]);
  const withModel = opencode.command({
    ...c,
    provider: "opencode-fallback",
    model: "ollama/gemma4:e4b-mlx",
  });
  expect(withModel.args.slice(-2)).toEqual([
    "opencode-fallback",
    "ollama/gemma4:e4b-mlx",
  ]);
  expect(fallbackRunArgs("/w", "ollama/gemma4:e4b-mlx", "do it")).toEqual([
    "run",
    "--format",
    "json",
    "--dir",
    "/w",
    "-m",
    "ollama/gemma4:e4b-mlx",
    "do it",
  ]);
  const provider = fallbackProvider(
    "opencode-fallback",
    "ollama/gemma4:e4b-mlx",
  );
  const config = JSON.parse(
    openCodeConfigContent(
      { version: 1, auto: false, providers: [], route: [] },
      provider,
      undefined,
    )!,
  );
  expect(config.provider.ollama.npm).toBe("@ai-sdk/openai-compatible");
  expect(config.provider.ollama.options.baseURL).toBe(
    "http://127.0.0.1:11434/v1",
  );
  expect(config.provider.ollama.models["gemma4:e4b-mlx"].limit.context).toBe(
    32768,
  );
});

it("activates only with fallback_worker=opencode and owner file or fallback_active", () => {
  f = fixture();
  writeFileSync(resolve(f.repo.home, "manager-owner"), "opencode-fallback");
  expect(fallbackActive(f.repo)).toBe(false);
  f.repo.setSetting("fallback_worker", "opencode");
  expect(fallbackActive(f.repo)).toBe(true);
  writeFileSync(resolve(f.repo.home, "manager-owner"), "claude");
  expect(fallbackActive(f.repo)).toBe(false);
  f.repo.setSetting("fallback_active", "1");
  expect(fallbackActive(f.repo)).toBe(true);
});

it("parses vm_stat free+inactive+speculative", () => {
  expect(availableGb(vm(12))).toBeCloseTo(12, 1);
  expect(availableGb("garbage")).toBeNaN();
});

it("does not refuse at low memory and records local_model_memory", () => {
  f = fixture();
  enable();
  const t = f.task();
  memory = 0.5;
  tick(f.repo);
  expect(f.repo.task(t.id).status).toBe("in_progress");
  expect(f.repo.runs()[0].provider).toBe("opencode-fallback");
  expect(waits()).toHaveLength(0);
  expect(
    f.repo.events(100).filter((e: any) => e.kind === "local_model_memory"),
  ).toHaveLength(1);
});

it("unusable vm_stat does not block dispatch", () => {
  f = fixture();
  enable();
  const t = f.task();
  localModelHost.vmStat = () => {
    throw new Error("no vm_stat");
  };
  tick(f.repo);
  expect(f.repo.task(t.id).status).toBe("in_progress");
  expect(waits()).toHaveLength(0);
});

it("allows only one local-model run at a time and stops ollama after it ends", async () => {
  f = fixture("sleep 0.3");
  enable();
  f.repo.setSetting("max_parallel", "3");
  const a = f.task();
  const b = f.task();
  tick(f.repo);
  expect(f.repo.runs()).toHaveLength(1);
  expect([a, b].map((t) => f.repo.task(t.id).status).sort()).toEqual([
    "in_progress",
    "ready",
  ]);
  expect(() => dispatch(f.repo, b.identifier, true)).toThrow(/local-model/);
  expect(stops).toEqual([]);
  await waitExit(f.repo, f.repo.runs()[0].id);
  tick(f.repo);
  expect(stops).toEqual(["gemma4:e4b-mlx"]);
  expect(f.repo.runs().filter((r) => r.status === "running").length).toBe(1);
});

it("stops the model on startup only when no local run is active", () => {
  f = fixture("sleep 5");
  enable();
  stopLocalModelIfIdle(f.repo);
  expect(stops).toEqual(["gemma4:e4b-mlx"]);
  f.task();
  tick(f.repo);
  stopLocalModelIfIdle(f.repo);
  expect(stops).toHaveLength(1);
});

it("kills the whole process group on timeout and unloads the model", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "aam-pg-"));
  const pidFile = resolve(root, "child.pid");
  f = fixture(`sleep 60 &\necho $! > ${pidFile}\nwait`);
  enable();
  f.task();
  tick(f.repo);
  for (let i = 0; i < 100 && !existsSync(pidFile); i++)
    await new Promise((r) => setTimeout(r, 20));
  const child = Number(readFileSync(pidFile, "utf8"));
  expect(alive(child)).toBe(true);
  f.repo.db.prepare("UPDATE runs SET started_at=?").run("2000-01-01T00:00:00Z");
  tick(f.repo);
  expect(f.repo.runs().at(-1)!.status).toBe("timeout");
  for (let i = 0; i < 100 && alive(child); i++)
    await new Promise((r) => setTimeout(r, 20));
  expect(alive(child)).toBe(false);
  expect(stops).toEqual(["gemma4:e4b-mlx"]);
  for (const r of f.repo.runs()) killGroup(r.pid);
});

it("does not touch the memory guard or ollama when the fallback is off", async () => {
  f = fixture();
  const t = f.task();
  localModelHost.vmStat = () => {
    throw new Error("must not be called");
  };
  tick(f.repo);
  expect(f.repo.task(t.id).status).toBe("in_progress");
  expect(f.repo.runs()[0].provider).not.toBe("opencode-fallback");
  await waitExit(f.repo, f.repo.runs()[0].id);
  tick(f.repo);
  expect(stops).toEqual([]);
});
