import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Settings } from "./pages/Settings";
import { Dashboard } from "./pages/Dashboard";

const manager = { backend: "codex", model: "qwen2.5:3b", base_url: "http://127.0.0.1:11434/v1", fallback_to_rules: true, daily_cap: "120", last_decision: { ts: "2026-01-01T00:00:00Z", message: "rules fallback (codex: unavailable); selected T-1" } };
function mount(page: React.ReactNode) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter>{page}</MemoryRouter></QueryClientProvider>);
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("manager settings saves backend, local endpoint, fallback and daily cap", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => new Response(JSON.stringify(String(url).endsWith("/manager") && !init?.method ? manager : {})));
  vi.stubGlobal("fetch", fetcher);
  mount(<Settings />);
  await screen.findByText("Manager");
  fireEvent.change(screen.getByLabelText("Backend"), { target: { value: "local-small" } });
  fireEvent.change(screen.getByLabelText("Local model name"), { target: { value: "tiny-model" } });
  fireEvent.change(screen.getByLabelText("Local model base URL"), { target: { value: "http://localhost:1234/v1" } });
  fireEvent.change(screen.getByLabelText("Daily cap"), { target: { value: "9" } });
  fireEvent.click(screen.getByRole("button", { name: "Save manager settings" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/manager", expect.objectContaining({ method: "PUT", body: JSON.stringify({ manager_backend: "local-small", manager_local_model: "tiny-model", manager_local_base_url: "http://localhost:1234/v1", manager_fallback_to_rules: "1", manager_daily_max: "9" }) })));
});

it("tests local connectivity and switches the manager to rules", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => new Response(JSON.stringify(String(url).endsWith("/manager") && !init?.method ? manager : { ok: true })));
  vi.stubGlobal("fetch", fetcher);
  mount(<Settings />);
  await screen.findByText("Manager");
  fireEvent.click(screen.getByRole("button", { name: "Test local connection" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/manager/test-connection", expect.objectContaining({ method: "POST", body: JSON.stringify({ model: "qwen2.5:3b", base_url: "http://127.0.0.1:11434/v1" }) })));
  fireEvent.click(screen.getByRole("button", { name: "Switch to rules" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/manager/switch-to-rules", expect.objectContaining({ method: "POST" })));
});

it("shows current manager backend and the last decision reason on dashboard", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(String(url).endsWith("/manager") ? manager : []))));
  mount(<Dashboard project="" />);
  expect(await screen.findByText("Manager · codex")).toBeTruthy();
  expect(await screen.findByText(/rules fallback \(codex: unavailable\); selected T-1/)).toBeTruthy();
});
