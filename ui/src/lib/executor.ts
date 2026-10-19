import type {
  EffectiveExecutor,
  ExecutorsView,
  Project,
  Task,
} from "./types";

// Mirrors the backend resolveExecutor(): task > project > global > auto. Empty means "inherit".
// Resolved from live project/global settings so a settings change relabels existing rows without
// waiting for the tasks list to refetch; falls back to the server-computed value until loaded.
// The legacy `worker` field (codex/opencode) is a different concept and is never consulted.
export function effectiveExecutor(
  task: Pick<Task, "executor" | "project_id" | "effective_executor">,
  projects: Pick<Project, "id" | "coding_executor">[] | undefined,
  view: Pick<ExecutorsView, "coding_executor"> | undefined,
): EffectiveExecutor | undefined {
  if (task.executor) return { value: task.executor, source: "task" };
  const project = projects?.find((p) => p.id === task.project_id);
  if (project?.coding_executor)
    return { value: project.coding_executor, source: "project" };
  if (view && projects) return { value: view.coding_executor || "auto", source: "global" };
  return task.effective_executor;
}
