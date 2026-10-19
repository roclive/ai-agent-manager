import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CLAUDE_WORKER_SCRIPT = fileURLToPath(
  new URL("../../scripts/claude-worker.sh", import.meta.url),
);
export function isClaudeWorkerScript(path: string) {
  return resolve(path) === CLAUDE_WORKER_SCRIPT;
}
