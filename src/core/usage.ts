import { Repo } from "../db/index.js";
import { UsageSnapshot } from "../db/usage.js";

export function checkQuota(repo: Repo, provider: string): { ok: boolean; warning?: string } {
  const snapshot = repo.latestUsage(provider);
  if (!snapshot) {
    return { ok: true }; // No snapshot, assume ok but unknown
  }

  if (snapshot.type === "quota") {
    const remainingRaw = snapshot.remaining;
    // In DB, 'unknown' is stored as null
    if (remainingRaw === null || remainingRaw === "unknown") {
      return { ok: true }; // Unknown quota doesn't block
    }
    const remaining = Number(remainingRaw);
    if (isNaN(remaining)) {
      return { ok: true };
    }
    if (remaining <= 0) {
      return { ok: false, warning: `Quota exhausted for ${provider} (${remaining} remaining)` };
    }
    if (remaining < 100) {
      return { ok: true, warning: `Low quota for ${provider} (${remaining} remaining)` };
    }
  }

  return { ok: true };
}
