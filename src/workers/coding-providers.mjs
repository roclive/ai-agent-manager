import { existsSync, readFileSync } from "node:fs";

const kinds = new Set(["opencode", "ollama", "litellm", "chat"]);

function requiredBoolean(value, field) {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
  return value;
}

export function parseCodingProviders(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid coding provider configuration");
  // Preserve the private pre-AAM-17 format without inventing capability claims.
  if (Array.isArray(value.models) && value.providers === undefined) {
    if (
      !value.models.length ||
      value.models.some((model) => typeof model !== "string")
    )
      throw new Error("Invalid coding backend list");
    return {
      version: 0,
      agent: value.agent,
      auto: value.auto === true,
      config: value.config,
      providers: value.models.map((model, index) => ({
        id: `legacy-${index + 1}`,
        kind: "opencode",
        model,
        codingWorker: true,
        tools: "unknown",
        contextWindow: "unknown",
        json: "unknown",
        health: {
          status: "unknown",
          detail: "legacy config; capabilities not declared",
        },
        freeQuota: "unknown",
      })),
      route: value.models.map((_, index) => `legacy-${index + 1}`),
    };
  }
  if (
    value.version !== 1 ||
    !Array.isArray(value.providers) ||
    !Array.isArray(value.route)
  )
    throw new Error(
      "Coding provider config requires version 1, providers and route",
    );
  const ids = new Set();
  const providers = value.providers.map((provider, index) => {
    const at = `providers[${index}]`;
    if (!provider || typeof provider !== "object" || Array.isArray(provider))
      throw new Error(`${at} is invalid`);
    if (
      typeof provider.id !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(provider.id) ||
      ids.has(provider.id)
    )
      throw new Error(`${at}.id is invalid or duplicated`);
    ids.add(provider.id);
    if (!kinds.has(provider.kind)) throw new Error(`${at}.kind is invalid`);
    if (typeof provider.model !== "string" || !provider.model.trim())
      throw new Error(`${at}.model is required`);
    const codingWorker = requiredBoolean(
      provider.codingWorker,
      `${at}.codingWorker`,
    );
    const tools = requiredBoolean(provider.tools, `${at}.tools`);
    const json = requiredBoolean(provider.json, `${at}.json`);
    if (
      !Number.isInteger(provider.contextWindow) ||
      provider.contextWindow <= 0
    )
      throw new Error(`${at}.contextWindow must be a positive integer`);
    if (codingWorker && !tools)
      throw new Error(
        `${provider.id} cannot be a coding worker without tool execution`,
      );
    if (provider.kind === "chat" && codingWorker)
      throw new Error(`${provider.id}: bare chat is not a coding worker`);
    if (provider.baseUrl !== undefined) {
      const url = new URL(provider.baseUrl);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error(`${at}.baseUrl is invalid`);
    }
    return {
      id: provider.id,
      kind: provider.kind,
      model: provider.model,
      codingWorker,
      tools,
      contextWindow: provider.contextWindow,
      json,
      health: { status: "unknown", detail: "not checked" },
      freeQuota: "unknown",
      ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    };
  });
  if (
    !value.route.length ||
    value.route.some((id) => typeof id !== "string" || !ids.has(id))
  )
    throw new Error("route contains an unknown provider");
  for (const id of value.route) {
    const provider = providers.find((candidate) => candidate.id === id);
    if (!provider.codingWorker) throw new Error(`${id} is not a coding worker`);
  }
  return {
    version: 1,
    agent: value.agent,
    auto: value.auto === true,
    config: value.config,
    providers,
    route: [...value.route],
  };
}

export function loadCodingProviders(path) {
  if (!existsSync(path)) return parseCodingProviders({ models: [""] });
  return parseCodingProviders(JSON.parse(readFileSync(path, "utf8")));
}

export async function providerStatuses(
  policy,
  probe = async () => ({ status: "unknown", detail: "not checked" }),
) {
  return Promise.all(
    policy.providers.map(async (provider) => ({
      ...provider,
      health: await probe(provider),
      selected: policy.route.includes(provider.id),
    })),
  );
}

export function routedModels(policy) {
  return policy.route.map(
    (id) => policy.providers.find((provider) => provider.id === id).model,
  );
}
