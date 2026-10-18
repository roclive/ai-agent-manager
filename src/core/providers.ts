import type { Repo, Task } from "../db/index.js";
import { checkQuota } from "./usage.js";

export type Complexity = "low" | "medium" | "high";
export type ProviderClass = "free" | "local" | "premium" | "standard";

export interface ProviderRule {
  id: string;
  worker: "codex" | "opencode";
  class: ProviderClass;
  legal: boolean;
  roles: Array<"backend" | "frontend" | "testing" | "any">;
  max_complexity: Complexity;
  reserve_remaining: number;
  reservation: Record<Complexity, number>;
}

export interface ProviderSelection extends ProviderRule {
  amount: number;
}

const levels: Complexity[] = ["low", "medium", "high"];
const classes: ProviderClass[] = ["free", "local", "premium", "standard"];

function finiteNonnegative(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error(`${field} must be a nonnegative number`);
  return value;
}

export function providerRules(repo: Repo): ProviderRule[] {
  const source = repo.getSetting("provider_policy") || "";
  if (!source) return [];
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("provider_policy must be valid JSON");
  }
  const policy = value as { version?: unknown; providers?: unknown };
  if (policy?.version !== 1 || !Array.isArray(policy.providers))
    throw new Error("provider_policy requires version 1 and providers");
  const ids = new Set<string>();
  return policy.providers.map((raw, index) => {
    const p = raw as Record<string, unknown>;
    const at = `provider_policy.providers[${index}]`;
    if (
      typeof p?.id !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(p.id) ||
      ids.has(p.id)
    )
      throw new Error(`${at}.id is invalid or duplicated`);
    ids.add(p.id);
    if (!["codex", "opencode"].includes(String(p.worker)))
      throw new Error(`${at}.worker is invalid`);
    if (!classes.includes(p.class as ProviderClass))
      throw new Error(`${at}.class is invalid`);
    if (typeof p.legal !== "boolean")
      throw new Error(`${at}.legal is required`);
    if (
      !Array.isArray(p.roles) ||
      !p.roles.length ||
      p.roles.some(
        (role) =>
          !["backend", "frontend", "testing", "any"].includes(String(role)),
      )
    )
      throw new Error(`${at}.roles is invalid`);
    if (!levels.includes(p.max_complexity as Complexity))
      throw new Error(`${at}.max_complexity is invalid`);
    const reservation = p.reservation as Record<string, unknown>;
    if (
      !reservation ||
      typeof reservation !== "object" ||
      Array.isArray(reservation)
    )
      throw new Error(`${at}.reservation is required`);
    return {
      id: p.id,
      worker: p.worker as ProviderRule["worker"],
      class: p.class as ProviderClass,
      legal: p.legal,
      roles: p.roles as ProviderRule["roles"],
      max_complexity: p.max_complexity as Complexity,
      reserve_remaining: finiteNonnegative(
        p.reserve_remaining,
        `${at}.reserve_remaining`,
      ),
      reservation: Object.fromEntries(
        levels.map((level) => [
          level,
          finiteNonnegative(reservation[level], `${at}.reservation.${level}`),
        ]),
      ) as Record<Complexity, number>,
    };
  });
}

export function providerCooldown(
  repo: Repo,
  provider: string,
  now = Date.now(),
) {
  const row = repo.db
    .prepare("SELECT cooldown_until FROM provider_breakers WHERE provider=?")
    .get(provider) as { cooldown_until: string } | undefined;
  return row && Date.parse(row.cooldown_until) > now
    ? row.cooldown_until
    : null;
}

export function freezeProvider(
  repo: Repo,
  provider: string,
  reason: string,
  minutes = 30,
) {
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  repo.db
    .prepare(
      `INSERT INTO provider_breakers(provider,cooldown_until,reason,updated_at)
    VALUES (?,?,?,?) ON CONFLICT(provider) DO UPDATE SET cooldown_until=excluded.cooldown_until,
    reason=excluded.reason,updated_at=excluded.updated_at`,
    )
    .run(provider, until, reason, new Date().toISOString());
  repo.event(
    "provider_cooldown",
    `${provider} frozen until ${until}: ${reason}`,
  );
  return until;
}

export function activeReservation(repo: Repo, provider: string) {
  const row = repo.db
    .prepare(
      "SELECT COALESCE(SUM(amount),0) total FROM provider_reservations WHERE provider=?",
    )
    .get(provider) as { total: number };
  return Number(row.total);
}

function capable(rule: ProviderRule, task: Task) {
  return (
    rule.legal &&
    (rule.roles.includes("any") ||
      rule.roles.includes(task.role as ProviderRule["roles"][number])) &&
    levels.indexOf(task.complexity) <= levels.indexOf(rule.max_complexity)
  );
}

export function selectProvider(repo: Repo, task: Task): ProviderSelection {
  const configured = providerRules(repo);
  if (!configured.length) {
    const id =
      repo.getSetting("ollama_fallback_enabled") === "1" &&
      repo.getSetting("llm_backend") === "ollama"
        ? "ollama"
        : task.worker;
    return {
      id,
      worker: id === "ollama" ? "codex" : (task.worker as "codex" | "opencode"),
      class: "standard",
      legal: true,
      roles: ["any"],
      max_complexity: "high",
      reserve_remaining: 0,
      reservation: { low: 0, medium: 0, high: 0 },
      amount: 0,
    };
  }
  const failures: string[] = [];
  const ordered = configured
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => {
      const rank = (rule: ProviderRule) =>
        rule.class === "free" || rule.class === "local" ? 0 : 1;
      return rank(a.rule) - rank(b.rule) || a.index - b.index;
    });
  for (const { rule } of ordered) {
    if (!capable(rule, task)) {
      failures.push(`${rule.id}: capability/legal mismatch`);
      continue;
    }
    if (providerCooldown(repo, rule.id)) {
      failures.push(`${rule.id}: cooldown`);
      continue;
    }
    const amount = rule.reservation[task.complexity];
    const quota = checkQuota(repo, rule.id, {
      reserved: activeReservation(repo, rule.id),
      reserveRemaining: rule.reserve_remaining,
      required: amount,
    });
    if (!quota.ok) {
      failures.push(`${rule.id}: ${quota.warning || "quota unavailable"}`);
      continue;
    }
    return { ...rule, amount };
  }
  throw new Error(
    `No provider available (${failures.join("; ") || "no providers configured"})`,
  );
}

export function reserveProvider(
  repo: Repo,
  runId: number,
  selected: ProviderSelection,
) {
  repo.db
    .prepare(
      "INSERT INTO provider_reservations(run_id,provider,amount,created_at) VALUES (?,?,?,?)",
    )
    .run(runId, selected.id, selected.amount, new Date().toISOString());
}

export function releaseProvider(repo: Repo, runId: number) {
  repo.db
    .prepare("DELETE FROM provider_reservations WHERE run_id=?")
    .run(runId);
}
