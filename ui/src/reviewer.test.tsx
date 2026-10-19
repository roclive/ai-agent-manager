import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { Settings } from "./pages/Settings";

afterEach(() => vi.unstubAllGlobals());

it("reloads reviewer health and submits reviewer independently from coding executor", async () => {
  let settings = {
    max_parallel: "2", worker_timeout_min: "45", default_worker: "codex",
    coding_executor: "codex-luna", executor_fallback: "", review_mode: "manual",
    reviewer: "claude-opus", auto_review_concurrency: "1", auto_review_daily_max: "10",
    planner_daily_max: "2", keep_awake: "1", cooldown_until: "",
  };
  const reviewers = {
    reviewer: "claude-opus", reviewer_ok: true, reviewer_checked_at: "2026-10-19T00:00:00Z",
    reviewer_error: "", reviewers: [
      { id: "codex-sol", label: "Codex (Sol)", provider: "codex", supported: true },
      { id: "codex-luna", label: "Codex (Luna)", provider: "codex", supported: true },
      { id: "claude", label: "Claude (Sonnet)", provider: "claude", supported: true },
      { id: "claude-opus", label: "Claude (Opus)", provider: "claude", supported: true },
    ],
  };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url) === "/api/settings" && init?.method === "PUT") {
      settings = { ...settings, ...JSON.parse(String(init.body)) };
      return new Response(JSON.stringify(settings));
    }
    if (String(url) === "/api/settings") return new Response(JSON.stringify(settings));
    if (String(url) === "/api/reviewers") return new Response(JSON.stringify(reviewers));
    if (String(url) === "/api/executors") return new Response(JSON.stringify({ coding_executor: settings.coding_executor, executors: [
      { id: "codex-sol", label: "Codex (Sol)", installed: true, install_hint: "" },
      { id: "codex-luna", label: "Codex (Luna)", installed: true, install_hint: "" },
    ] }));
    if (String(url) === "/api/projects") return new Response("[]");
    return new Response("{}");
  });
  vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><Settings /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByLabelText("审查器")).toHaveValue("claude-opus");
  expect(await screen.findByText(/Claude \(Opus\) · 已就绪/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("全局编码执行器"), { target: { value: "codex-sol" } });
  expect(screen.getByLabelText("审查器")).toHaveValue("claude-opus");
  fireEvent.change(screen.getByLabelText("审查器"), { target: { value: "codex-luna" } });
  fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
  await waitFor(() => expect(settings).toMatchObject({ coding_executor: "codex-sol", reviewer: "codex-luna" }));
});
