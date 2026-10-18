import { dispatch } from "../src/core/dispatch.js";
import { it, expect, afterEach } from "vitest";
import { fixture } from "./helpers.js";
import { parseUsage, JsonOpenUsageProvider, CliOpenUsageProvider, collectUsage } from "../src/workers/openusage.js";
import { checkQuota, usageState } from "../src/core/usage.js";
import { createApp } from "../src/server.js";
import { cli } from "../src/cli.js";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tick } from "../src/core/tick.js";
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

it("imports Codex percentage rate-limit windows as quota and applies scheduling warnings", () => {
  f = fixture();
  const now = new Date().toISOString();
  const primaryReset = new Date(Date.now() + 60_000).toISOString();
  const data = {schema_version:"1",openusage_version:"0.26.1",source:"daemon",snapshots:[
    {provider_id:"codex",account_id:"account-a",timestamp:now,status:"OK",metrics:{
      rate_limit_primary:{unit:"%",window:"5h",used:91,remaining:9,limit:100},
      cache_hit_ratio:{unit:"%",window:"30d",used:95,remaining:5,limit:100},
    },resets:{rate_limit_primary:primaryReset}},
  ]};
  const rows = parseUsage(JSON.stringify(data), "cli:fixture");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    provider:"codex", type:"quota", used:91, remaining:9,
    reset_at:primaryReset, source:"cli:fixture;openusage:0.26.1;daemon",
  });
  expect(rows[0].window).toContain("rate_limit_primary[%]/5h");
  expect(rows[0].window).not.toContain("account-a");
  f.repo.addUsageSnapshot(rows[0]);
  expect(checkQuota(f.repo, "codex")).toMatchObject({ok:true,warning:expect.stringContaining("Low quota")});

  const exhausted = parseUsage(JSON.stringify({...data,snapshots:[{
    ...data.snapshots[0],status:"LIMITED",metrics:{
      rate_limit_secondary:{unit:"%",window:"7d",used:100,remaining:0,limit:100},
    },resets:{rate_limit_secondary:primaryReset},
  }]}), "cli:fixture")[0];
  f.repo.addUsageSnapshot(exhausted);
  expect(checkQuota(f.repo, "codex")).toMatchObject({ok:false,warning:expect.stringContaining("rate_limit_secondary")});
  expect(() => dispatch(f.repo, f.task().identifier)).toThrow("Quota exhausted");
});

it("treats OpenUsage limited usage windows and USD balances as quota, including capitalized fields", () => {
  f = fixture();
  const now = new Date().toISOString();
  const data = {schema_version:"1",openusage_version:"0.26.1",source:"daemon",snapshots:[
    {provider_id:"codex",timestamp:now,status:"LIMITED",metrics:{
      rolling_usage:{Unit:"requests",Window:"5h",Used:100,Limit:100},
      weekly_usage:{unit:"requests",window:"7d",used:25,limit:100},
      usage_five_hour:{unit:"requests",window:"5h",used:10,remaining:90},
      credit_balance:{unit:"USD",window:"monthly",used:20,remaining:0},
      monthly_limit:{unit:"USD",window:"monthly",used:50,limit:50},
      total_cost:{unit:"USD",window:"monthly",used:12},
    }},
  ]};
  const rows = parseUsage(JSON.stringify(data), "cli:fixture");
  for (const name of ["rolling_usage", "weekly_usage", "usage_five_hour", "credit_balance", "monthly_limit"])
    expect(rows.find((snapshot) => snapshot.window.includes(name))?.type).toBe("quota");
  expect(rows.find((snapshot) => snapshot.window.includes("rolling_usage"))).toMatchObject({used:100,remaining:0});
  expect(rows.find((snapshot) => snapshot.window.includes("monthly_limit"))?.remaining).toBe(0);
  expect(rows.find((snapshot) => snapshot.window.includes("total_cost"))).toMatchObject({type:"cost",remaining:"unknown"});
  for (const snapshot of rows) f.repo.addUsageSnapshot(snapshot);
  expect(checkQuota(f.repo, "codex").ok).toBe(false);
});

it("does not block the selected Ollama backend with a different provider's exhausted quota", () => {
  f=fixture();
  f.repo.setSetting("ollama_fallback_enabled","1");f.repo.setSetting("llm_backend","ollama");
  f.repo.addUsageSnapshot(parseUsage(envelope([row({provider:"codex",remaining:0})]),"fixture")[0]);
  const task=f.task();expect(()=>dispatch(f.repo,task.identifier)).not.toThrow();
  f.repo.addUsageSnapshot(parseUsage(envelope([row({provider:"ollama",remaining:0})]),"fixture")[0]);
  const next=f.task();expect(()=>dispatch(f.repo,next.identifier)).toThrow("Quota exhausted");
});

it("keeps quota-deferred tasks ready and recovers legacy quota blocks after a positive collection", async () => {
  f = fixture();
  const first = f.task();
  const second = f.task();
  f.repo.addUsageSnapshot(parseUsage(envelope([row({provider:"codex",remaining:0})]),"fixture")[0]);
  tick(f.repo);
  expect(f.repo.runs()).toHaveLength(0);
  expect([f.repo.task(first.id).status, f.repo.task(second.id).status]).toEqual(["ready", "ready"]);
  expect(
    (f.repo.events() as { kind: string }[]).filter(
      (event) => event.kind === "quota_deferred",
    ),
  ).toHaveLength(2);

  f.repo.updateTask(first.id, {
    status: "blocked",
    blocker: "Error: Quota exhausted for codex/week",
  });
  await collectUsage(f.repo, {name:"fixture", fetch:async()=>parseUsage(envelope([row({provider:"codex",used:1,remaining:9})]),"fixture")});
  expect(f.repo.task(first.id)).toMatchObject({status:"ready", blocker:""});
  expect(f.repo.events()).toEqual(expect.arrayContaining([expect.objectContaining({kind:"quota_recovered",task_id:first.id})]));
});
