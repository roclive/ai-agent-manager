import {
  readFileSync,
  writeFileSync,
  existsSync,
  lstatSync,
  realpathSync,
  readlinkSync,
} from "node:fs";
import { dirname, resolve, relative, isAbsolute } from "node:path";
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
function externalSymlinks(worktree: string) {
  const root = realpathSync(worktree);
  const paths = git(worktree, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .split("\0")
    .filter(Boolean);
  return [...new Set(paths)].filter((name) => {
    const file = resolve(worktree, name);
    let stat;
    try {
      stat = lstatSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    if (!stat.isSymbolicLink()) return false;
    let target;
    try {
      target = realpathSync(file);
    } catch {
      target = resolve(dirname(file), readlinkSync(file));
    }
    const rel = relative(root, target);
    return rel === ".." || rel.startsWith("../") || isAbsolute(rel);
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
      const merging =
        runner("git", ["rev-parse", "--verify", "MERGE_HEAD"], t.worktree_path)
          .status === 0;
      if (git(t.worktree_path, ["diff", "--name-only", "--diff-filter=U"]))
        throw new Error("Unresolved merge conflicts");
      if (merging || git(t.worktree_path, ["status", "--porcelain"])) {
        const skipped = externalSymlinks(t.worktree_path);
        if (skipped.length) {
          git(t.worktree_path, [
            "reset",
            "HEAD",
            "--",
            ...skipped.map((name) => `:(literal)${name}`),
          ]);
          repo.event(
            "finalize_skip_symlink",
            `Skipped external symlinks: ${JSON.stringify(skipped)}`,
            t.id,
          );
        }
        git(t.worktree_path, [
          "add",
          "-A",
          "--",
          ".",
          ...skipped.map((name) => `:(exclude,literal)${name}`),
        ]);
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
        if (
          merging ||
          git(t.worktree_path, ["diff", "--cached", "--name-only"])
        )
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
  let recovered = false;
  if (
    terminal === "lost" &&
    !commitError &&
    (testExit === null || testExit === 0)
  ) {
    try {
      recovered =
        !!run.start_sha &&
        git(t.worktree_path!, ["rev-parse", "HEAD"]) !== run.start_sha;
    } catch {
      /* Cannot establish recovery without a valid HEAD. */
    }
  }
  const success =
    recovered ||
    (!terminal &&
      exit === 0 &&
      (testExit === null || testExit === 0) &&
      !commitError);
  const summary = logTail(
    [workerLog, testLog, commitError, terminal || ""]
      .filter(Boolean)
      .join("\n"),
  );
  const lost = terminal === "lost";
  const lostCount = t.lost_count + (lost ? 1 : 0);
  const attempts = t.attempts + (success || lost ? 0 : 1);
  const blocked =
    !success && (lost ? lostCount >= 3 : attempts >= t.max_attempts);
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
      lost_count: lostCount,
      feedback: lost ? logTail(testLog) : success ? t.feedback : summary,
      blocker: blocked
        ? lost
          ? "worker repeatedly lost"
          : summary || "Maximum attempts reached"
        : "",
    });
    repo.event(
      "finalize",
      recovered
        ? "lost run recovered"
        : `Run ${run.id}: ${terminal || (success ? "succeeded" : "failed")}`,
      t.id,
    );
  })();
}
