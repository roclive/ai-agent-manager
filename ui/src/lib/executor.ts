import type {
  EffectiveExecutor,
  ExecutorsView,
  Project,
  Task,
} from "./types";

// Ids stored before model variants existed; mirrors LEGACY_EXECUTORS in the backend.
const LEGACY: Record<string, string> = { codex: "codex-sol" };
export const normalizeExecutor = (v: string) => LEGACY[v] ?? v;

// Mirrors the backend resolveExecutor(): task > project > global > auto. Empty means "inherit".
// Resolved from live project/global settings so a settings change relabels existing rows without
// waiting for the tasks list to refetch; falls back to the server-computed value until loaded.
// The legacy `worker` field (codex/opencode) is a different concept and is never consulted.
export function effectiveExecutor(
  task: Pick<Task, "executor" | "project_id" | "effective_executor">,
  projects: Pick<Project, "id" | "coding_executor">[] | undefined,
  view: Pick<ExecutorsView, "coding_executor"> | undefined,
): EffectiveExecutor | undefined {
  if (task.executor) return { value: normalizeExecutor(task.executor), source: "task" };
  const project = projects?.find((p) => p.id === task.project_id);
  if (project?.coding_executor)
    return { value: normalizeExecutor(project.coding_executor), source: "project" };
  if (view && projects)
    return { value: normalizeExecutor(view.coding_executor || "auto"), source: "global" };
  const server = task.effective_executor;
  return server && normalizeExecutor(server.value) !== server.value
    ? { ...server, value: normalizeExecutor(server.value) }
    : server;
}
