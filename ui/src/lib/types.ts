export const statuses = [
  "backlog",
  "ready",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
] as const;
export type TaskStatus = (typeof statuses)[number];
export type Priority = "P0" | "P1" | "P2" | "P3";
export type Worker = "codex" | "opencode";
export type Role = "backend" | "frontend" | "testing" | "any";
export const statusLabels: Record<TaskStatus, string> = {
  backlog: "待办池",
  ready: "就绪",
  in_progress: "进行中",
  in_review: "待审查",
  blocked: "受阻",
  done: "完成",
  cancelled: "已取消",
};
export const roleLabels: Record<Role, string> = {
  backend: "后端",
  frontend: "前端",
  testing: "测试",
  any: "不限角色",
};
export interface Task {
  id: number;
  project_id: number;
  identifier: string;
  integrated?: number;
  dependency_waiting?: string;
  resolves_task_id?: number | null;
  seq: number;
  sort_order?: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  role: Role;
  worker: Worker;
  executor?: string;
  effective_executor?: EffectiveExecutor;
  depends_on: string | string[];
  attempts: number;
  max_attempts: number;
  blocker: string;
  feedback: string;
  created_at: string;
  updated_at: string;
  runs?: Run[];
  last_run?: {
    id: number;
    status: Run["status"];
    started_at: string;
    worker_label: string | null;
    live?: boolean;
  } | null;
  latest_worker?: {
    run_id: number;
    kind: string | null;
    model: string | null;
    label: string | null;
  } | null;
}
export interface Project {
  id: number;
  key: string;
  name: string;
  auto_review?: number;
  autopilot?: number;
  goal?: string;
  autopilot_rank?: number;
  context_file?: string | null;
  coding_executor?: string;
  color?: string;
  running?: number;
  counts?: Partial<Record<TaskStatus, number>>;
  repo_path: string;
  integration_branch?: string;
  ahead_of_base?: number | null;
  integration_commits?: string;
  base_branch: string;
  test_cmd: string | null;
  setup_cmd: string | null;
  created_at: string;
}
export interface Run {
  id: number;
  task_id: number;
  worker: Worker;
  worker_kind?: string | null;
  worker_model?: string | null;
  worker_label?: string | null;
  status:
    "running" | "succeeded" | "failed" | "timeout" | "lost" | "rate_limited";
  started_at: string;
  ended_at: string | null;
  exit_code?: number | null;
  test_exit_code?: number | null;
  elapsed_s?: number;
  live?: boolean;
  pid?: number | null;
  identifier?: string;
  title?: string;
  project_key?: string;
  summary: string | null;
}
export interface Routine {
  id: number;
  name: string;
  cron: string;
  action: "heartbeat" | "create_task" | "shell";
  payload: string | Record<string, unknown>;
  enabled: boolean | number;
  last_run_at: string | null;
  next_run_at?: string | null;
}
export interface Event {
  id: number;
  ts: string;
  task_id: number | null;
  kind: string;
  message: string;
}
export interface Status {
  autopilot?: {
    auto_reviews_today: number;
    auto_review_concurrency?: number;
    waiting_for_review?: number;
    auto_review_max: number;
    planner_runs_today: number;
    planner_max: number;
    promotions_today: number;
    idle_since?: string;
    caffeinate: boolean;
    reviewer?: "codex" | "claude";
    reviewer_ok?: boolean;
    reviewer_checked_at?: string | null;
    reviewer_error?: string;
    claude_ok?: boolean;
    claude_checked_at?: string | null;
    claude_error?: string;
  };
  now: string;
  daemon: { running: boolean; pid?: number; last_tick_at: string | null };
  cooldown_until: string | null;
  running_runs: number | Run[];
  max_parallel: number;
  counts_by_status: Partial<Record<TaskStatus, number>>;
  review_pending: number;
}
export type NewTask = {
  project: string;
  title: string;
  description: string;
  priority: Priority;
  role: Role;
  worker: Worker;
  status: TaskStatus;
};
export interface TaskDetail extends Task {
  branch: string | null;
  worktree_path: string | null;
  lost_count: number;
  events: Event[];
  diff_stat: string | null;
  last_message: string | null;
}
export const runStatusLabels: Record<Run["status"], string> = {
  running: "运行中",
  succeeded: "成功",
  failed: "失败",
  timeout: "超时",
  lost: "丢失",
  rate_limited: "触发限流",
};

export const priorityLabels: Record<string, string> = {
  P0: "P0 紧急",
  P1: "P1 高",
  P2: "P2 中",
  P3: "P3 低",
};
export const workerLabels: Record<string, string> = {
  codex: "Codex 执行器",
  opencode: "OpenCode 执行器",
};
export type ExecutorSource = "task" | "project" | "global";
export interface EffectiveExecutor {
  value: string;
  source: ExecutorSource;
}
export interface ExecutorInfo {
  model_warning?: string | null;
  id: string;
  label: string;
  installed: boolean;
  install_hint: string;
  cooldown_until: string | null;
  effort_supported?: boolean;
  model?: string | null;
  provider?: string;
}
export interface ExecutorsView {
  coding_executor: string;
  worker_effort: string;
  effort_choices: string[];
  executor_fallback: string[];
  reviewer: string;
  model_note?: string;
  executors: ExecutorInfo[];
}
export interface ReviewerInfo {
  id: string;
  label: string;
  provider: string;
  model?: string;
  supported: boolean;
}
export interface ReviewersView {
  reviewer: string;
  reviewer_ok: boolean | null;
  reviewer_checked_at: string | null;
  reviewer_error: string;
  reviewers: ReviewerInfo[];
}
