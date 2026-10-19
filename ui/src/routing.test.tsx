import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoutingConsole } from "./components/RoutingConsole";
afterEach(() => vi.unstubAllGlobals());
const view = {
  schema_version: 1,
  overrides: { allowed: null },
  queue: { ready: 2, identifiers: ["T-1", "T-2"] },
  providers: [
    { id: "free-a", worker: "opencode", free_tier: "free", quota_known: false, paused: false, allowed: true, reserve_remaining: 1, reserved: 0, cooldown_until: null, quota: [] },
    { id: "free-b", worker: "opencode", free_tier: "local", quota_known: true, paused: true, allowed: true, reserve_remaining: 0, reserved: 0, cooldown_until: null,
      quota: [{ window: "day", state: "stale", used: 1, remaining: 9, reset_at: "2026-10-20T00:00:00Z", collected_at: "2026-10-19T00:00:00Z", source: "x" }] },
  ],
  history: [
    { id: 2, ts: "t2", kind: "route_switch", message: JSON.stringify({ from: "free-a", to: "free-b" }), identifier: "T-1" },
    { id: 1, ts: "t1", kind: "route_selected", message: JSON.stringify({ provider: "free-a", reason: "ranked first" }), identifier: "T-1" },
  ],
};
function show() {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(view), { headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RoutingConsole /></QueryClientProvider>);
  return fetchMock;
}
it("shows freshness, unknown quota, queue and history", async () => {
  show();
  expect(await screen.findByText(/无额度记录（未知）/)).toBeInTheDocument();
  expect(screen.getByText(/免费（额度未知）/)).toBeInTheDocument();
  expect(screen.getByText(/陈旧/)).toBeInTheDocument();
  expect(screen.getByText(/free-a → free-b/)).toBeInTheDocument();
  expect(screen.getByText(/ranked first/)).toBeInTheDocument();
  expect(screen.getByText(/T-1, T-2/)).toBeInTheDocument();
});
it("pauses a provider and validates thresholds", async () => {
  const fetchMock = show();
  fireEvent.click(await screen.findByText("暂停 free-a"));
  await waitFor(() => {
    const call = fetchMock.mock.calls.find((c) => c[1]?.method === "PUT");
    expect(JSON.parse(call![1]!.body as string)).toEqual({ paused: ["free-b", "free-a"] });
  });
  fireEvent.change(screen.getByLabelText("free-a 保留阈值"), { target: { value: "-3" } });
  expect(screen.getByRole("alert")).toHaveTextContent("阈值必须");
});
