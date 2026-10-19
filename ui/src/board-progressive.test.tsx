import { it, expect, vi, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardPage } from "./pages-board";
const streams: FakeStream[] = [];
class FakeStream {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, () => void>();
  close = vi.fn();
  constructor(public url: string) {
    streams.push(this);
  }
  addEventListener(name: string, fn: () => void) {
    this.listeners.set(name, fn);
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  streams.length = 0;
});
const base = {
  project_id: 1,
  seq: 1,
  sort_order: 10,
  description: "",
  priority: "P1",
  role: "any",
  worker: "codex",
  depends_on: [],
  attempts: 0,
  max_attempts: 3,
  blocker: "",
  feedback: "",
  created_at: "",
  updated_at: "",
};
it("renders cards from /api/tasks without waiting for runs/projects and follows SSE status changes", async () => {
  vi.stubGlobal("EventSource", FakeStream);
  let status = "in_progress";
  const pending = new Promise<Response>(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.startsWith("/api/tasks"))
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                ...base,
                id: 1,
                identifier: "AAM-1",
                title: "进度任务",
                status,
                last_run:
                  status === "in_progress"
                    ? {
                        id: 9,
                        status: "running",
                        started_at: new Date().toISOString(),
                        worker_label: null,
                        live: true,
                      }
                    : null,
              },
            ]),
          ),
        );
      return pending; // runs, projects, executors... never resolve
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BoardPage project="" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getAllByTestId("task-skeleton").length).toBeGreaterThan(0);
  expect(await screen.findByText("进度任务")).toBeInTheDocument();
  expect(screen.getByText(/运行中/)).toBeInTheDocument();
  expect(screen.getByText(/重新连接中/)).toBeInTheDocument();
  act(() => streams[0].onopen?.());
  expect(screen.queryByText(/重新连接中/)).toBeNull();
  status = "in_review";
  act(() => streams[0].listeners.get("events")?.());
  await waitFor(() =>
    expect(screen.queryByText(/运行中 ·/)).not.toBeInTheDocument(),
  );
  client.clear();
});
