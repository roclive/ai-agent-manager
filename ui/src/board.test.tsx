import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { groupTasks, planDrop, applyDrop } from "./lib/board";
import { api, request } from "./lib/api";
import { ThemeToggle } from "./lib/theme";
import { StatusIcon } from "./components/StatusIcon";
import { PriorityIcon } from "./components/PriorityIcon";
import { Layout } from "./components/Layout";
import type { Task } from "./lib/types";
const task = (
  id: number,
  status: Task["status"] = "ready",
  sort_order = id * 10,
): Task => ({
  id,
  status,
  sort_order,
  seq: id,
  project_id: 1,
  identifier: `AAM-${id}`,
  title: `任务 ${id}`,
  description: "说明",
  priority: "P1",
  worker: "codex",
  role: "frontend",
  depends_on: [],
  attempts: 0,
  max_attempts: 3,
  blocker: "",
  feedback: "",
  created_at: "",
  updated_at: "",
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});
describe("board grouping and drag-end planning", () => {
  it("groups all columns, uses sort_order and falls back to seq", () => {
    const old = { ...task(4), sort_order: undefined };
    const grouped = groupTasks([
      task(3, "ready", 20),
      old,
      task(1, "ready", 10),
      task(2, "done"),
    ]);
    expect(grouped.ready.map((t) => t.id)).toEqual([4, 1, 3]);
    expect(grouped.cancelled).toEqual([]);
    expect(grouped.done).toHaveLength(1);
  });
  it("moves across columns with midpoint PATCH", async () => {
    const tasks = [
      task(1, "backlog"),
      task(2, "ready", 10),
      task(3, "ready", 20),
    ];
    const patch = planDrop(tasks, 1, 3)!;
    expect(patch).toEqual({ status: "ready", sort_order: 15 });
    const write = vi.fn().mockResolvedValue(task(1));
    const update = vi.fn();
    await applyDrop(tasks, 1, patch, write, update);
    expect(write).toHaveBeenCalledWith(1, { status: "ready", sort_order: 15 });
    expect(update.mock.calls[0][0][0].status).toBe("ready");
  });
  it("reorders down/up and drops into empty columns", () => {
    const tasks = [task(1), task(2), task(3)];
    expect(planDrop(tasks, 1, 2)).toEqual({ status: "ready", sort_order: 25 });
    expect(planDrop(tasks, 3, 1)).toEqual({ status: "ready", sort_order: 5 });
    expect(planDrop(tasks, 1, "done")).toEqual({
      status: "done",
      sort_order: 1024,
    });
    expect(planDrop(tasks, 1, 1)).toBeNull();
    expect(planDrop(tasks, 1, "unknown")).toBeNull();
  });
  it("restores the snapshot on server rejection", async () => {
    const tasks = [task(1)];
    const update = vi.fn();
    const write = vi
      .fn()
      .mockRejectedValue(new Error("Task has a running worker"));
    await expect(
      applyDrop(tasks, 1, { status: "done", sort_order: 5 }, write, update),
    ).rejects.toThrow("running worker");
    expect(update.mock.calls[0][0][0].status).toBe("done");
    expect(update.mock.calls[1][0]).toBe(tasks);
  });
});
describe("API", () => {
  it("adds X-AAM to mutations and leaves reads alone", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    await request("/tasks", { method: "PATCH", body: "{}" });
    expect(new Headers(fetch.mock.calls[0][1].headers).get("X-AAM")).toBe("1");
    await request("/tasks");
    expect(new Headers(fetch.mock.calls[1][1].headers).has("X-AAM")).toBe(
      false,
    );
  });
  it("falls back only for explicit legacy field rejection", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Unsupported task field" }), {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(task(1))));
    vi.stubGlobal("fetch", fetch);
    await api.patchTask(1, { status: "ready", sort_order: 1.5 });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      status: "ready",
      sort_order: 1.5,
    });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      status: "ready",
      sort: 2,
    });
  });
  it("does not retry a running-worker rejection", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "Task has a running worker" }), {
          status: 400,
        }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      api.patchTask(1, { status: "done", sort_order: 10 }),
    ).rejects.toThrow("running worker");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
it("renders accessible status and priority icons", () => {
  render(
    <>
      <StatusIcon status="in_progress" />
      <PriorityIcon priority="P0" />
    </>,
  );
  expect(screen.getByLabelText("进行中")).toBeInTheDocument();
  expect(screen.getByLabelText("优先级 P0")).toBeInTheDocument();
});
it("persists theme changes and restores selection", () => {
  localStorage.setItem("aam-theme", "light");
  const first = render(<ThemeToggle />);
  fireEvent.click(screen.getByLabelText("切换主题"));
  expect(localStorage.getItem("aam-theme")).toBe("dark");
  expect(document.documentElement).toHaveClass("dark");
  first.unmount();
  render(<ThemeToggle />);
  expect(screen.getByText("浅色模式")).toBeInTheDocument();
});
it("renders the shell and board with a fake API, including filtering and detail", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      let data: unknown = [];
      if (input === "/api/tasks") data = [task(1), task(2, "done")];
      else if (input === "/api/tasks/AAM-1") data = task(1);
      else if (input === "/api/projects")
        data = [{ id: 1, key: "AAM", name: "项目", running: 0 }];
      else if (input === "/api/status")
        return new Response('{"error":"not found"}', { status: 404 });
      else if (input === "/api/runs")
        return new Response('{"error":"not found"}', { status: 404 });
      return new Response(JSON.stringify(data));
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/board"]}>
        <Layout />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("任务 1")).toBeInTheDocument();
  expect(screen.getByText("任务 2")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("搜索任务"), {
    target: { value: "AAM-1" },
  });
  expect(screen.queryByText("任务 2")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("任务 1"));
  await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  expect(await screen.findByText("说明")).toBeInTheDocument();
  view.unmount();
  client.clear();
});
