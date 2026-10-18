import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TaskDrawer } from "./components/TaskDrawer";
import { RoutineEditor } from "./pages/Routines";
import { Backlog } from "./pages/Backlog";
import { Cooldown } from "./pages/Dashboard";
import {
  cronDescription,
  routinePayload,
  remainingSeconds,
} from "./lib/page-utils";
const task = {
  id: 1,
  identifier: "T-1",
  project_id: 1,
  seq: 1,
  title: "Original",
  description: "**Markdown**",
  status: "in_review",
  priority: "P1",
  role: "frontend",
  worker: "codex",
  depends_on: "[]",
  attempts: 0,
  max_attempts: 3,
  lost_count: 0,
  feedback: "",
  blocker: "",
  branch: null,
  worktree_path: null,
  events: [],
  runs: [],
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};
function setup(node: React.ReactNode, path = "/board?task=T-1") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
function mock() {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (init?.method && init.method !== "GET")
      return new Response(JSON.stringify(task));
    return new Response(
      JSON.stringify(
        path === "/api/tasks"
          ? [task]
          : path === "/api/projects"
            ? [{ id: 1, key: "T", name: "Test" }]
            : task,
      ),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("drawer saves editable fields with PATCH and previews markdown", async () => {
  const fetcher = mock();
  const c = setup(<TaskDrawer />);
  await screen.findByDisplayValue("Original");
  fireEvent.change(screen.getByLabelText("标题"), {
    target: { value: "Updated" },
  });
  fireEvent.change(screen.getByLabelText("描述"), {
    target: { value: "**Preview**" },
  });
  expect(screen.getByText("Preview").tagName).toBe("STRONG");
  fireEvent.click(screen.getByText("保存更改"));
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/api/tasks/1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          title: "Updated",
          description: "**Preview**",
          status: "in_review",
          priority: "P1",
          role: "frontend",
          worker: "codex",
          max_attempts: 3,
          depends_on: [],
        }),
      }),
    ),
  );
  c.clear();
});
it.each(["批准", "驳回"])(
  "drawer %s sends review verdict and note",
  async (label) => {
    const fetcher = mock();
    const c = setup(<TaskDrawer />);
    await screen.findByDisplayValue("Original");
    fireEvent.click(screen.getByRole("tab", { name: "审查" }));
    fireEvent.change(screen.getByLabelText("审查备注"), {
      target: { value: "review note" },
    });
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "/api/tasks/1/review",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            verdict: label === "批准" ? "approve" : "reject",
            note: "review note",
          }),
        }),
      ),
    );
    c.clear();
  },
);
it("routine editor blocks empty name and exposes server validation", async () => {
  const fetcher = mock();
  fetcher.mockImplementation(
    async (_url, init) =>
      new Response(
        JSON.stringify(
          init?.method ? { error: "Invalid cron" } : [{ id: 1, key: "T" }],
        ),
        { status: init?.method ? 400 : 200 },
      ),
  );
  const c = setup(<RoutineEditor routine={null} onClose={() => {}} />);
  expect(screen.getByText("保存定时任务")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("名称"), {
    target: { value: "Nightly" },
  });
  fireEvent.change(screen.getByLabelText("Cron 表达式"), {
    target: { value: "invalid" },
  });
  fireEvent.click(screen.getByText("保存定时任务"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid cron");
  expect(fetcher).toHaveBeenCalledWith(
    "/api/routines",
    expect.objectContaining({
      body: JSON.stringify({
        name: "Nightly",
        cron: "invalid",
        action: "heartbeat",
        payload: {},
      }),
    }),
  );
  c.clear();
});
it("backlog bulk selection moves selected tasks to ready", async () => {
  const fetcher = mock();
  const c = setup(<Backlog project="" />, "/backlog");
  fireEvent.click(await screen.findByLabelText("选择 T-1"));
  fireEvent.click(screen.getByText("移至就绪"));
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/api/tasks/1",
      expect.objectContaining({ method: "PATCH", body: '{"status":"ready"}' }),
    ),
  );
  c.clear();
});
it("cron presets and action payloads use only relevant fields", () => {
  expect(cronDescription("0 7 * * *")).toBe("每天 07:00");
  expect(cronDescription("1 2 3 4 5")).toContain("自定义");
  expect(routinePayload("heartbeat", { cmd: "ignored" })).toEqual({});
  expect(
    routinePayload("shell", { cmd: "echo ok", cwd: "/tmp", title: "ignored" }),
  ).toEqual({ cmd: "echo ok", cwd: "/tmp" });
  expect(
    routinePayload("create_task", {
      project: "T",
      title: "Task",
      description: "",
      priority: "P0",
      role: "any",
      worker: "codex",
      cmd: "ignored",
    }),
  ).toEqual({
    project: "T",
    title: "Task",
    description: "",
    priority: "P0",
    role: "any",
    worker: "codex",
  });
  expect(
    remainingSeconds(
      "2026-01-01T00:00:03Z",
      Date.parse("2026-01-01T00:00:00Z"),
    ),
  ).toBe(3);
});
it("cooldown counts down and disappears when expired", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  render(<Cooldown until="2026-01-01T00:00:02Z" />);
  expect(screen.getByRole("status")).toHaveTextContent("2 秒");
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByRole("status")).toHaveTextContent("1 秒");
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.queryByRole("status")).toBeNull();
});
it("bulk move waits for all requests and reports partial failures", async () => {
  const { bulkMove } = await import("./pages/Backlog");
  const fetcher = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.endsWith("/2") ? { error: "Task has a running worker" } : task,
        ),
        { status: url.endsWith("/2") ? 400 : 200 },
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(bulkMove([1, 2], "ready")).rejects.toThrow("1 个任务移动失败");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
