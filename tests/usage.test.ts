import { dispatch } from "../src/core/dispatch.js";
import { it, expect, afterEach } from "vitest";
import { fixture } from "./helpers.js";
import { parseUsage, JsonOpenUsageProvider, CliOpenUsageProvider, collectUsage } from "../src/workers/openusage.js";
import { checkQuota, usageState } from "../src/core/usage.js";
import { createApp } from "../src/server.js";
import { cli } from "../src/cli.js";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
let f: ReturnType<typeof fixture>;
afterEach(() => f?.cleanup());
const row = (patch = {}) => ({provider: "test", type: "quota", window: "week", used: 95, remaining: 5, freshness: new Date().toISOString(), ...patch});
const envelope = (rows: unknown[]) => JSON.stringify({schema_version: 1, snapshots: rows});
it("validates versions, types, numbers and timestamps without partially importing or leaking fields", async () => {
  f = fixture();
  for (const payload of [{schema_version: 2, snapshots: []}, {schema_version: 1, snapshots: [row({type:"invented"})]},
    {schema_version: 1, snapshots: [row({used: -1})]}, {schema_version: 1, snapshots: [row({freshness:"bad"})]}]) {
    expect(() => parseUsage(JSON.stringify(payload), "test-source")).toThrow();
  }
  const parsed = parseUsage(envelope([row({api_key:"secret-fixture"})]), "trusted-file");
  expect(parsed[0].raw_data).not.toContain("secret-fixture");
  expect(parsed[0].source).toBe("trusted-file");
  await expect(collectUsage(f.repo, {name:"broken", fetch:async()=>{throw Error("schema change");}})).rejects.toThrow();
  expect(f.repo.usageSnapshots()).toEqual([]);
  expect(f.repo.events()).toMatchObject([{kind:"usage_collection_error"}]);
});
it("runs an offline exporter executable with a bounded timeout and stores per-window snapshots", async () => {
  f = fixture();
  const script = resolve(f.repo.home, "fake-exporter.cjs");
  writeFileSync(script, `process.stdout.write(${JSON.stringify(envelope([row(),row({window:"day",remaining:0}),row({type:"cost",window:"billing",remaining:"unknown"})]))});`);
  const provider = new CliOpenUsageProvider("fixture", process.execPath, [script], f.repo.home);
  await collectUsage(f.repo, provider);
  expect(f.repo.usageSnapshots("test")).toHaveLength(3);
  expect(checkQuota(f.repo,"test").ok).toBe(false);
  expect(f.repo.usageSnapshots().every(s=>s.source.startsWith("cli:"))).toBe(true);
});
it("handles unavailable CLI and timeout while retaining prior evidence", async () => {
  f = fixture();
  for (const status of [1,null]) {
    const provider = new CliOpenUsageProvider("fixture","unavailable",[],f.repo.home, (_cmd,_args,_cwd,_input,timeout)=>{
      expect(timeout).toBe(10000); return {status,stdout:"",stderr:"not emitted to events"};
    });
    await expect(collectUsage(f.repo,provider)).rejects.toThrow("unavailable");
  }
});
it("keeps unknown, stale, reset and cost records distinct from usable quota", () => {
  f = fixture();
  expect(checkQuota(f.repo,"test")).toMatchObject({ok:true,warning:expect.stringContaining("unknown")});
  const add = (patch = {}) => f.repo.addUsageSnapshot(parseUsage(envelope([row(patch)]), "fixture")[0]);
  add({remaining:"unknown"});
  expect(f.repo.latestUsage("test")?.remaining).toBe("unknown");
  expect(checkQuota(f.repo,"test").warning).toContain("unknown");
  add({remaining:0,freshness:new Date(Date.now()-3600000).toISOString()});
  expect(checkQuota(f.repo,"test")).toMatchObject({ok:true,warning:expect.stringContaining("stale")});
  add({remaining:0,reset_at:new Date(Date.now()-1000).toISOString()});
  expect(checkQuota(f.repo,"test").warning).toContain("pending refresh");
  add({remaining:0}); add({type:"cost",remaining:1000});
  expect(checkQuota(f.repo,"test").ok).toBe(false); // latest cost cannot mask quota exhaustion
  expect(usageState({...f.repo.latestUsage("test")!,freshness:"unknown"})).toBe("unknown");
});
it("exposes provenance and freshness through the API", async () => {
  f = fixture();
  const file = resolve(f.repo.home,"snapshot.json");writeFileSync(file,envelope([row({remaining:"unknown"})]));
  await collectUsage(f.repo,new JsonOpenUsageProvider("fixture",file));
  const response=await createApp(f.repo).request("/api/usage?provider=test");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({schema_version:1,snapshots:[{provider:"test",source:`file:${file}`,state:"fresh",remaining:"unknown"}]});
});
it("accepts the CLI JSON import option and lists provider snapshots rather than project keys", async () => {
  f = fixture();const path=resolve(f.repo.home,"fixture.json");writeFileSync(path,envelope([row()]));
  await cli(f.repo).parseAsync(["usage","collect","--provider","fixture","--json",path],{from:"user"});
  expect(f.repo.usageSnapshots("test")).toHaveLength(1);
});
it("imports the documented OpenUsage 0.26 string-version envelope without turning analytics into quota", () => {
  const data = {schema_version:"1",openusage_version:"0.26.1",source:"daemon",generated_at:new Date().toISOString(),snapshots:[
    {provider_id:"codex",account_id:"account-a",timestamp:new Date().toISOString(),status:"OK",metrics:{
      cache_hit_ratio:{unit:"%",window:"30d",used:20,remaining:80,limit:100},
      total_cost:{unit:"USD",window:"30d",used:5},
      rpm:{unit:"requests",window:"1m",used:3,remaining:7,limit:10},
    }},
    {provider_id:"codex",account_id:"account-b",timestamp:new Date().toISOString(),status:"UNKNOWN",metrics:{}},
  ]};
  const rows=parseUsage(JSON.stringify(data),"cli:fixture");
  expect(rows).toHaveLength(3);
  expect(rows.some(s=>s.window.includes("cache_hit"))).toBe(false);
  expect(rows.find(s=>s.type==="cost")).toMatchObject({used:5,remaining:"unknown"});
  expect(rows.find(s=>s.window.includes("rpm"))).toMatchObject({remaining:7,source:"cli:fixture;openusage:0.26.1;daemon"});
  expect(rows.find(s=>s.window.includes("subscription"))?.remaining).toBe("unknown");
  expect(rows.every(s=>!s.window.includes("account-"))).toBe(true);
});

it("does not block the selected Ollama backend with a different provider's exhausted quota", () => {
  f=fixture();
  f.repo.setSetting("ollama_fallback_enabled","1");f.repo.setSetting("llm_backend","ollama");
  f.repo.addUsageSnapshot(parseUsage(envelope([row({provider:"codex",remaining:0})]),"fixture")[0]);
  const task=f.task();expect(()=>dispatch(f.repo,task.identifier)).not.toThrow();
  f.repo.addUsageSnapshot(parseUsage(envelope([row({provider:"ollama",remaining:0})]),"fixture")[0]);
  const next=f.task();expect(()=>dispatch(f.repo,next.identifier)).toThrow("Quota exhausted");
});
