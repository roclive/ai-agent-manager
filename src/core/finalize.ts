import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Repo, type Run } from "../db/index.js";
import { git, runner } from "./process.js";
export function read(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
export function logTail(text: string, n = 80) {
  return text.trimEnd().split("\n").slice(-n).join("\n");
}
export function rateLimited(text: string, exitCode: number | null = null) {
  if (exitCode === 0) return false;
  return text.split("\n").some((line) => {
    let errorish: boolean;
    try {
      const event = JSON.parse(line);
      errorish =
        event?.type === "error" ||
        event?.type === "turn.failed" ||
        /"error"\s*:/.test(line);
    } catch {
      errorish = /\b(error|ERROR|Error)\b/.test(line);
    }
    return (
      errorish &&
      /usage limit|rate[ _-]?limit(ed)?|\b429\b|quota exceeded|insufficient_quota/i.test(
        line,
      )
    );
  });
}
export function finalize(repo: Repo, run: Run, terminal?: "timeout" | "lost") {
  if (repo.runs().find((r) => r.id === run.id)?.status !== "running") return;
  const t = repo.task(run.task_id),
    p = repo.project(t.project_id),
    dir = dirname(run.log_path);
  const exitText = read(resolve(dir, "exit_code")).trim();
  const exit = /^\d+$/.test(exitText) ? Number(exitText) : null;
  const workerLog = logTail(read(run.log_path));
  if (!terminal && rateLimited(workerLog, exit)) {
    repo.db.transaction(() => {
      repo.db
        .prepare(
          "UPDATE runs SET status='rate_limited',ended_at=?,exit_code=?,summary=? WHERE id=?",
        )
        .run(new Date().toISOString(), exit, workerLog, run.id);
      repo.updateTask(t.id, { status: "ready" });
      repo.setSetting(
        "cooldown_until",
        new Date(Date.now() + 30 * 60000).toISOString(),
      );
      repo.event(
        "cooldown",
        "Rate limit detected; dispatch paused for 30 minutes",
        t.id,
      );
    })();
    return;
  }
  let testExit: number | null = null;
  let testLog = "";
  let commitError = "";
  if (t.worktree_path && existsSync(t.worktree_path)) {
    try {
      if (git(t.worktree_path, ["status", "--porcelain"])) {
        git(t.worktree_path, ["add", "-A"]);
        const last = read(resolve(dir, "last.md"));
        const firstLine = last
          .split("\n")
          .map((line) => line.trim())
          .find(Boolean);
        const subject = firstLine
          ? `${t.identifier}: ${firstLine.slice(0, 72)}`
          : `aam: ${t.identifier} ${t.title}`;
        // Bound the body in UTF-8 bytes without splitting a character.
        let body = "";
        for (const char of last) {
          if (Buffer.byteLength(body + char) > 4096) break;
          body += char;
        }
        git(t.worktree_path, [
          "commit",
          "-m",
          subject,
          ...(body ? ["-m", body] : []),
        ]);
      }
    } catch (e) {
      commitError = String(e);
    }
    if (p.test_cmd) {
      const r = runner(
        "sh",
        ["-c", p.test_cmd],
        t.worktree_path,
        undefined,
        Number(repo.getSetting("worker_timeout_min")) * 60000,
      );
      testExit = r.status ?? 1;
      testLog = r.stdout + r.stderr;
      writeFileSync(resolve(dir, "test.log"), testLog);
    }
  } else commitError = "Worktree missing";
  const success =
    !terminal &&
    exit === 0 &&
    (testExit === null || testExit === 0) &&
    !commitError;
  const summary = logTail(
    [workerLog, testLog, commitError, terminal || ""]
      .filter(Boolean)
      .join("\n"),
  );
  const attempts = t.attempts + (success ? 0 : 1);
  const blocked = !success && attempts >= t.max_attempts;
  repo.db.transaction(() => {
    repo.db
      .prepare(
        "UPDATE runs SET status=?,ended_at=?,exit_code=?,test_exit_code=?,summary=? WHERE id=?",
      )
      .run(
        terminal || (success ? "succeeded" : "failed"),
        new Date().toISOString(),
        exit,
        testExit,
        summary,
        run.id,
      );
    repo.updateTask(t.id, {
      status: success ? "in_review" : blocked ? "blocked" : "ready",
      attempts,
      feedback: success ? t.feedback : summary,
      blocker: blocked ? summary || "Maximum attempts reached" : "",
    });
    repo.event(
      "finalize",
      `Run ${run.id}: ${terminal || (success ? "succeeded" : "failed")}`,
      t.id,
    );
  })();
}
