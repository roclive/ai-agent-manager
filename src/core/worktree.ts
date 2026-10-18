import { mkdirSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { Repo, type Task } from "../db/index.js";
import { git, runner } from "./process.js";
// NUL records preserve spaces, quotes, and newlines in Git paths.
function untrackedRoots(path: string) {
  const status = git(path, [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "-z",
  ]);
  const roots = new Set<string>();
  const records = status.split("\0");
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.startsWith("?? ")) roots.add(record.slice(3).split("/")[0]);
    if (
      record[0] === "R" ||
      record[0] === "C" ||
      record[1] === "R" ||
      record[1] === "C"
    )
      i++;
  }
  return roots;
}
function excludeSetupPaths(
  path: string,
  before: Set<string>,
  repo: Repo,
  taskId: number,
) {
  const added = [...untrackedRoots(path)].filter((name) => !before.has(name));
  if (!added.length) return;
  const file = resolve(
    path,
    git(path, ["rev-parse", "--git-common-dir"]),
    "info/exclude",
  );
  mkdirSync(dirname(file), { recursive: true });
  const contents = existsSync(file) ? readFileSync(file, "utf8") : "";
  const existing = new Set(contents.split("\n"));
  // Root anchoring also matches symlinks; escape gitignore metacharacters.
  const patterns = added.map(
    (name) => "/" + name.replace(/[\\*?\[\] !#]/g, "\\$&"),
  );
  const fresh = patterns.filter((pattern) => !existing.has(pattern));
  if (fresh.length)
    appendFileSync(
      file,
      (contents && !contents.endsWith("\n") ? "\n" : "") +
        fresh.join("\n") +
        "\n",
    );
  repo.event(
    "setup_exclude",
    `Excluded setup paths: ${JSON.stringify(added)}`,
    taskId,
  );
}
export function ensureWorktree(repo: Repo, t: Task) {
  const p = repo.project(t.project_id);
  const path = resolve(repo.home, "worktrees", p.key, t.identifier);
  const branch = `aam/${t.identifier}`;
  let newBranch = false;
  let created = false;
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    const exists =
      runner(
        "git",
        ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
        p.repo_path,
      ).status === 0;
    git(p.repo_path, [
      "worktree",
      "add",
      ...(exists ? [] : ["-b", branch]),
      path,
      exists ? branch : p.integration_branch || p.base_branch,
    ]);
    newBranch = !exists;
    created = true;
  }
  for (const dep of (p.integration_branch
    ? []
    : JSON.parse(t.depends_on)) as string[]) {
    const ref = `refs/heads/aam/${dep}`;
    if (
      runner("git", ["show-ref", "--verify", "--quiet", ref], path).status !== 0
    )
      continue;
    if (
      runner("git", ["merge-base", "--is-ancestor", ref, "HEAD"], path)
        .status === 0
    )
      continue;
    try {
      git(path, ["merge", "--no-edit", ref]);
      repo.event("dependency_merge", `Merged dependency ${dep}`, t.id);
    } catch {
      runner("git", ["merge", "--abort"], path);
      if (newBranch) {
        git(p.repo_path, ["worktree", "remove", "--force", path]);
        git(p.repo_path, ["branch", "-D", branch]);
      }
      throw new Error(`dependency merge conflict: ${dep}`);
    }
  }
  if (created) {
    repo.updateTask(t.id, { branch, worktree_path: path });
    if (p.setup_cmd) {
      const before = untrackedRoots(path);
      const r = runner("sh", ["-c", p.setup_cmd], path);
      excludeSetupPaths(path, before, repo, t.id);
      repo.event("setup", r.stdout + r.stderr, t.id);
      if (r.status !== 0) throw new Error(`Setup failed: ${r.stderr}`);
    }
  }
  repo.updateTask(t.id, { branch, worktree_path: path });
  return path;
}
export function prune(repo: Repo, id: string) {
  const t = repo.task(id);
  if (repo.runs(t.id).some((r) => r.status === "running"))
    throw new Error("Task has a running worker");
  const p = repo.project(t.project_id);
  if (t.worktree_path && existsSync(t.worktree_path))
    git(p.repo_path, ["worktree", "remove", t.worktree_path]);
  repo.updateTask(id, { worktree_path: null });
  repo.event("prune", "Worktree removed; branch retained", t.id);
}
export function merge(repo: Repo, id: string, into: string) {
  const t = repo.task(id),
    p = repo.project(t.project_id);
  if (into === p.base_branch || into === `refs/heads/${p.base_branch}`)
    throw new Error("Refusing to merge into base branch");
  if (t.status !== "done") throw new Error("Only approved tasks can be merged");
  if (!t.branch) throw new Error("No task branch");
  into = git(p.repo_path, [
    "check-ref-format",
    "--branch",
    into.replace(/^refs\/heads\//, ""),
  ]);
  const base = p.base_branch.replace(/^refs\/heads\//, "");
  if (into === base) throw new Error("Refusing to merge into base branch");
  git(p.repo_path, ["show-ref", "--verify", `refs/heads/${into}`]);
  const path = resolve(
    repo.home,
    "integration",
    `${t.identifier}-${process.pid}`,
  );
  mkdirSync(dirname(path), { recursive: true });
  git(p.repo_path, ["worktree", "add", path, into]);
  try {
    git(path, ["merge", "--no-edit", t.branch]);
    repo.event("merge", `Merged into ${into}`, t.id);
  } finally {
    runner("git", ["merge", "--abort"], path);
    git(p.repo_path, ["worktree", "remove", path]);
  }
}
