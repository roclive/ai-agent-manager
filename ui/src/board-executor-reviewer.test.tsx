import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { BoardExecutorReviewer } from "./components/BoardExecutorReviewer";

afterEach(() => vi.unstubAllGlobals());

function renderControl(fetcher: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetcher);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BoardExecutorReviewer onExecutorChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

const executors = {
  coding_executor: "codex-luna", worker_effort: "high", effort_choices: ["default", "high"],
  executor_fallback: [], reviewer: "claude-opus",
  executors: [
    { id: "codex-luna", label: "Codex Luna", installed: true, install_hint: "", effort_supported: true, cooldown_until: null },
    { id: "hermes", label: "Hermes", installed: false, install_hint: "install Hermes", effort_supported: false, cooldown_until: null },
  ],
};
const reviewers = {
  reviewer: "claude-opus", reviewer_ok: true, reviewer_checked_at: "2026-10-19T00:00:00Z", reviewer_error: "",
  reviewers: [
    { id: "claude-opus", label: "Claude Opus", provider: "claude", supported: true },
    { id: "gw", label: "Gateway reviewer", provider: "gw", supported: false },
  ],
};

it("summarizes current choices and disables unsupported reviewers", async () => {
  renderControl(vi.fn(async (url: string) => new Response(JSON.stringify(
    String(url) === "/api/reviewers" ? reviewers : executors,
  ))));
  expect(await screen.findByRole("button", { name: /编码: Codex Luna/ })).toHaveTextContent("编码: Codex Luna · 审查: Claude Opus");
  fireEvent.click(screen.getByRole("button", { name: /编码: Codex Luna/ }));
  const unsupported = await screen.findByRole("option", { name: /Gateway reviewer/ }) as HTMLOptionElement;
  expect(unsupported.disabled).toBe(true);
  expect(screen.getByText("已就绪")).toBeInTheDocument();
});

it("changing reviewer sends only reviewer PUT and leaves executor unchanged", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => new Response(JSON.stringify(
    String(url) === "/api/reviewers" && init?.method === "PUT"
      ? { ...reviewers, reviewer: JSON.parse(String(init.body)).reviewer }
      : String(url) === "/api/reviewers" ? reviewers : executors,
  )));
  renderControl(fetcher);
  fireEvent.click(await screen.findByRole("button", { name: /编码: Codex Luna/ }));
  fireEvent.change(await screen.findByLabelText("板头审查器"), { target: { value: "gw" } });
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/reviewers", expect.objectContaining({
    method: "PUT", body: JSON.stringify({ reviewer: "gw" }),
  })));
  expect(fetcher.mock.calls.filter((call) => call[1]?.method === "PUT")).toHaveLength(1);
  expect(fetcher.mock.calls.find((call) => call[1]?.method === "PUT")?.[0]).toBe("/api/reviewers");
});

it("changing coding executor invokes only the executor callback", async () => {
  const onExecutorChange = vi.fn();
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => new Response(JSON.stringify(
    String(url) === "/api/reviewers" ? reviewers : executors,
  )));
  vi.stubGlobal("fetch", fetcher);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <BoardExecutorReviewer onExecutorChange={onExecutorChange} />
  </QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /编码: Codex Luna/ }));
  fireEvent.change(await screen.findByLabelText("全局编码执行器"), { target: { value: "codex-luna" } });
  expect(onExecutorChange).toHaveBeenCalledWith("codex-luna");
  expect(fetcher.mock.calls.some((call) => call[1]?.method === "PUT" && call[0] === "/api/reviewers")).toBe(false);
});
