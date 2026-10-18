export type Health = {
  status: "healthy" | "unhealthy" | "unknown";
  detail: string;
};
export type CodingProvider = {
  id: string;
  kind: "opencode" | "ollama" | "litellm" | "chat";
  model: string;
  codingWorker: boolean;
  tools: boolean | "unknown";
  contextWindow: number | "unknown";
  json: boolean | "unknown";
  health: Health;
  freeQuota: "unknown";
  baseUrl?: string;
};
export type CodingPolicy = {
  version: number;
  agent?: string;
  auto: boolean;
  config?: unknown;
  providers: CodingProvider[];
  route: string[];
};
export function parseCodingProviders(value: unknown): CodingPolicy;
export function loadCodingProviders(path: string): CodingPolicy;
export function providerStatuses(
  policy: CodingPolicy,
  probe?: (provider: CodingProvider) => Promise<Health>,
): Promise<Array<CodingProvider & { selected: boolean }>>;
export function routedModels(policy: CodingPolicy): string[];
