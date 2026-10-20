import { CLAUDE_WORKER_SCRIPT, isClaudeWorkerScript } from "./claude-script.js";
import { claudeSettings } from "../core/claude-settings.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openSync, closeSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Project, Task } from "../db/index.js";
export interface Context {
  worktree: string;
  promptFile: string;
  runDir: string;
  sandbox?: string;
  modelArgs?: string[];
  provider?: string;
  // Only set for the low-quota fallback; other opencode runs keep the pinned default model.
  model?: string;
  effort?: "default" | "low" | "medium" | "high" | "xhigh" | "max";
  fast?: boolean;
  timeoutMin?: number;
  localBaseUrl?: string;
  localContext?: number;
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
      ...(c.effort && c.effort !== "default"
        ? ["-c", `model_reasoning_effort=${JSON.stringify(c.effort)}`]
        : []),
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
      ...(c.provider || c.model ? [c.provider || ""] : []),
      ...(c.model ? [c.model] : []),
      ...(c.localBaseUrl ? [c.localBaseUrl, String(c.localContext || 32768)] : []),
    ],
  }),
};
export const claude: Adapter = {
  name: "claude",
  // The script reads the prompt itself; configuration travels as separate argv entries.
  command: (c) => {
    const config = claudeSettings(c);
    return {
      cmd: "sh",
      args: [
        CLAUDE_WORKER_SCRIPT,
        c.worktree,
        c.promptFile,
        config.model,
        config.effort,
        String(config.fast),
        String(c.timeoutMin ?? 45),
      ],
    };
  },
};
// pi (https://github.com/badlogic/pi-mono): -p is non-interactive; @file attaches the prompt file.
export const pi: Adapter = {
  name: "pi",
  command: (c) => ({
    cmd: "pi",
    args: [
      "-p",
      "--no-session",
      `@${c.promptFile}`,
      "Carry out the attached task in the current directory. Do not run git add, git commit or git push.",
    ],
  }),
};
// Hermes Agent (Nous Research): `hermes chat --quiet -q <prompt>` is the one-shot mode.
export const hermes: Adapter = {
  name: "hermes",
  command: (c) => ({
    cmd: "sh",
    args: ["-c", 'exec hermes chat --quiet -q "$(cat "$1")"', "hermes", c.promptFile],
  }),
};
export function command(worker: string, ctx: Context): Command {
  if (process.env.AAM_FAKE_WORKER && isClaudeWorkerScript(process.env.AAM_FAKE_WORKER))
    return claude.command({ ...ctx, model: worker === "claude" ? ctx.model : undefined });
  if (process.env.AAM_FAKE_WORKER)
    return {
      cmd: process.env.AAM_FAKE_WORKER,
      args: [ctx.worktree, ctx.promptFile],
    };
  if (worker === "codex") return codex.command(ctx);
  if (worker === "opencode") return opencode.command(ctx);
  if (worker === "claude") return claude.command(ctx);
  if (worker === "pi") return pi.command(ctx);
  if (worker === "hermes") return hermes.command(ctx);
  throw new Error("Unknown worker");
}
const CONVENTION_FILES = ["CLAUDE.md", "MANAGER.md"];
const EXCERPT_CHARS = 4000;
const TOOLS = [
  "- Shell commands in the worktree (read, search, run tests).",
  "- File read/edit/write inside the worktree.",
  "- git for inspection (status, diff, log).",
].join("\n");
function conventions(project: Project) {
  const parts: string[] = [];
  for (const name of CONVENTION_FILES) {
    try {
      const text = readFileSync(join(project.repo_path, name), "utf8")
        .replace(/\r\n/g, "\n")
        .trim();
      if (text)
        parts.push(`### ${name}\n${text.slice(0, EXCERPT_CHARS)}`);
    } catch {
      // Missing convention files are simply omitted.
    }
  }
  return parts.length ? parts.join("\n\n") : "(none)";
}
// Byte-stable across tasks of one project: no timestamps, run ids or
// task-specific text. Task text is appended after this prefix.
export function promptPrefix(project: Project) {
  return `You are a coding worker managed by aam.\n\nProject: ${project.name}\nAcceptance: tests via ${project.test_cmd || "(no test command configured)"}\n\nRules:\n- Work only in this worktree. Do not touch files outside it.\n- Do not push.\n- Write a short summary of what changed at the end.\n\nProject conventions:\n${conventions(project)}\n\nTools:\n${TOOLS}\n\n=== TASK ===\n`;
}
export function promptPrefixHash(project: Project) {
  return createHash("sha256").update(promptPrefix(project)).digest("hex");
}
export function prompt(project: Project, task: Task, mergeTask?: Task) {
  const mergeRules = mergeTask
    ? `\nIntegration resolution requirements:\n- First merge ${project.integration_branch} into this branch, then merge aam/${mergeTask.identifier}. Resolve every conflict preserving both sides. Do not replace the worktree with a snapshot from another branch.\n- For this merge-resolution task, git add and git commit are REQUIRED to finish resolved merges. This overrides general instructions to leave changes uncommitted.\n- Verify both refs are ancestors of HEAD with git merge-base --is-ancestor. Run the full project tests. Never claim success with missing functionality or an unfinished merge.\n`
    : "";
  return `${promptPrefix(project)}Task: ${task.identifier}: ${task.title}\nRole: ${task.role}\n\n${task.description}\n\n${task.feedback ? `上一轮审查意见（必须逐条处理）\n${task.feedback}\n请逐条处理每个发现，并为每个发现添加回归测试。` : "Previous feedback:\n(none)"}\n\n${mergeTask ? "- Complete and commit resolved merges as specified below." : "- Do not run git add or git commit; aam commits your changes for you."}\n${mergeRules}`;
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
