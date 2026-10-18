import { describe, it, expect, beforeEach } from "vitest";
import { Repo } from "../src/db/index.js";
import { JsonOpenUsageProvider, collectUsage } from "../src/workers/openusage.js";
import { checkQuota } from "../src/core/usage.js";
import { writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

describe("Usage", () => {
  let repo: Repo;
  const dbPath = resolve(tmpdir(), `aam_usage_${Date.now()}.db`);

  beforeEach(() => {
    repo = new Repo(dbPath);
  });

  it("collects usage from JSON file", async () => {
    const jsonPath = resolve(tmpdir(), `usage_${Date.now()}.json`);
    const data = [
      {
        provider: "openai",
        type: "quota",
        window: "monthly",
        used: 100,
        remaining: 900,
        reset_at: new Date().toISOString(),
        source: "test-source",
        freshness: new Date().toISOString(),
      },
      {
        provider: "anthropic",
        type: "cost",
        window: "monthly",
        used: 50,
        remaining: "unknown",
        source: "test-source",
        freshness: new Date().toISOString(),
      },
    ];
    writeFileSync(jsonPath, JSON.stringify(data));

    const provider = new JsonOpenUsageProvider("test", jsonPath);
    await collectUsage(repo, provider);

    const openai = repo.latestUsage("openai");
    expect(Number(openai?.remaining)).toBe(900);
    expect(openai?.type).toBe("quota");

    const anthropic = repo.latestUsage("anthropic");
    expect(Number(anthropic?.used)).toBe(50);
    expect(anthropic?.type).toBe("cost");

    unlinkSync(jsonPath);
  });

  it("handles invalid JSON schema", async () => {
    const jsonPath = resolve(tmpdir(), `usage_invalid_${Date.now()}.json`);
    writeFileSync(jsonPath, JSON.stringify([{ provider: "openai" }])); // missing type, window

    const provider = new JsonOpenUsageProvider("test", jsonPath);
    const snapshots = await provider.fetch();
    expect(snapshots).toEqual([]);

    unlinkSync(jsonPath);
  });

  it("checks quota correctly", () => {
    repo.addUsageSnapshot({
      provider: "openai",
      type: "quota",
      window: "monthly",
      used: 950,
      remaining: 50,
      reset_at: null,
      source: "test",
      freshness: new Date().toISOString(),
      raw_data: "{}",
    });

    const q = checkQuota(repo, "openai");
    expect(q.ok).toBe(true);
    expect(q.warning).toContain("Low quota");

    repo.addUsageSnapshot({
      provider: "openai",
      type: "quota",
      window: "monthly",
      used: 1000,
      remaining: 0,
      reset_at: null,
      source: "test",
      freshness: new Date().toISOString(),
      raw_data: "{}",
    });

    const qExhausted = checkQuota(repo, "openai");
    console.log("Exhausted snapshot:", repo.latestUsage("openai"));
    expect(qExhausted.ok).toBe(false);
    expect(qExhausted.warning).toContain("exhausted");
  });

  it("treats unknown as ok", () => {
    repo.addUsageSnapshot({
      provider: "openai",
      type: "quota",
      window: "monthly",
      used: "unknown",
      remaining: "unknown",
      reset_at: null,
      source: "test",
      freshness: new Date().toISOString(),
      raw_data: "{}",
    });

    const q = checkQuota(repo, "openai");
    expect(q.ok).toBe(true);
  });
});
