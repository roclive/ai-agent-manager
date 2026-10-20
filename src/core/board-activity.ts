import { Repo, type Task } from "../db/index.js";
import { dependenciesDone, dispatchAvailability, globalCooldownBlocks, resolutionBusy } from "./dispatch.js";
import { reviewWaitReason } from "./autopilot.js";
import { runLive } from "../api/slim.js";

type ReviewJob = { id: number; task_id: number; started_at: string; provider: string | null; reviewer_identity: string | null };
export type BoardActivityItem = {
  kind: "coding" | "review";
  status: "running" | "pending";
  activity_id: number;
  task_id: number;
  identifier: string;
  title: string;
  started_at: string;
  worktree_path: string | null;
  branch: string | null;
  identity: string | null;
};

function dispatchReason(repo: Repo, task: Task) {
  if (repo.project(task.project_id).hidden) return "项目已隐藏";
  if (!dependenciesDone(repo, task)) return "任务依赖尚未完成或集成";
  if (resolutionBusy(repo, task)) return "同项目有需串行处理的活动工作或审查";
  if (globalCooldownBlocks(repo, task)) return "编码执行器处于冷却期";
  return dispatchAvailability(repo, task);
}

export function eligibleReadyTasks(repo: Repo) {
  const running = repo.runs().filter((run) => run.status === "running");
  if (running.length >= Number(repo.getSetting("max_parallel"))) return [];
  return repo.tasks({ status: "ready" }).filter((task) => !dispatchReason(repo, task));
}

export function boardActivity(repo: Repo) {
  const active: BoardActivityItem[] = [];
  for (const run of repo.runs().filter((row) => row.status === "running" && runLive(row))) {
    const task = repo.task(run.task_id);
    if (repo.project(task.project_id).hidden) continue;
    active.push({
      kind: "coding", status: "running", activity_id: run.id, task_id: task.id, identifier: task.identifier, title: task.title,
      started_at: run.started_at, worktree_path: task.worktree_path, branch: task.branch,
      identity: run.worker_label || run.worker_model || run.worker_kind || run.worker,
    });
  }
  const reviewJobs = repo.db.prepare(
    "SELECT id,task_id,started_at,provider,reviewer_identity FROM autopilot_jobs WHERE kind='review' AND status='pending' AND task_id IS NOT NULL ORDER BY id",
  ).all() as ReviewJob[];
  for (const job of reviewJobs) {
    const task = repo.task(job.task_id);
    if (repo.project(task.project_id).hidden) continue;
    active.push({
      kind: "review", status: "pending", activity_id: job.id, task_id: task.id, identifier: task.identifier, title: task.title,
      started_at: job.started_at, worktree_path: task.worktree_path, branch: task.branch,
      identity: job.reviewer_identity || job.provider || null,
    });
  }

  const ready = repo.tasks({ status: "ready" });
  const eligibleReady = eligibleReadyTasks(repo);
  const reviews = repo.tasks({ status: "in_review" });
  const optedReviews = reviews.filter((task) => !repo.project(task.project_id).hidden && repo.project(task.project_id).auto_review);
  const eligibleReviews = optedReviews.filter(task => !reviewWaitReason(repo, task.id));
  let reason = "当前没有活动工作";
  let action: "dispatch" | "review" | null = null;
  let control: "projects" | "settings" | null = null;
  if (eligibleReady.length) {
    reason = `有 ${eligibleReady.length} 个符合条件的就绪任务可派发`;
    action = "dispatch";
  } else if (eligibleReviews.length) {
    reason = `有 ${eligibleReviews.length} 个符合条件的待审查任务`;
    action = "review";
  } else if (ready.length) {
    const first = ready[0];
    reason = dispatchReason(repo, first) || "编码并发槽位已满";
    control = !dependenciesDone(repo, first) || resolutionBusy(repo, first) ? "projects" : "settings";
  } else if (reviews.length && !optedReviews.length) {
    reason = `有 ${reviews.length} 个待审查任务，但所属项目未启用自动审查`;
    control = "projects";
  } else if (optedReviews.length) {
    reason = reviewWaitReason(repo, optedReviews[0].id) || "自动审查暂不可用";
    control = "settings";
  }
  return { active, idle: active.length === 0 ? { reason, action, control } : null,
    eligible_ready: eligibleReady.map((task) => task.identifier) };
}
