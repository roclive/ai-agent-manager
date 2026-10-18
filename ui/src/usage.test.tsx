import { it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UsageSnapshots } from "./components/UsageSnapshots";
afterEach(() => vi.unstubAllGlobals());
function show(data: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(data), {headers:{"Content-Type":"application/json"}})));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><UsageSnapshots /></QueryClientProvider>);
}
it("shows unknown quota, cost distinction and snapshot provenance", async () => {
  show({schema_version:1,snapshots:[{id:1,provider:"codex",window:"week",type:"quota",used:"unknown",remaining:"unknown",source:"cli:openusage;daemon",freshness:"unknown",reset_at:null,state:"unknown",warning:"Quota unknown"}]});
  expect(await screen.findByText("codex / week")).toBeInTheDocument();
  expect(screen.getByText(/cli:openusage;daemon/)).toBeInTheDocument();
  expect(screen.getByText("未知 / 未知")).toBeInTheDocument();
});
it("reports an unsupported response instead of crashing settings", async () => {
  show({unexpected:[]});
  expect(await screen.findByText(/额度快照格式不可识别/)).toBeInTheDocument();
});
