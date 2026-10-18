import { Repo } from "../db/index.js";
import type { UsageSnapshot } from "../db/usage.js";

export class QuotaUnavailableError extends Error {}

export function usageState(
  snapshot: UsageSnapshot,
  now = Date.now(),
): "fresh" | "stale" | "unknown" {
  const age = now - Date.parse(snapshot.freshness);
  return !Number.isFinite(age) || age < -60000
    ? "unknown"
    : age > 15 * 60000
      ? "stale"
      : "fresh";
}
export function checkQuota(
  repo: Repo,
  provider: string,
  capacity: {
    reserved?: number;
    reserveRemaining?: number;
    required?: number;
  } = {},
): { ok: boolean; warning?: string } {
  const quotas = repo
    .usageSnapshots(provider)
    .filter((s) => s.type === "quota");
  if (!quotas.length)
    return {
      ok: true,
      warning: `Quota unknown for ${provider}; cost is not remaining quota`,
    };
  let warning: string | undefined;
  for (const snapshot of quotas) {
    const state = usageState(snapshot);
    const expired =
      snapshot.reset_at !== null && Date.parse(snapshot.reset_at) <= Date.now();
    if (state !== "fresh" || expired || snapshot.remaining === "unknown") {
      warning = `Quota ${expired ? "reset pending refresh" : state === "fresh" ? "unknown" : state} for ${provider}/${snapshot.window}`;
      continue;
    }
    const unavailable =
      (capacity.reserved || 0) +
      (capacity.reserveRemaining || 0) +
      (capacity.required || 0);
    if (snapshot.remaining < unavailable || snapshot.remaining <= 0)
      return {
        ok: false,
        warning: `Quota exhausted or reserved for ${provider}/${snapshot.window}`,
      };
    const total =
      snapshot.used === "unknown" ? null : snapshot.used + snapshot.remaining;
    if (total && snapshot.remaining / total <= 0.1)
      warning = `Low quota for ${provider}/${snapshot.window}`;
  }
  return { ok: true, ...(warning ? { warning } : {}) };
}
