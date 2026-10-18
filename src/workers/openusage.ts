import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Repo } from "../db/index.js";
import type { UsageSnapshot } from "../db/usage.js";
import { runner, type Runner } from "../core/process.js";
import { checkQuota, usageState } from "../core/usage.js";
import { llmBackend } from "../core/llm.js";

export type UsageInput = Omit<UsageSnapshot, "id" | "created_at">;
export interface OpenUsageProvider {
  name: string;
  fetch(): Promise<UsageInput[]>;
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function text(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw Error(`Invalid usage ${field}`);
  return value;
}
function amount(value: unknown): number | "unknown" {
  if (value == null || value === "unknown") return "unknown";
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw Error("Invalid usage amount");
  return value;
}
function date(value: unknown, nullable = false): string | null {
  if (value == null && nullable) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw Error("Invalid usage timestamp");
  return new Date(value).toISOString();
}
// AAM interchange envelope. Raw unversioned arrays remain readable for existing exports.
export function parseUsage(content: string, source: string): UsageInput[] {
  if (Buffer.byteLength(content) > 1024 * 1024) throw Error("Usage payload exceeds 1 MiB");
  const value: unknown = JSON.parse(content);
  if (record(value) && value.schema_version === "1") {
    if (!Array.isArray(value.snapshots)) throw Error("Invalid OpenUsage snapshots");
    const flattened: Record<string, unknown>[] = [];
    for (const snapshot of value.snapshots) {
      if (!record(snapshot) || !record(snapshot.metrics)) throw Error("Invalid OpenUsage snapshot metrics");
      const provider = text(snapshot.provider_id, "provider_id");
      const account = createHash("sha256").update(String(snapshot.account_id ?? "default")).digest("hex").slice(0, 12);
      const resets = record(snapshot.resets) ? snapshot.resets : {};
      const trusted = ["OK", "NEAR_LIMIT", "LIMITED"].includes(String(snapshot.status));
      let quotas = 0;
      for (const [name, metric] of Object.entries(snapshot.metrics)) {
        if (!record(metric)) throw Error("Invalid OpenUsage metric");
        const cost = metric.unit === "USD";
        // Analytical ratios and cumulative consumption never establish subscription limits.
        const quota = /quota|limit|^(rpm|tpm|rpd|tpd)$/.test(name);
        if (!cost && !quota) continue;
        if (quota && !cost) quotas++;
        flattened.push({provider, type: cost ? "cost" : "quota",
          window: `${account}/${name}[${String(metric.unit ?? "unknown")}]/${String(metric.window ?? "unknown")}`,
          used: metric.used ?? "unknown", remaining: cost || !trusted ? "unknown" : metric.remaining ?? "unknown",
          reset_at: resets[name] ?? resets[name + "_reset"] ?? null,
          freshness: snapshot.timestamp ?? "unknown"});
      }
      if (!quotas) flattened.push({provider, type:"quota", window:`${account}/subscription/unknown`,
        used:"unknown", remaining:"unknown", freshness:snapshot.timestamp ?? "unknown"});
    }
    const provenance = `${source};openusage:${text(value.openusage_version, "version")};${text(value.source, "source")}`;
    return parseUsage(JSON.stringify({schema_version:1,snapshots:flattened}), provenance);
  }
  const rows = Array.isArray(value) ? value : record(value) && value.schema_version === 1 ? value.snapshots : null;
  if (!Array.isArray(rows)) throw Error("Unsupported usage schema; expected schema_version=1 snapshots");
  return rows.map((row): UsageInput => {
    if (!record(row) || !["cost", "quota"].includes(String(row.type))) throw Error("Invalid usage snapshot type");
    const snapshot: UsageInput = {
      provider: text(row.provider, "provider"), type: row.type as "cost" | "quota",
      window: text(row.window, "window"), used: amount(row.used), remaining: amount(row.remaining),
      reset_at: date(row.reset_at, true), source,
      // Missing collection time stays explicitly unknown, never becomes fresh on import.
      freshness: (row.freshness == null || row.freshness === "unknown") ? "unknown" : date(row.freshness)!, raw_data: "",
    };
    // Only validated public fields are retained; arbitrary CLI fields may contain credentials.
    snapshot.raw_data = JSON.stringify({schema_version: 1, ...snapshot, raw_data: undefined});
    return snapshot;
  });
}
export class FakeOpenUsageProvider implements OpenUsageProvider {
  name = "fake";
  async fetch() {
    return parseUsage(JSON.stringify({schema_version: 1, snapshots: [
      {provider: "openai", type: "quota", window: "monthly", used: 100, remaining: 900, freshness: new Date().toISOString()},
      {provider: "anthropic", type: "cost", window: "monthly", used: 50, remaining: "unknown", freshness: new Date().toISOString()},
    ]}), "fake-api");
  }
}
export class JsonOpenUsageProvider implements OpenUsageProvider {
  constructor(public name: string, public filePath: string) {}
  async fetch() { return parseUsage(readFileSync(this.filePath, "utf8"), `file:${this.filePath}`); }
}
export class CliOpenUsageProvider implements OpenUsageProvider {
  constructor(public name: string, private executable: string, private args: string[], private cwd: string, private run: Runner = runner) {}
  async fetch() {
    const result = this.run(this.executable, this.args, this.cwd, undefined, 10000);
    if (result.status !== 0) throw Error("Usage CLI unavailable, failed or timed out");
    return parseUsage(result.stdout, `cli:${this.executable}`);
  }
}
export async function collectUsage(repo: Repo, provider: OpenUsageProvider) {
  try {
    const snapshots = await provider.fetch();
    repo.db.transaction(() => { for (const s of snapshots) repo.addUsageSnapshot(s); })();
    for (const task of repo.tasks({ status: "blocked" })) {
      if (!/^(?:Error: )?Quota exhausted for /.test(task.blocker)) continue;
      const selected = llmBackend(repo) === "ollama" ? "ollama" : task.worker;
      const quotas = repo
        .usageSnapshots(selected)
        .filter((snapshot) => snapshot.type === "quota");
      const recoveryEvidence = quotas.some(
        (snapshot) =>
          (snapshot.reset_at !== null &&
            Date.parse(snapshot.reset_at) <= Date.now()) ||
          (usageState(snapshot) === "fresh" &&
            snapshot.remaining !== "unknown" &&
            snapshot.remaining > 0),
      );
      if (recoveryEvidence && checkQuota(repo, selected).ok) {
        repo.updateTask(task.id, { status: "ready", blocker: "" });
        repo.event("quota_recovered", `Quota available for ${selected}`, task.id);
      }
    }
    repo.event("usage_collected", `${provider.name}: ${snapshots.length} snapshots`);
    return snapshots;
  } catch (error) {
    repo.event("usage_collection_error", `${provider.name}: collection failed; retained previous snapshots`);
    throw error;
  }
}
