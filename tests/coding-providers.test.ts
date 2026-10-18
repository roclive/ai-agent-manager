import { describe, expect, it } from "vitest";
import {
  parseCodingProviders,
  providerStatuses,
  routedModels,
} from "../src/workers/coding-providers.mjs";

const base = {
  version: 1,
  providers: [
    {
      id: "free",
      kind: "opencode",
      model: "opencode/glm-5.3-flash-free",
      codingWorker: true,
      tools: true,
      contextWindow: 131072,
      json: true,
    },
    {
      id: "ollama",
      kind: "ollama",
      model: "ollama/test-coder",
      baseUrl: "http://127.0.0.1:11434/v1",
      codingWorker: true,
      tools: true,
      contextWindow: 32768,
      json: true,
    },
    {
      id: "litellm",
      kind: "litellm",
      model: "litellm/test-coder",
      baseUrl: "http://127.0.0.1:4000/v1",
      codingWorker: true,
      tools: true,
      contextWindow: 16384,
      json: true,
    },
    {
      id: "chat",
      kind: "chat",
      model: "example/chat",
      codingWorker: false,
      tools: false,
      contextWindow: 8192,
      json: true,
    },
  ],
  route: ["free", "ollama", "litellm"],
};

describe("coding provider policy", () => {
  it("lists declared execution, context, JSON, quota and injected health for every adapter", async () => {
    const policy = parseCodingProviders(base);
    expect(routedModels(policy)).toEqual([
      "opencode/glm-5.3-flash-free",
      "ollama/test-coder",
      "litellm/test-coder",
    ]);
    const statuses = await providerStatuses(policy, async (provider) => ({
      status: provider.id === "free" ? "healthy" : "unknown",
      detail: "fake probe",
    }));
    expect(statuses).toHaveLength(4);
    expect(statuses[0]).toMatchObject({
      tools: true,
      contextWindow: 131072,
      json: true,
      freeQuota: "unknown",
      health: { status: "healthy" },
    });
    expect(statuses[3]).toMatchObject({ codingWorker: false, selected: false });
  });

  it("rejects bare chat and tool-less models as coding workers", () => {
    expect(() => parseCodingProviders({ ...base, route: ["chat"] })).toThrow(
      "not a coding worker",
    );
    expect(() =>
      parseCodingProviders({
        ...base,
        providers: [{ ...base.providers[0], tools: false }],
      }),
    ).toThrow("without tool execution");
    expect(() =>
      parseCodingProviders({
        ...base,
        providers: [{ ...base.providers[3], codingWorker: true, tools: true }],
        route: ["chat"],
      }),
    ).toThrow("bare chat");
  });

  it("keeps the legacy model list compatible while marking all capabilities unknown", () => {
    const policy = parseCodingProviders({ models: ["opencode/beam-free"] });
    expect(policy.providers[0]).toMatchObject({
      model: "opencode/beam-free",
      tools: "unknown",
      contextWindow: "unknown",
      json: "unknown",
      freeQuota: "unknown",
    });
  });
});
