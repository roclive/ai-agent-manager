import { it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEventStream, useTasks } from "./lib/queries";
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
function Probe() {
  const live = useEventStream();
  useTasks(live);
  return <span>{live ? "实时" : "轮询"}</span>;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  streams.length = 0;
});
it("invalidates task/run queries on SSE events and falls back on stream errors", async () => {
  vi.stubGlobal("EventSource", FakeStream);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]")));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  expect(screen.getByText("轮询")).toBeInTheDocument();
  expect(streams[0].url).toBe("/api/stream");
  act(() => streams[0].onopen?.());
  expect(screen.getByText("实时")).toBeInTheDocument();
  expect(
    client.getQueryCache().find({ queryKey: ["tasks"] })?.observers[0].options
      .refetchInterval,
  ).toBe(false);
  act(() => streams[0].listeners.get("events")?.());
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tasks"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["runs"] });
  act(() => streams[0].onerror?.());
  expect(screen.getByText("轮询")).toBeInTheDocument();
  expect(
    client.getQueryCache().find({ queryKey: ["tasks"] })?.observers[0].options
      .refetchInterval,
  ).toBe(5000);
  view.unmount();
  expect(streams[0].close).toHaveBeenCalled();
  client.clear();
});
