import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Settings } from "./pages/Settings";
import { Dashboard } from "./pages/Dashboard";

const manager = { backend: "codex", model: "qwen2.5:3b", base_url: "http://127.0.0.1:11434/v1", fallback_to_rules: true, daily_cap: "120", last_decision: { ts: "2026-01-01T00:00:00Z", message: "rules fallback (codex: unavailable); selected T-1" } };
const status = { daemon: { running: false, last_tick_at: null }, autopilot: null, cooldown_until: null };
const settings = { max_parallel: "2", worker_timeout_min: "45", default_worker: "codex", coding_executor: "auto", executor_fallback: "", worker_effort: "default", worker_fast_mode: "1", reviewer: "codex-sol", reviewer_model: "opus", reviewer_effort: "max", reviewer_fast_mode: "1", review_mode: "manual", auto_review_concurrency: "1", auto_review_daily_max: "0", planner_daily_max: "0", keep_awake: "0", cooldown_until: "" };
function mount(page: React.ReactNode) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter>{page}</MemoryRouter></QueryClientProvider>);
}
const waitForForm = () => screen.findByRole("combobox", { name: "全局编码执行器" });
function settingsData(url: string) {
  if (url.endsWith("/manager")) return { ...manager, last_decision: null };
  if (url.endsWith("/settings")) return settings;
  if (url.endsWith("/projects")) return [];
  if (url.endsWith("/executors")) return { coding_executor: "auto", worker_effort: "default", executors: [] };
  if (url.endsWith("/reviewers")) return { reviewer: "codex-sol", reviewer_ok: null, reviewers: [] };
  if (url.endsWith("/routing")) return { schema_version: 1, providers: [], overrides: { allowed: null }, queue: { ready: 0, identifiers: [] }, history: [] };
  if (url.endsWith("/usage")) return { schema_version: 1, snapshots: [] };
  return {};
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("manager settings saves backend, local endpoint, fallback and daily cap", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method ? {} : settingsData(String(url)))));
  vi.stubGlobal("fetch", fetcher);
  mount(<Settings />);
  await waitForForm();
  fireEvent.change(screen.getByLabelText("Backend"), { target: { value: "local-small" } });
  fireEvent.change(screen.getByLabelText("Local model name"), { target: { value: "tiny-model" } });
  fireEvent.change(screen.getByLabelText("Local model base URL"), { target: { value: "http://localhost:1234/v1" } });
  fireEvent.change(screen.getByLabelText("Daily cap"), { target: { value: "9" } });
  fireEvent.click(screen.getByRole("button", { name: "Save manager settings" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/manager", expect.objectContaining({ method: "PUT", body: JSON.stringify({ manager_backend: "local-small", manager_local_model: "tiny-model", manager_local_base_url: "http://localhost:1234/v1", manager_fallback_to_rules: "1", manager_daily_max: "9" }) })));
});

it("tests local connectivity and switches the manager to rules", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method ? { ok: true } : settingsData(String(url)))));
  vi.stubGlobal("fetch", fetcher);
  mount(<Settings />);
  await waitForForm();
  fireEvent.click(screen.getByRole("button", { name: "Test local connection" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/manager/test-connection", expect.objectContaining({ method: "POST", body: JSON.stringify({ model: "qwen2.5:3b", base_url: "http://127.0.0.1:11434/v1" }) })));
  fireEvent.click(screen.getByRole("button", { name: "Switch to rules" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/manager/switch-to-rules", expect.objectContaining({ method: "POST" })));
});

it("shows current manager backend and the last decision reason on dashboard", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = String(url);
    const data = path.endsWith("/manager") ? manager
      : path.endsWith("/status") ? status
        : [];
    return new Response(JSON.stringify(data));
  }));
  mount(<Dashboard project="" />);
  expect(await screen.findByText("Manager · codex")).toBeTruthy();
  expect(await screen.findByText(/rules fallback \(codex: unavailable\); selected T-1/)).toBeTruthy();
});
