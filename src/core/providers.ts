import type { Repo, Task } from "../db/index.js";
import { checkQuota } from "./usage.js";
import {
  parseProviderPolicy,
  type Complexity,
  type ProviderRule,
} from "./provider-policy.js";

export type {
  Complexity,
  ProviderClass,
  ProviderRule,
} from "./provider-policy.js";

export interface ProviderSelection extends ProviderRule {
  amount: number;
}

const levels: Complexity[] = ["low", "medium", "high"];

export function providerRules(repo: Repo): ProviderRule[] {
  const source = repo.getSetting("provider_policy") || "";
  if (!source) return [];
  return parseProviderPolicy(source);
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
