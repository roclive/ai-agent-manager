import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openSync, closeSync, writeFileSync } from "node:fs";
import type { Project, Task } from "../db/index.js";
export interface Context {
  worktree: string;
  promptFile: string;
  runDir: string;
  sandbox?: string;
  modelArgs?: string[];
}
export interface Command {
  cmd: string;
  args: string[];
  stdinFile?: string;
}
export interface Adapter {
  name: string;
  command(ctx: Context): Command;
}
export const codex: Adapter = {
  name: "codex",
  command: (c) => ({
    cmd: "codex",
    args: [
      "exec",
      "--json",
      "-C",
      c.worktree,
      "-s",
      c.sandbox || "workspace-write",
      "-c",
      'approval_policy="never"',
      "-c",
      "sandbox_workspace_write.network_access=true",
      ...(c.modelArgs || []),
      "--skip-git-repo-check",
      "-o",
      `${c.runDir}/last.md`,
      "-",
    ],
    stdinFile: c.promptFile,
  }),
};
export const opencode: Adapter = {
  name: "opencode",
  command: (c) => ({
    cmd: process.execPath,
    args: [
      fileURLToPath(new URL("./opencode-launcher.mjs", import.meta.url)),
      c.worktree,
      c.promptFile,
    ],
  }),
};
export function command(worker: string, ctx: Context): Command {
  if (process.env.AAM_FAKE_WORKER)
    return {
      cmd: process.env.AAM_FAKE_WORKER,
      args: [ctx.worktree, ctx.promptFile],
    };
  if (worker === "codex") return codex.command(ctx);
  if (worker === "opencode") return opencode.command(ctx);
  throw new Error("Unknown worker");
}
export function prompt(project: Project, task: Task, mergeTask?: Task) {
  const mergeRules = mergeTask
    ? `\nIntegration resolution requirements:\n- First merge ${project.integration_branch} into this branch, then merge aam/${mergeTask.identifier}. Resolve every conflict preserving both sides. Do not replace the worktree with a snapshot from another branch.\n- For this merge-resolution task, git add and git commit are REQUIRED to finish resolved merges. This overrides general instructions to leave changes uncommitted.\n- Verify both refs are ancestors of HEAD with git merge-base --is-ancestor. Run the full project tests. Never claim success with missing functionality or an unfinished merge.\n`
    : "";
  return `Project: ${project.name}\nTask: ${task.identifier}: ${task.title}\nRole: ${task.role}\n\n${task.description}\n\nAcceptance: tests via ${project.test_cmd || "(no test command configured)"}\n\n${task.feedback ? `上一轮审查意见（必须逐条处理）\n${task.feedback}\n请逐条处理每个发现，并为每个发现添加回归测试。` : "Previous feedback:\n(none)"}\n\nRules:\n- Work only in this worktree. Do not touch files outside it.\n${mergeTask ? "- Complete and commit resolved merges as specified below." : "- Do not run git add or git commit; aam commits your changes for you."}\n- Do not push.\n- Write a short summary of what changed at the end.\n${mergeRules}`;
}
export function spawnWorker(worker: string, ctx: Context) {
  const c = command(worker, ctx);
  const log = openSync(`${ctx.runDir}/worker.log`, "a");
  // Shell code is constant; all paths and command arguments are positional parameters.
  const script = `trap '' HUP
exitfile=$1; input=$2; pidfile=$3; shift 3
if [ -n "$input" ]; then "$@" < "$input" & else "$@" & fi
worker=$!
printf "%s\\n" "$worker" > "$pidfile"
wait "$worker"
result=$?
printf "%s\\n" "$result" > "$exitfile"`;
  writeFileSync(`${ctx.runDir}/wrapper.sh`, script + "\n");
  try {
    const child = spawn(
      "sh",
      [
        `${ctx.runDir}/wrapper.sh`,
        `${ctx.runDir}/exit_code`,
        c.stdinFile || "",
        `${ctx.runDir}/worker.pid`,
        c.cmd,
        ...c.args,
      ],
      { cwd: ctx.worktree, detached: true, stdio: ["ignore", log, log] },
    );
    child.on("error", (e) =>
      writeFileSync(`${ctx.runDir}/spawn_error`, e.message),
    );
    child.unref();
    if (!child.pid) throw new Error("Could not start worker wrapper");
    return child.pid;
  } finally {
    closeSync(log);
  }
}
