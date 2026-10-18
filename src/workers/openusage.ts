import { readFileSync } from "node:fs";
import { Repo } from "../db/index.js";
import { UsageSnapshot } from "../db/usage.js";

export interface OpenUsageProvider {
  name: string;
  fetch(): Promise<Partial<UsageSnapshot>[]>;
}

export class FakeOpenUsageProvider implements OpenUsageProvider {
  name = "fake";
  async fetch() {
    return [
      {
        provider: "openai",
        type: "quota" as "cost" | "quota",
        window: "monthly",
        used: 100,
        remaining: 900,
        reset_at: new Date(Date.now() + 86400000 * 30).toISOString(),
        source: "fake-api",
        freshness: new Date().toISOString(),
        raw_data: JSON.stringify({ used: 100, remaining: 900 }),
        created_at: new Date().toISOString(),
      },
      {
        provider: "anthropic",
        type: "cost" as "cost" | "quota",
        window: "monthly",
        used: 50,
        remaining: "unknown" as number | "unknown",
        reset_at: null,
        source: "fake-api",
        freshness: new Date().toISOString(),
        raw_data: JSON.stringify({ cost: 50 }),
        created_at: new Date().toISOString(),
      },
    ];
  }
}

export class JsonOpenUsageProvider implements OpenUsageProvider {
  constructor(public name: string, public filePath: string) {}

  async fetch() {
    try {
      const content = readFileSync(this.filePath, "utf8");
      const data = JSON.parse(content);
      if (!Array.isArray(data)) {
        throw new Error("Expected array of usage snapshots");
      }

      return data.map((item, index) => {
        if (!item.provider || !item.type || !item.window) {
          throw new Error(`Snapshot at index ${index} missing required fields (provider, type, window)`);
        }
        return {
          provider: String(item.provider),
          type: (item.type === "cost" || item.type === "quota" ? item.type : "quota") as "cost" | "quota",
          window: String(item.window),
          used: (typeof item.used === "number" ? item.used : "unknown") as number | "unknown",
          remaining: (typeof item.remaining === "number" ? item.remaining : "unknown") as number | "unknown",
          reset_at: item.reset_at ? new Date(item.reset_at).toISOString() : null,
          source: String(item.source || "json-file"),
          freshness: item.freshness ? new Date(item.freshness).toISOString() : new Date().toISOString(),
          raw_data: JSON.stringify(item),
          created_at: new Date().toISOString(),
        };
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`Failed to collect usage from ${this.filePath}: ${message}`);
      return [];
    }
  }
}

export async function collectUsage(repo: Repo, provider: OpenUsageProvider) {
  const snapshots = await provider.fetch();
  for (const s of snapshots) {
    repo.addUsageSnapshot(s as any);
  }
  return snapshots;
}
