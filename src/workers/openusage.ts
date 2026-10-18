import { Repo } from "../db/index.js";
import { UsageSnapshot } from "../db/usage.js";

export interface OpenUsageProvider {
  name: string;
  fetch(): Promise<UsageSnapshot[]>;
}

export class FakeOpenUsageProvider implements OpenUsageProvider {
  name = "fake";
  async fetch() {
    return [
      {
        provider: "openai",
        type: "quota",
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
        type: "cost",
        window: "monthly",
        used: 50,
        remaining: "unknown",
        reset_at: null,
        source: "fake-api",
        freshness: new Date().toISOString(),
        raw_data: JSON.stringify({ cost: 50 }),
        created_at: new Date().toISOString(),
      },
    ];
  }
}

export async function collectUsage(repo: Repo, provider: OpenUsageProvider) {
  const snapshots = await provider.fetch();
  for (const s of snapshots) {
    repo.addUsageSnapshot(s);
  }
  return snapshots;
}
