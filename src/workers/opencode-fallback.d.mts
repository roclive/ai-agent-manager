export const FALLBACK_BASE_URL: string;
export const FALLBACK_CONTEXT: number;
export function fallbackProvider(
  id: string,
  model: string,
  baseUrl?: string,
  contextWindow?: number,
): {
  id: string;
  kind: "opencode" | "ollama";
  model: string;
  codingWorker: boolean;
  tools: boolean;
  json: boolean;
  health: { status: "unknown"; detail: string };
  freeQuota: "unknown";
  contextWindow: number;
  baseUrl?: string;
};
export function fallbackRunArgs(
  worktree: string,
  model: string,
  prompt: string,
): string[];
