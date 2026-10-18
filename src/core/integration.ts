import { mkdtempSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Repo, type Project } from "../db/index.js";
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
  repo.event("integration", `${key}: ${mode}`);
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
export function integrate(repo: Repo, id: string) {
  const t = repo.task(id),
    p = repo.project(t.project_id);
  if (!p.integration_branch) return;
  const original = t.resolves_task_id ? repo.task(t.resolves_task_id) : t;
  repo.updateTask(t.id, { integrated: 0 });
  try {
    if (!t.branch) throw new Error("No task branch");
    temporary(repo, p, p.integration_branch, (path) => {
      const result = runner("git", ["merge", "--no-edit", t.branch!], path);
      if (result.status === 0) return;
      const files = git(path, ["diff", "--name-only", "--diff-filter=U"]);
      if (!files) throw new Error(result.stderr || result.stdout);
      const hunks = git(path, ["diff", "--cc"]).slice(0, 24000);
      const count = repo
        .tasks()
        .filter((x) => x.resolves_task_id === original.id).length;
      if (count >= 2) {
        repo.updateTask(original.id, {
          status: "blocked",
          blocker: "Integration conflict: maximum 2 resolution tasks exhausted",
        });
        repo.event(
          "integration_blocked",
          "Maximum 2 conflict-resolution tasks exhausted",
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
    repo.updateTask(t.id, { integrated: 1 });
    repo.updateTask(original.id, { integrated: 1 });
    repo.event(
      "integrate",
      `Integrated ${t.identifier} into ${p.integration_branch}`,
      original.id,
    );
  } catch (error) {
    if (!(
      error instanceof Error && error.message === "Merge conflict recorded"
    ))
      repo.event("integration_error", String(error), original.id);
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
  repo.event("promote", `Promoted ${p.integration_branch} into ${target}`);
}
