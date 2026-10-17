import { spawnSync } from "node:child_process";
export interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}
export type Runner = (
  cmd: string,
  args: string[],
  cwd: string,
  input?: string,
  timeout?: number,
) => Result;
export const runner: Runner = (cmd, args, cwd, input, timeout = 120000) => {
  const r = spawnSync(cmd, args, {
    cwd,
    input,
    encoding: "utf8",
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: r.status,
    stdout: r.stdout || "",
    stderr: (r.stderr || "") + (r.error?.message || ""),
  };
};
export function git(cwd: string, args: string[]) {
  const r = runner("git", args, cwd);
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "Git failed");
  return r.stdout.trim();
}
export function alive(pid: number | null) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
export function killGroup(pid: number | null) {
  if (pid)
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already stopped */
      }
    }
}
