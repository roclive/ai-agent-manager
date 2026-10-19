import { execFileSync } from "node:child_process";

/** Command runner; tests inject fakes for ps/footprint/vm_stat/memory_pressure/brew/launchctl. */
export type Run = (cmd: string, args: string[]) => string;

export const defaultRun: Run = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8", timeout: 15_000 });

/** Processes that must never be signalled or stopped (matched against the command line). */
export const DENY_PATTERNS: RegExp[] = [
  /\baam\b/i,
  /ai-agent-manager/i,
  /ontokb/i,
  /paperclip/i,
  /claude/i,
  /codex/i,
  /chatgpt/i,
  /windowserver/i,
];

export const isDenied = (text: string) => DENY_PATTERNS.some((r) => r.test(text));

/** Services that are disposable and may be stopped gracefully. */
export const ALLOWED_SERVICES: Record<
  string,
  { brew: string; launchd: string }
> = {
  omlx: { brew: "omlx", launchd: "homebrew.mxcl.omlx" },
  "homebrew.mxcl.omlx": { brew: "omlx", launchd: "homebrew.mxcl.omlx" },
};

export interface ProcFootprint {
  pid: number;
  command: string;
  footprintMb: number;
  denied: boolean;
}

export function parseSize(s: string): number {
  const m = /([\d.]+)\s*([KMGT]?)B?/i.exec(s.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  const f = { "": 1 / 1048576, K: 1 / 1024, M: 1, G: 1024, T: 1048576 }[
    m[2].toUpperCase() as "" | "K" | "M" | "G" | "T"
  ];
  return n * f;
}

/** Parse `footprint -p <pid>` output: "... [pid]: 64-bit    Footprint: 1234 MB (16384 bytes per page)". */
export function parseFootprint(out: string): number | undefined {
  const m = /Footprint:\s*([\d.]+\s*[KMGT]?B)/i.exec(out);
  return m ? parseSize(m[1]) : undefined;
}

export function topProcesses(run: Run = defaultRun, limit = 10): ProcFootprint[] {
  const lines = run("ps", ["-axo", "pid=,comm="]).split("\n");
  const out: ProcFootprint[] = [];
  for (const line of lines) {
    const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    let fp: number | undefined;
    try {
      fp = parseFootprint(run("footprint", ["-p", String(pid)]));
    } catch {
      continue;
    }
    if (fp === undefined) continue;
    out.push({ pid, command: m[2], footprintMb: fp, denied: isDenied(m[2]) });
  }
  return out.sort((a, b) => b.footprintMb - a.footprintMb).slice(0, limit);
}

export function availableMemory(run: Run = defaultRun): {
  freeGb: number;
  pressure: string;
} {
  const vm = run("vm_stat", []);
  const page = Number(/page size of (\d+) bytes/.exec(vm)?.[1] ?? 16384);
  const pages = (k: string) =>
    Number(new RegExp(`Pages ${k}:\\s+(\\d+)`).exec(vm)?.[1] ?? 0);
  const freeGb =
    ((pages("free") + pages("inactive") + pages("speculative")) * page) /
    1073741824;
  let pressure = "unknown";
  try {
    const mp = run("memory_pressure", []);
    pressure =
      /System-wide memory free percentage:\s*(\d+)%/.exec(mp)?.[0] ??
      mp.split("\n").find((l) => l.trim())?.trim() ??
      "unknown";
  } catch {
    /* informational only */
  }
  return { freeGb: Math.round(freeGb * 100) / 100, pressure };
}

/** Gracefully stop one allow-listed service. Never signals processes directly. */
export function stopService(label: string, run: Run = defaultRun) {
  if (isDenied(label)) throw new Error(`Refusing: ${label} is deny-listed`);
  const svc = ALLOWED_SERVICES[label];
  if (!svc)
    throw new Error(
      `Refusing: ${label} is not allow-listed (${Object.keys(ALLOWED_SERVICES).join(", ")})`,
    );
  try {
    run("brew", ["services", "stop", svc.brew]);
    return { label, method: "brew services stop" };
  } catch {
    const uid = String(process.getuid?.() ?? 501);
    run("launchctl", ["bootout", `gui/${uid}/${svc.launchd}`]);
    return { label, method: "launchctl bootout" };
  }
}
