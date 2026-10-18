import { mkdtempSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Repo, type Project, type Task } from "../db/index.js";
import { withLock } from "./lock.js";
import { git, runner } from "./process.js";

export function setIntegration(repo: Repo, key: string, mode: string) {
  if (!["on", "off"].includes(mode)) throw new Error("Expected on or off");
  const p = repo.project(key);
  if (
    mode === "on" &&
    runner(
      "git",
      ["show-ref", "--verify", "--quiet", "refs/heads/aam/integration"],
      p.repo_path,
    ).status !== 0
  )
    git(p.repo_path, ["branch", "aam/integration", p.base_branch]);
  repo.db
    .prepare("UPDATE projects SET integration_branch=? WHERE id=?")
    .run(mode === "on" ? "aam/integration" : "", p.id);
  const summary = { integrated: 0, pending: 0, skipped: 0 };
  if (mode === "on" && !p.integration_branch) {
    const tasks = repo
      .tasks({ project: key, status: "done" })
      .filter((t) => t.branch)
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id - b.id);
    for (const t of tasks)
      repo.updateTask(t.id, { integrated: 0, integration_attempts: 0 });
    for (const t of tasks) {
      if (openResolution(repo, t.id)) {
        summary.skipped++;
        continue;
      }
      integrate(repo, t.identifier);
      if (repo.task(t.id).integrated) summary.integrated++;
      else summary.pending++;
    }
  }
  repo.event("integration", `${key}: ${mode}; ${JSON.stringify(summary)}`);
  return summary;
}
function temporary(
  repo: Repo,
  p: Project,
  branch: string,
  action: (path: string) => void,
) {
  const root = resolve(repo.home, "integration");
  mkdirSync(root, { recursive: true });
  const path = mkdtempSync(resolve(root, "merge-"));
  git(p.repo_path, ["worktree", "add", path, branch]);
  try {
    action(path);
  } finally {
    runner("git", ["merge", "--abort"], path);
    git(p.repo_path, ["worktree", "remove", "--force", path]);
  }
}
export function integrationStatus(p: Project) {
  if (!p.integration_branch)
    return { ahead_of_base: 0, integration_commits: "" };
  try {
    const range = `${p.base_branch}..${p.integration_branch}`;
    return {
      ahead_of_base: Number(git(p.repo_path, ["rev-list", "--count", range])),
      integration_commits: git(p.repo_path, ["log", "--oneline", range]),
    };
  } catch {
    return {
      ahead_of_base: null,
      integration_commits: "",
      integration_error: "Integration branch unavailable",
    };
  }
}
export function openResolution(repo: Repo, id: number, exclude?: number) {
  return repo
    .tasks()
    .some(
      (t) =>
        t.id !== exclude &&
        t.resolves_task_id === id &&
        !["done", "cancelled"].includes(t.status),
    );
}
function supersededResolution(repo: Repo, task: Task) {
  if (!task.resolves_task_id) return false;
  const p = repo.project(task.project_id);
  if (!p.integration_branch) return false;
  return repo
    .tasks()
    .some(
      (newer) =>
        newer.id > task.id &&
        newer.resolves_task_id === task.resolves_task_id &&
        newer.status === "done" &&
        newer.integrated === 1 &&
        newer.branch &&
        runner(
          "git",
          ["merge-base", "--is-ancestor", newer.branch, p.integration_branch],
          p.repo_path,
        ).status === 0,
    );
}
export function reconcileIntegration(repo: Repo) {
  for (const t of repo
    .tasks({ status: "done" })
    .sort(
      (a, b) => Number(!!b.resolves_task_id) - Number(!!a.resolves_task_id),
    ))
    if (
      t.branch &&
      !t.integrated &&
      !supersededResolution(repo, t) &&
      !(
        !t.resolves_task_id &&
        repo
          .tasks()
          .some(
            (r) =>
              r.resolves_task_id === t.id &&
              r.status === "done" &&
              !r.integrated,
          )
      ) &&
      t.integration_attempts < 5 &&
      repo.project(t.project_id).integration_branch &&
      !openResolution(repo, t.resolves_task_id || t.id)
    )
      integrate(repo, t.identifier);
}
export function integrate(repo: Repo, id: string) {
  const task = repo.task(id);
  if (
    !repo.project(task.project_id).integration_branch ||
    task.integration_attempts >= 5 ||
    supersededResolution(repo, task)
  )
    return;
  repo.updateTask(task.id, { integrated: 0 });
  const result = withLock(
    repo,
    () => {
      integrateLocked(repo, id);
      return true;
    },
    "integration",
  );
  if (!result) integrationFailure(repo, task.id, "Integration lock busy");
}
function integrationFailure(repo: Repo, id: number, error: string) {
  const attempts = repo.task(id).integration_attempts + 1;
  repo.updateTask(id, { integration_attempts: attempts });
  repo.event(
    attempts === 5 ? "integration_blocked" : "integration_error",
    error,
    id,
  );
}
function integrateLocked(repo: Repo, id: string) {
  const t = repo.task(id),
    p = repo.project(t.project_id);
  if (!p.integration_branch) return;
  const original = t.resolves_task_id ? repo.task(t.resolves_task_id) : t;
  if (openResolution(repo, original.id, t.id) || t.integration_attempts >= 5)
    return;
  try {
    if (!t.branch) throw new Error("No task branch");
    const ancestor = runner(
      "git",
      ["merge-base", "--is-ancestor", t.branch, p.integration_branch],
      p.repo_path,
    );
    if (ancestor.status !== 0 && ancestor.status !== 1)
      throw new Error(ancestor.stderr || "Ancestor check failed");
    if (ancestor.status !== 0)
      temporary(repo, p, p.integration_branch, (path) => {
        const result = runner("git", ["merge", "--no-edit", t.branch!], path);
        if (result.status === 0) return;
        const files = git(path, ["diff", "--name-only", "--diff-filter=U"]);
        if (!files) throw new Error(result.stderr || result.stdout);
        const hunks = git(path, ["diff", "--cc"]).slice(0, 24000);
        const count = repo
          .tasks()
          .filter((x) => x.resolves_task_id === original.id).length;
        const max = Number(repo.getSetting("integration_max_resolves")) || 10;
        if (count >= max) {
          repo.updateTask(original.id, {
            status: "blocked",
            blocker: `Integration conflict: maximum ${max} resolution tasks exhausted`,
          });
          repo.event(
            "integration_blocked",
            `Maximum ${max} conflict-resolution tasks exhausted`,
            original.id,
          );
        } else {
          const task = repo.addTask({
            project: p.key,
            title: `Resolve merge conflict: ${original.identifier} into integration`,
            priority: "P0",
            role: "any",
            worker: original.worker,
            status: "ready",
            integrated: 0,
            resolves_task_id: original.id,
            description: `${original.title}\n\nConflicting files:\n${files}\n\n${hunks}\n\nIn this worktree (branched from the current integration tip) run git merge aam/${original.identifier}, resolve every conflict keeping BOTH sides' intent (registries/imports: union; docs: keep both sections), run the project tests, leave the merge COMMITTED.\nPrevious resolution branch, if useful: ${t.branch}`,
          });
          repo.event(
            "integration_conflict",
            `Created ${task.identifier}; files: ${files}`,
            original.id,
          );
        }
        throw new Error("Merge conflict recorded");
      });
    repo.updateTask(t.id, { integrated: 1, integration_attempts: 0 });
    repo.updateTask(original.id, { integrated: 1, integration_attempts: 0 });
    repo.event(
      "integrate",
      `Integrated ${t.identifier} into ${p.integration_branch}`,
      original.id,
    );
  } catch (error) {
    if (!(
      error instanceof Error && error.message === "Merge conflict recorded"
    ))
      integrationFailure(repo, t.id, String(error));
  }
}
export function promote(
  repo: Repo,
  key: string,
  confirm: boolean,
  into?: string,
) {
  if (confirm !== true)
    throw new Error("Explicit confirmation required (--yes / confirm:true)");
  const p = repo.project(key);
  if (!p.integration_branch) throw new Error("Integration disabled");
  const target = into || p.base_branch;
  if (target !== p.base_branch)
    throw new Error("Promotion target must be the configured base branch");
  const records = git(p.repo_path, ["worktree", "list", "--porcelain"]).split(
    "\n\n",
  );
  const record = records.find((r) =>
    r.split("\n").includes(`branch refs/heads/${target}`),
  );
  const checkout = record?.split("\n")[0].slice(9);
  const merge = (path: string) => {
    if (git(path, ["status", "--porcelain"]))
      throw new Error("Base checkout has uncommitted changes");
    try {
      git(path, ["merge", "--no-edit", p.integration_branch]);
    } catch (e) {
      runner("git", ["merge", "--abort"], path);
      throw e;
    }
  };
  if (checkout) merge(checkout);
  else temporary(repo, p, target, merge);
  repo.event(
    "integration_promote",
    `Promoted ${p.integration_branch} into ${target}`,
  );
}
