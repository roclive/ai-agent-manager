import { afterEach, beforeEach, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import {
  localLlmHealth,
  localLlmProfile,
  localModelHost,
  omlxStartCommand,
  startLocalLlm,
  stopLocalModelAfterTask,
} from "../src/core/local-model.js";

let f: ReturnType<typeof fixture>;
let runs: { cmd: string; args: string[]; env: NodeJS.ProcessEnv }[];
let probes: string[];
let healthy: boolean;
let startStatuses: number[];
const real = { ...localModelHost };
beforeEach(() => {
  runs = [];
  probes = [];
  healthy = false;
  startStatuses = [0];
  localModelHost.probe = (url) => {
    probes.push(url);
    return { ok: healthy, detail: "" };
  };
  localModelHost.run = (cmd, args, env) => {
    runs.push({ cmd, args, env });
    const status = cmd.endsWith("omlx-stop.sh") ? 0 : (startStatuses.shift() ?? 0);
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

it("builds start commands per fallback profile, always forcing", () => {
  const p0 = omlxStartCommand(0);
  expect(p0.cmd).toMatch(/omlx-start\.sh$/);
  expect(p0.env.OMLX_FORCE).toBe("1");
  expect(p0.args).toEqual(["--max-concurrent", "2"]);
  expect(omlxStartCommand(1).env.OMLX_SYSTEM_RESERVE_GB).toBe("8");
  expect(omlxStartCommand(3).args).toEqual(["--max-concurrent", "1"]);
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

it("skips the start when already healthy, otherwise starts once", () => {
  f = fixture();
  f.repo.setSetting("local_llm_server", "omlx");
  healthy = true;
  startLocalLlm(f.repo, f.task().id);
  expect(runs).toHaveLength(0);
  healthy = false;
  expect(startLocalLlm(f.repo, f.task().id)).toBe(0);
  expect(runs).toHaveLength(1);
  expect(runs[0].env.OMLX_FORCE).toBe("1");
});

it("retries with lighter profiles and throws when all fail", () => {
  f = fixture();
  f.repo.setSetting("local_llm_server", "omlx");
  startStatuses = [1, 1, 0];
  expect(startLocalLlm(f.repo, f.task().id)).toBe(2);
  expect(runs).toHaveLength(3);
  expect(runs[1].env.OMLX_SYSTEM_RESERVE_GB).toBe("8");
  startStatuses = [1, 1, 1, 1];
  expect(() => startLocalLlm(f.repo, f.task().id)).toThrow(/every profile/);
  expect(localLlmProfile(f.repo, f.task().id)).toBe(0);
});

it("stops omlx after a task unless keep_warm is set", () => {
  f = fixture();
  f.repo.setSetting("local_llm_server", "omlx");
  f.repo.setSetting("keep_warm", "1");
  stopLocalModelAfterTask(f.repo);
  expect(runs).toHaveLength(0);
  f.repo.setSetting("keep_warm", "0");
  stopLocalModelAfterTask(f.repo);
  expect(runs).toHaveLength(1);
  expect(runs[0].cmd).toMatch(/omlx-stop\.sh$/);
});
