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
  fireEvent.click(screen.getByText("保存定时任务"));
  expect(await screen.findByRole("alert")).toHaveTextContent("请输入名称");
  expect(screen.getByLabelText("名称")).toHaveFocus();
  fireEvent.change(screen.getByLabelText("名称"), {
    target: { value: "Nightly" },
  });
  fireEvent.change(screen.getByLabelText("Cron 表达式"), {
    target: { value: "99 * * * *" },
  });
  fireEvent.click(screen.getByText("保存定时任务"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Cron 表达式无效");
  expect(fetcher).toHaveBeenCalledWith(
    "/api/routines",
    expect.objectContaining({
      body: JSON.stringify({
        name: "Nightly",
        cron: "99 * * * *",
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

it.each(["shell", "create_task"])(
  "routine validates required %s fields inline",
  async (kind) => {
    mock();
    const c = setup(<RoutineEditor routine={null} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "Test" },
    });
    fireEvent.change(screen.getByLabelText("动作"), {
      target: { value: kind },
    });
    fireEvent.click(screen.getByText("保存定时任务"));
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    expect(
      screen.getByLabelText(kind === "shell" ? "命令" : "项目"),
    ).toHaveFocus();
    c.clear();
  },
);
it("routine rejects malformed cron before submitting", async () => {
  const fetcher = mock();
  const c = setup(<RoutineEditor routine={null} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("名称"), {
    target: { value: "Test" },
  });
  fireEvent.change(screen.getByLabelText("Cron 表达式"), {
    target: { value: "* *" },
  });
  fireEvent.click(screen.getByText("保存定时任务"));
  expect(await screen.findByRole("alert")).toHaveTextContent("5 或 6 段");
  expect(screen.getByLabelText("Cron 表达式")).toHaveFocus();
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
    false,
  );
  c.clear();
});

it("backlog preserves full labels and a sticky task column with project chips", async () => {
  mock();
  const c = setup(<Backlog project="" />, "/backlog");
  expect(await screen.findByLabelText("T-1 worker")).toHaveDisplayValue(
    "Codex 执行器",
  );
  expect(screen.getByLabelText("T-1 priority")).toHaveDisplayValue("P1 高");
  expect(
    screen.getByText("T", { selector: ".project-chip" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("table")).toHaveClass("backlog-table");
  c.clear();
});

it("activity groups days, translates events and links task identifiers", async () => {
  const { ActivityPage } = await import("./pages/Activity");
  const { eventMessage } = await import("./lib/events");
  expect(eventMessage('{"routine_id":1,"name":"heartbeat"}')).toBe(
    "「heartbeat」",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url === "/api/tasks"
              ? [task]
              : [
                  {
                    id: 1,
                    ts: "2026-01-01T12:00:00Z",
                    task_id: 1,
                    kind: "dispatch",
                    message: '{"name":"heartbeat"}',
                  },
                ],
          ),
        ),
    ),
  );
  const c = setup(<ActivityPage project="" />, "/activity");
  expect(await screen.findByText("「heartbeat」")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "T-1" })).toHaveAttribute(
    "href",
    "/activity?task=T-1",
  );
  expect(screen.getByRole("heading", { name: "2026/1/1" })).toBeInTheDocument();
  expect(screen.getByText("派工", { selector: "span" })).toHaveClass(
    "event-kind",
  );
  c.clear();
});

it.each(["批准", "驳回"])(
  "dashboard confirms %s with a note",
  async (label) => {
    const { Dashboard } = await import("./pages/Dashboard");
    const fetcher = vi.fn(
      async (url: string, init?: RequestInit) =>
        new Response(
          JSON.stringify(
            init?.method
              ? task
              : url === "/api/tasks"
                ? [task]
                : url === "/api/projects"
                  ? [{ id: 1, key: "T" }]
                  : url === "/api/status"
                    ? { daemon: { running: false } }
                    : [],
          ),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const c = setup(<Dashboard project="" />, "/");
    fireEvent.click(await screen.findByRole("button", { name: label }));
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
      false,
    );
    fireEvent.change(screen.getByLabelText("审查备注"), {
      target: { value: "Checked" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认提交" }));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "/api/tasks/1/review",
        expect.objectContaining({
          body: JSON.stringify({
            verdict: label === "批准" ? "approve" : "reject",
            note: "Checked",
          }),
        }),
      ),
    );
    c.clear();
  },
);

it("routine immediate run requires confirmation", async () => {
  const { Routines } = await import("./pages/Routines");
  const fetcher = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init?.method
            ? {}
            : [
                {
                  id: 1,
                  name: "heartbeat",
                  action: "heartbeat",
                  cron: "*/5 * * * *",
                  enabled: true,
                },
              ],
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const c = setup(<Routines />, "/routines");
  fireEvent.click(await screen.findByRole("button", { name: "立即运行" }));
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "确认运行" }));
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/api/routines/1/run",
      expect.objectContaining({ method: "POST" }),
    ),
  );
  c.clear();
});

it("restores the selected project across layout mounts", async () => {
  const { Layout } = await import("./components/Layout");
  localStorage.setItem("aam.project", "OTHER");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url === "/api/projects"
              ? [
                  { id: 1, key: "T", name: "Test" },
                  { id: 2, key: "OTHER", name: "Other project" },
                ]
              : url === "/api/status"
                ? { daemon: { running: false } }
                : [],
          ),
        ),
    ),
  );
  const c = setup(<Layout />, "/backlog");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "切换项目" })).toHaveTextContent(
      "Other project",
    ),
  );
  expect(localStorage.getItem("aam.project")).toBe("OTHER");
  c.clear();
  cleanup();
  localStorage.clear();
});
it("project editor submits numeric opt-ins and project goal", async () => {
  const { Settings } = await import("./pages/Settings");
  const fetcher = vi.fn(
    async (url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init?.method === "PATCH"
            ? {}
            : String(url) === "/api/settings"
              ? {
                  max_parallel: "2",
                  worker_timeout_min: "45",
                  default_worker: "codex",
                  review_mode: "manual",
                  auto_review_concurrency: "3",
                  auto_review_daily_max: "80",
                  planner_daily_max: "10",
                  keep_awake: "1",
                }
              : [
                  {
                    id: 1,
                    key: "T",
                    name: "Test",
                    repo_path: "/tmp/test",
                    base_branch: "main",
                    auto_review: 0,
                    autopilot: 0,
                    goal: "",
                    autopilot_rank: 100,
                  },
                ],
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  setup(<Settings />, "/settings");
  expect(await screen.findByLabelText("审查与规划模型")).toHaveValue("codex");
  fireEvent.change(screen.getByLabelText("审查与规划模型"), {
    target: { value: "claude" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(
      true,
    ),
  );
  expect(
    JSON.parse(
      String(
        fetcher.mock.calls.find(([, init]) => init?.method === "PUT")![1]?.body,
      ),
    ),
  ).toMatchObject({ reviewer: "claude" });
  fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
  fireEvent.click(screen.getByLabelText("自动审查"));
  fireEvent.click(screen.getByLabelText("自动驾驶"));
  fireEvent.change(screen.getByLabelText("项目目标"), {
    target: { value: "Improve tests" },
  });
  fireEvent.change(screen.getByLabelText("优先级"), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "保存项目" }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(([, init]) => init?.method === "PATCH"),
    ).toBe(true),
  );
  const [, init] = fetcher.mock.calls.find(
    ([, init]) => init?.method === "PATCH",
  )!;
  expect(JSON.parse(String(init?.body))).toMatchObject({
    auto_review: 1,
    autopilot: 1,
    goal: "Improve tests",
    autopilot_rank: 5,
  });
});

it("shows Claude login failure on the autopilot dashboard", async () => {
  const { Dashboard } = await import("./pages/Dashboard");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url === "/api/status"
              ? {
                  daemon: { running: false },
                  autopilot: {
                    claude_ok: false,
                    claude_error: "Please run /login",
                    auto_reviews_today: 0,
                    auto_review_max: 80,
                    planner_runs_today: 0,
                    planner_max: 10,
                    promotions_today: 0,
                    caffeinate: false,
                  },
                }
              : [],
          ),
        ),
    ),
  );
  const client = setup(<Dashboard project="" />, "/");
  expect(
    await screen.findByText(/Claude 不可用，自动驾驶已暂停/),
  ).toHaveTextContent("Please run /login");
  client.clear();
});

it("offers retry for blocked tasks and posts the retry action", async () => {
  const fetcher = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url === "/api/tasks"
            ? [task]
            : { ...task, status: "blocked", feedback: "Fix finding" },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const c = setup(<TaskDrawer />);
  fireEvent.click(await screen.findByText("再试一次"));
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/api/tasks/1/retry",
      expect.objectContaining({ method: "POST", body: "{}" }),
    ),
  );
  c.clear();
});
