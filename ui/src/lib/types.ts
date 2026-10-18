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
  seq: number;
  sort_order?: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  role: Role;
  worker: Worker;
  depends_on: string | string[];
  attempts: number;
  max_attempts: number;
  blocker: string;
  feedback: string;
  created_at: string;
  updated_at: string;
  runs?: Run[];
}
export interface Project {
  id: number;
  key: string;
  name: string;
  color?: string;
  running?: number;
  counts?: Partial<Record<TaskStatus, number>>;
  repo_path: string;
  base_branch: string;
  test_cmd: string | null;
  setup_cmd: string | null;
  created_at: string;
}
export interface Run {
  id: number;
  task_id: number;
  worker: Worker;
  status:
    "running" | "succeeded" | "failed" | "timeout" | "lost" | "rate_limited";
  started_at: string;
  ended_at: string | null;
  exit_code?: number | null;
  test_exit_code?: number | null;
  elapsed_s?: number;
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
