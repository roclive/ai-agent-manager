import { afterEach, beforeEach, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { dispatch } from "../src/core/dispatch.js";
import { finalize } from "../src/core/finalize.js";
import { waitExit } from "./helpers.js";
import { opencode } from "../src/workers/index.js";
import {
  localLlmHealth,
  localLlmModel,
  localLlmProfile,
  localModelHost,
  omlxStartCommand,
  startLocalLlm,
  stopLocalModelAfterTask,
  stopLocalModelIfIdle,
} from "../src/core/local-model.js";
import { cleanupLocalModelOnDaemonStart } from "../src/scheduler.js";

let f: ReturnType<typeof fixture>;
let runs: { cmd: string; args: string[]; env: NodeJS.ProcessEnv }[];
let probes: string[];
let healthy: boolean;
let becomesHealthy: boolean;
let startStatuses: number[];
const real = { ...localModelHost };
beforeEach(() => {
  runs = [];
  probes = [];
  healthy = false;
  becomesHealthy = true;
  localModelHost.sleep = () => {};
  startStatuses = [0];
  localModelHost.probe = (url) => {
    probes.push(url);
    return { ok: healthy, detail: "" };
  };
  localModelHost.run = (cmd, args, env) => {
    runs.push({ cmd, args, env });
    const stop = cmd.endsWith("omlx-stop.sh");
    const status = stop ? 0 : (startStatuses.shift() ?? 0);
    if (stop) healthy = false;
    else if (status === 0 && becomesHealthy) healthy = true;
    return { status, stdout: "", stderr: status ? "boom" : "" };
  };
  localModelHost.ollamaStop = () => {};
  localModelHost.vmStat = () => "";
});
afterEach(() => {
  Object.assign(localModelHost, real);
  f?.cleanup();
});

it("defaults to ollama and validates the new settings", () => {
  f = fixture();
  expect(f.repo.getSetting("local_llm_server")).toBe("ollama");
  expect(f.repo.getSetting("keep_warm")).toBe("0");
  expect(() => f.repo.setSetting("local_llm_server", "lmstudio")).toThrow();
  expect(() => f.repo.setSetting("keep_warm", "2")).toThrow();
  f.repo.setSetting("local_llm_server", "omlx");
});

const starts = () => runs.filter((r) => r.cmd.endsWith("omlx-start.sh"));
const stopsRun = () => runs.filter((r) => r.cmd.endsWith("omlx-stop.sh"));
const kinds = () => f.repo.events(200).map((e: any) => e.kind);
function enableOmlx() {
  f.repo.setSetting("local_llm_server", "omlx");
  f.repo.setSetting("fallback_worker", "opencode");
  writeFileSync(resolve(f.repo.home, "manager-owner"), "opencode-fallback\n");
}
function failRun(taskId: number, status: string, summary: string) {
  f.repo.db
    .prepare(
      "INSERT INTO runs(task_id,worker,provider,status,started_at,log_path,last_message_path,summary) VALUES (?,?,?,?,?,'','',?)",
    )
    .run(taskId, "opencode", "opencode-fallback", status, new Date().toISOString(), summary);
}

it("server launch settings get strictly safer; client-only level adds no new server command", () => {
  const sig = (p: 0 | 1 | 2 | 3) => JSON.stringify(omlxStartCommand(p));
  const p0 = omlxStartCommand(0);
  expect(p0.cmd).toMatch(/omlx-start\.sh$/);
  expect(p0.env.OMLX_FORCE).toBe("1");
  expect(p0.args).toEqual(["--max-concurrent", "2"]);
  expect(sig(1)).not.toBe(sig(0));
  expect(sig(2)).toBe(sig(1)); // 8192 context is client-only
  expect(sig(3)).not.toBe(sig(1));
  expect(omlxStartCommand(3).args).toEqual(["--max-concurrent", "1"]);
  for (const p of [0, 1, 2, 3] as const) expect(omlxStartCommand(p).env.OMLX_FORCE).toBe("1");
});

it("never starts omlx for ollama or from a health probe", () => {
  f = fixture();
  expect(startLocalLlm(f.repo, f.task().id)).toBe(0);
  expect(runs).toHaveLength(0);
  f.repo.setSetting("local_llm_server", "omlx");
  expect(localLlmHealth(f.repo).ok).toBe(false);
  expect(probes).toEqual(["http://127.0.0.1:8000/v1/models"]);
  expect(runs).toHaveLength(0);
});

it("starts once when not healthy and records the effective profile", () => {
  f = fixture();
  f.repo.setSetting("local_llm_server", "omlx");
  expect(startLocalLlm(f.repo, f.task().id)).toBe(0);
  expect(starts()).toHaveLength(1);
  expect(starts()[0].env.OMLX_FORCE).toBe("1");
  expect(f.repo.getSetting("local_llm_active_profile")).toBe("0");
  expect(kinds()).toContain("local_llm_start");
});

it("creates the watchdog active marker before starting omlx and keeps its path aligned", () => {
  f = fixture();
  f.repo.setSetting("local_llm_server", "omlx");
  const task = f.task();
  let markerExistedAtStart = false;
  localModelHost.run = (cmd, args, env) => {
    runs.push({ cmd, args, env });
    if (cmd.endsWith("omlx-start.sh")) {
      markerExistedAtStart = existsSync(env.OMLX_ACTIVE_RUN_FILE!);
      healthy = true;
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  startLocalLlm(f.repo, task.id);
  expect(markerExistedAtStart).toBe(true);
  expect(starts()[0].env.OMLX_ACTIVE_RUN_FILE).toBe(
    resolve(f.repo.home, "local-model.active"),
  );
  expect(readFileSync(resolve(f.repo.home, "local-model.active"), "utf8")).toBe(`${task.id}\n`);
});

it("reuses a healthy server at least as safe, restarts one running a weaker profile", () => {
  f = fixture();
  f.repo.setSetting("local_llm_server", "omlx");
  const task = f.task();
  healthy = true;
  expect(startLocalLlm(f.repo, task.id)).toBe(0);
  expect(runs).toHaveLength(0);
  expect(f.repo.events(20).some((e: any) => /reused at profile 0/.test(e.message))).toBe(true);
  failRun(task.id, "timeout", "");
  expect(localLlmProfile(f.repo, task.id)).toBe(1);
  expect(startLocalLlm(f.repo, task.id)).toBe(1); // warm profile-0 server is replaced
  expect(stopsRun()).toHaveLength(1);
  expect(starts()).toHaveLength(1);
  expect(starts()[0].env.OMLX_SYSTEM_RESERVE_GB).toBe("8");
  expect(kinds()).toContain("local_llm_restart");
  expect(f.repo.getSetting("local_llm_active_profile")).toBe("1");
  runs = [];
  expect(startLocalLlm(f.repo, task.id)).toBe(1); // now healthy at profile 1: reused
  expect(runs).toHaveLength(0);
});

it("retries with distinct server profiles, stopping before every attempt", () => {
  f = fixture();
  f.repo.setSetting("local_llm_server", "omlx");
  startStatuses = [1, 1, 0];
  expect(startLocalLlm(f.repo, f.task().id)).toBe(3);
  const s = starts();
  expect(s).toHaveLength(3);
  expect(new Set(s.map((r) => JSON.stringify([r.args, r.env.OMLX_SYSTEM_RESERVE_GB]))).size).toBe(3);
  expect(stopsRun()).toHaveLength(3);
  expect(runs[0].cmd).toMatch(/omlx-stop\.sh$/);
});

it("treats a server that never becomes healthy as a failure and stops it", () => {
  f = fixture();
  f.repo.setSetting("local_llm_server", "omlx");
  becomesHealthy = false;
  expect(() => startLocalLlm(f.repo, f.task().id)).toThrow(/every profile/);
  expect(starts()).toHaveLength(3);
  expect(runs[runs.length - 1].cmd).toMatch(/omlx-stop\.sh$/);
  expect(f.repo.getSetting("local_llm_active_profile")).toBe("");
  expect(existsSync(resolve(f.repo.home, "local-model.active"))).toBe(false);
  expect(probes.length).toBeLessThanOrEqual(21); // bounded across all three profiles
});

it("only resource failures escalate the profile, not ordinary code failures", () => {
  f = fixture();
  const task = f.task();
  failRun(task.id, "failed", "tests failed: expected 1 got 2");
  expect(localLlmProfile(f.repo, task.id)).toBe(0);
  failRun(task.id, "failed", "Out of memory while loading");
  expect(localLlmProfile(f.repo, task.id)).toBe(1);
  failRun(task.id, "lost", "");
  failRun(task.id, "timeout", "");
  failRun(task.id, "timeout", "");
  expect(localLlmProfile(f.repo, task.id)).toBe(3);
});

it("allows all four resource fallback profiles despite max_attempts=3", async () => {
  f = fixture("echo 'Out of memory while running model' >&2\nexit 7");
  enableOmlx();
  const task = f.task({ max_attempts: 3 });
  const profiles: number[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const runId = dispatch(f.repo, task.identifier, true);
    profiles.push(Number(f.repo.getSetting("local_llm_active_profile")));
    await waitExit(f.repo, runId);
    finalize(f.repo, f.repo.runs(task.id).find((r) => r.id === runId)!);
    stopLocalModelAfterTask(f.repo);
    expect(f.repo.task(task.id).status).toBe(attempt < 3 ? "ready" : "blocked");
  }
  expect(profiles).toEqual([0, 1, 2, 3]);
  expect(f.repo.task(task.id).attempts).toBe(4);
});

it("dispatch starts omlx only after the single-run guard and passes URL + context argv", () => {
  f = fixture("sleep 1");
  enableOmlx();
  failRun(f.task().id, "running", ""); // another local run holds the lock
  const t = f.task();
  expect(() => dispatch(f.repo, t.identifier, true)).toThrow(/local-model/);
  expect(runs).toHaveLength(0);
  f.repo.db.prepare("UPDATE runs SET status='done'").run();
  dispatch(f.repo, t.identifier, true);
  expect(existsSync(resolve(f.repo.home, "local-model.active"))).toBe(true);
  expect(starts()).toHaveLength(1);
  const cmd = opencode.command({
    worktree: "/w",
    promptFile: "/w/runs/1/prompt.md",
    runDir: "/w/runs/1",
    sandbox: "",
    modelArgs: [],
    provider: "opencode-fallback",
    model: "ollama/gemma4:e4b-mlx",
    localBaseUrl: "http://127.0.0.1:8000/v1",
    localContext: 8192,
  } as any);
  expect(cmd.args.slice(-2)).toEqual(["http://127.0.0.1:8000/v1", "8192"]);
});

it("records the fallback level that successfully completed the model task", async () => {
  f = fixture();
  enableOmlx();
  const task = f.task();
  failRun(task.id, "failed", "Out of memory");
  failRun(task.id, "timeout", "");
  const runId = dispatch(f.repo, task.identifier, true);
  await waitExit(f.repo, runId);
  finalize(f.repo, f.repo.runs(task.id).find((r) => r.id === runId)!);
  const event: any = f.repo.events(100).find((e: any) => e.kind === "local_llm_success");
  expect(event?.message).toContain("profile 2 (8192 context)");
});

it("all-profile start failure fails the run and releases the single-run lock", () => {
  f = fixture("sleep 1");
  enableOmlx();
  becomesHealthy = false;
  const t = f.task();
  expect(() => dispatch(f.repo, t.identifier, true)).toThrow(/every profile/);
  const r = f.repo.runs(t.id)[0];
  expect(r.status).toBe("failed");
  expect(f.repo.runs().some((x) => x.status === "running")).toBe(false);
  // the failure is not a resource failure of the model: next attempt starts at profile 0
  expect(localLlmProfile(f.repo, t.id)).toBe(0);
});

it("never starts omlx from planner/health paths", async () => {
  f = fixture();
  f.repo.setSetting("local_llm_server", "omlx");
  const src = await import("node:fs").then((m) =>
    ["src/core/llm.ts", "src/core/review.ts", "src/core/autopilot.ts", "src/core/usage.ts"]
      .map((p) => m.readFileSync(p, "utf8"))
      .join("\n"),
  );
  expect(src).not.toMatch(/startLocalLlm|omlxStartCommand|omlx-start/);
});

it("stops omlx after a task unless keep_warm is set", () => {
  f = fixture();
  f.repo.setSetting("local_llm_server", "omlx");
  f.repo.setSetting("keep_warm", "1");
  writeFileSync(resolve(f.repo.home, "local-model.active"), "123\n");
  stopLocalModelAfterTask(f.repo);
  expect(runs).toHaveLength(0);
  expect(existsSync(resolve(f.repo.home, "local-model.active"))).toBe(false);
  const idleSince = resolve(f.repo.home, "local-model.idle-since");
  expect(Number(readFileSync(idleSince, "utf8"))).toBeGreaterThan(0);
  f.repo.setSetting("keep_warm", "0");
  stopLocalModelAfterTask(f.repo);
  expect(runs).toHaveLength(1);
  expect(runs[0].cmd).toMatch(/omlx-stop\.sh$/);
  expect(existsSync(idleSince)).toBe(false);
});

it("passes an explicit task-completion idle timer to the omlx watchdog", () => {
  f = fixture();
  f.repo.setSetting("local_llm_server", "omlx");
  startLocalLlm(f.repo, f.task().id);
  f.repo.setSetting("keep_warm", "1");
  expect(starts()[0].env.OMLX_IDLE_SINCE_FILE).toBe(
    resolve(f.repo.home, "local-model.idle-since"),
  );
  const script = readFileSync(resolve("scripts/omlx-start.sh"), "utf8");
  expect(script).toContain('IDLE_MS=$(cat "$IDLE_SINCE_FILE"');
  expect(script).not.toContain('stat -f %m "$LOG"');
  writeFileSync(resolve(f.repo.home, "local-model.idle-since"), "1\n");
  writeFileSync(resolve(f.repo.home, "local-model.active"), `${f.task().id}\n`);
  stopLocalModelAfterTask(f.repo);
  expect(existsSync(resolve(f.repo.home, "local-model.active"))).toBe(false);
  expect(Number(readFileSync(resolve(f.repo.home, "local-model.idle-since"), "utf8"))).toBeGreaterThan(1);
});

it("daemon startup preserves a deliberately warm omlx server", () => {
  f = fixture();
  enableOmlx();
  f.repo.setSetting("keep_warm", "1");
  f.repo.setSetting("local_llm_active_profile", "0");
  cleanupLocalModelOnDaemonStart(f.repo);
  expect(stopsRun()).toHaveLength(0);
  expect(f.repo.getSetting("local_llm_active_profile")).toBe("0");

  f.repo.setSetting("keep_warm", "0");
  cleanupLocalModelOnDaemonStart(f.repo);
  expect(stopsRun()).toHaveLength(1);
  expect(f.repo.getSetting("local_llm_active_profile")).toBe("");
});

it("daemon startup preserves keep_warm even with the opencode fallback worker", () => {
  f = fixture();
  enableOmlx();
  f.repo.setSetting("fallback_worker", "opencode");
  f.repo.setSetting("keep_warm", "1");
  f.repo.setSetting("local_llm_active_profile", "0");
  cleanupLocalModelOnDaemonStart(f.repo);
  expect(stopsRun()).toHaveLength(0);
  expect(f.repo.getSetting("local_llm_active_profile")).toBe("0");
});

it("switching provider away from omlx still unloads a server this module started", () => {
  f = fixture();
  f.repo.setSetting("local_llm_server", "omlx");
  expect(startLocalLlm(f.repo, f.task().id)).toBe(0);
  f.repo.setSetting("local_llm_server", "ollama");
  runs = [];
  stopLocalModelIfIdle(f.repo);
  expect(stopsRun()).toHaveLength(1);
  expect(f.repo.getSetting("local_llm_active_profile")).toBe("");
  runs = [];
  stopLocalModelIfIdle(f.repo); // nothing started by us any more: omlx untouched
  expect(runs).toHaveLength(0);
});

it("omlx route sends the served model id, ollama keeps the tag", () => {
  f = fixture();
  expect(localLlmModel(f.repo)).toBe("ollama/LFM2.5-2.6B-4bit");
  f.repo.setSetting("local_llm_server", "omlx");
  expect(localLlmModel(f.repo)).toBe("omlx/LFM2.5-2.6B-4bit");
  const env = readFileSync(resolve("config/omlx.env"), "utf8");
  expect(env).toContain("OMLX_MODEL_NAME=LFM2.5-2.6B-4bit");
});

it("worker spawn failure after omlx start stops omlx when keep_warm=0", () => {
  f = fixture("sleep 1");
  enableOmlx();
  const t = f.task();
  f.repo.setSetting("local_llm_idle_timeout_min", "10");
  const orig = f.repo.updateTask.bind(f.repo);
  (f.repo as any).updateTask = (id: number, patch: any) => {
    if (patch?.status === "in_progress") throw new Error("spawn bookkeeping failed");
    return orig(id, patch);
  };
  expect(() => dispatch(f.repo, t.identifier, true)).toThrow(/spawn bookkeeping/);
  expect(starts()).toHaveLength(1);
  expect(stopsRun().length).toBeGreaterThanOrEqual(2); // one before start, one on task end
  expect(runs[runs.length - 1].cmd).toMatch(/omlx-stop\.sh$/);
});

it("spawn failure keeps omlx warm when keep_warm=1", () => {
  f = fixture("sleep 1");
  enableOmlx();
  f.repo.setSetting("keep_warm", "1");
  const t = f.task();
  const orig = f.repo.updateTask.bind(f.repo);
  (f.repo as any).updateTask = (id: number, patch: any) => {
    if (patch?.status === "in_progress") throw new Error("spawn bookkeeping failed");
    return orig(id, patch);
  };
  expect(() => dispatch(f.repo, t.identifier, true)).toThrow();
  expect(runs[runs.length - 1].cmd).toMatch(/omlx-start\.sh$/);
});
