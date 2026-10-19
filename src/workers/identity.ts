import { closeSync, openSync, readSync, existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

export type WorkerKind =
  | "codex"
  | "claude"
  | "opencode"
  | "pi"
  | "hermes"
  | "fake"
  | "other"
  | "unknown";
export interface WorkerIdentity {
  kind: WorkerKind;
  model: string;
  label: string;
}

const KNOWN = ["codex", "claude", "opencode", "pi", "hermes"] as const;
const KIND_NAME: Record<string, string> = {
  codex: "Codex",
  claude: "Claude",
  opencode: "opencode",
  pi: "pi",
  hermes: "Hermes",
  fake: "fake",
  other: "other",
  unknown: "unknown",
};

export function makeIdentity(kind: WorkerKind, model = ""): WorkerIdentity {
  const base = KIND_NAME[kind] ?? kind;
  return { kind, model, label: model ? `${base} (${model})` : base };
}

// Adapter scripts declare who they are with a first-lines header comment:
//   # aam-worker: claude sonnet
function readHead(file: string, bytes = 1024) {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const buf = Buffer.alloc(bytes);
    return buf.subarray(0, readSync(fd, buf, 0, bytes, 0)).toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function scriptIdentity(script: string): WorkerIdentity {
  const head = readHead(script).split("\n").slice(0, 5);
  for (const line of head) {
    const m = /^\s*#\s*aam-worker:\s*(\S+)(?:\s+(.+?))?\s*$/.exec(line);
    if (!m) continue;
    const kind = m[1].toLowerCase();
    const model = m[2] ?? "";
    if ((KNOWN as readonly string[]).includes(kind))
      return makeIdentity(kind as WorkerKind, model);
    return { kind: "other", model, label: model ? `${m[1]} (${model})` : m[1] };
  }
  return { kind: "fake", model: "", label: basename(script) };
}

// Identity of the executor that is really spawned for this run.
export function detectIdentity(
  worker: string,
  opts: { model?: string; modelArgs?: string[] } = {},
  fakeWorker = process.env.AAM_FAKE_WORKER,
): WorkerIdentity {
  if (fakeWorker) return scriptIdentity(fakeWorker);
  const args = opts.modelArgs ?? [];
  const i = args.indexOf("-m");
  const model = opts.model || (i >= 0 ? args[i + 1] : "") || "default";
  if (worker === "codex") return makeIdentity("codex", model);
  if (worker === "opencode") return makeIdentity("opencode", model);
  if (worker === "claude") return makeIdentity("claude", "sonnet");
  if (worker === "pi" || worker === "hermes")
    return makeIdentity(worker, opts.model ?? "");
  return { kind: "other", model: "", label: worker };
}

// Best-effort identity for runs recorded before worker identity existed.
export function inferIdentity(
  worker: string,
  runDir: string,
): WorkerIdentity {
  let model = "";
  try {
    const b = JSON.parse(readFileSync(`${runDir}/backend.json`, "utf8"));
    if (b.worker_kind)
      return { kind: b.worker_kind, model: b.worker_model ?? "", label: b.worker_label ?? b.worker_kind };
    if (b.backend === "ollama") model = b.model ?? "";
  } catch {
    /* no backend.json */
  }
  const log = existsSync(`${runDir}/worker.log`)
    ? readHead(`${runDir}/worker.log`, 4096)
    : "";
  if (/claude/i.test(log) && !/codex/i.test(log))
    return makeIdentity("claude");
  if (worker === "opencode") return makeIdentity("opencode");
  if (worker === "codex" && (log === "" || /codex|thread\.started|"type"/i.test(log)))
    return makeIdentity("codex", model);
  return makeIdentity("unknown");
}
