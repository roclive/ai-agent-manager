import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardPage } from "./pages-board";

afterEach(() => vi.unstubAllGlobals());
function renderBoard(activity: unknown, actionResponse: Response = new Response("{}")) {
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    if (input === "/api/tasks") return new Response("[]");
    if (input === "/api/runs?limit=100") return new Response("[]");
    if (input === "/api/projects") return new Response("[]");
    if (input === "/api/executors") return new Response(JSON.stringify({ coding_executor: "codex", executors: [] }));
    if (input === "/api/board/activity") return new Response(JSON.stringify(activity));
    if (["/api/board/dispatch", "/api/board/review"].includes(input) && init?.method === "POST") return actionResponse;
    return new Response("{}");
  });
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><BoardPage project="" /></MemoryRouter></QueryClientProvider>);
  return fetch;
}

it("distinguishes active coding and review and renders review worktree", async () => {
  renderBoard({ active: [
    { kind: "coding", status: "running", activity_id: 1, task_id: 1, identifier: "T-1", title: "Code", identity: "Codex Sol", worktree_path: "/wt/T-1", branch: "aam/T-1", started_at: "2026-01-01" },
    { kind: "review", status: "pending", activity_id: 2, task_id: 2, identifier: "T-2", title: "Review", identity: "Claude", worktree_path: "/wt/T-2", branch: "aam/T-2", started_at: "2026-01-01" },
  ], idle: null, eligible_ready: [] });
  expect(await screen.findByText("编码执行中")).toBeInTheDocument();
  expect(screen.getByText("自动审查中")).toBeInTheDocument();
  expect(screen.getByText("状态：待完成（pending）")).toBeInTheDocument();
  expect(screen.getByText("状态：运行中（running）")).toBeInTheDocument();
  expect(screen.getByText("工作树：/wt/T-2")).toBeInTheDocument();
  expect(screen.getByText("分支：aam/T-2")).toBeInTheDocument();
});

it("shows idle guidance, performs safe action, and surfaces API rejection", async () => {
  const fetch = renderBoard(
    { active: [], idle: { reason: "有 1 个符合条件的就绪任务可派发", action: "dispatch", control: null }, eligible_ready: ["T-1"] },
    new Response(JSON.stringify({ error: "编码执行器处于冷却期" }), { status: 400 }),
  );
  expect(await screen.findByText(/当前无编码或自动审查活动/)).toHaveTextContent("符合条件");
  fireEvent.click(screen.getByRole("button", { name: "安全派发就绪任务" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("编码执行器处于冷却期");
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/board/dispatch", expect.objectContaining({ method: "POST" })));
});

it("links ineligible review work to project settings without changing it", async () => {
  renderBoard({ active: [], idle: { reason: "待审查任务所属项目未启用自动审查", action: null, control: "projects" }, eligible_ready: [] });
  expect(await screen.findByText("查看项目设置")).toHaveAttribute("href", "/settings");
  expect(screen.queryByRole("button", { name: "请求自动审查" })).not.toBeInTheDocument();
});

it("requests the existing review flow and restores the action afterward", async () => {
  const fetch = renderBoard({ active: [], idle: { reason: "待审查任务符合条件", action: "review", control: null }, eligible_ready: [] });
  fireEvent.click(await screen.findByRole("button", { name: "请求自动审查" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/board/review", expect.objectContaining({ method: "POST" })));
  await waitFor(() => expect(screen.getByRole("button", { name: "请求自动审查" })).not.toBeDisabled());
});
