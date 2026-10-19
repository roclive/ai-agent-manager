import type { ExecutorsView, Task, Project, Run, Status, NewTask, Event } from "./types";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD"].includes((init.method ?? "GET").toUpperCase()))
    headers.set("X-AAM", "1");
  const response = await fetch(`/api${path}`, { ...init, headers });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      data?.error ?? `请求失败 (${response.status})`,
      response.status,
    );
  return data as T;
}
export const api = {
  tasks: () => request<Task[]>("/tasks"),
  projects: () => request<Project[]>("/projects"),
  status: () => request<Status>("/status"),
  executors: () => request<ExecutorsView>("/executors"),
  setExecutors: (body: Record<string, unknown>) =>
    request<ExecutorsView>("/executors", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  events: () => request<Event[]>("/events"),
  task: (id: string) => request<Task>(`/tasks/${encodeURIComponent(id)}`),
  runs: async () => {
    try {
      return await request<Run[]>("/runs?limit=100");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return [];
      throw e;
    }
  },
  createTask: (task: NewTask) =>
    request<Task>("/tasks", { method: "POST", body: JSON.stringify(task) }),
  patchTask: async (
    id: number,
    patch: { status: Task["status"]; sort_order: number },
    modern = true,
  ): Promise<Task> => {
    try {
      return await request<Task>(`/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(
          modern
            ? patch
            : {
                status: patch.status,
                sort: Math.max(1, Math.round(patch.sort_order)),
              },
        ),
      });
    } catch (e) {
      if (
        modern &&
        e instanceof ApiError &&
        /Unsupported task field/.test(e.message)
      )
        return api.patchTask(id, patch, false);
      throw e;
    }
  },
};
