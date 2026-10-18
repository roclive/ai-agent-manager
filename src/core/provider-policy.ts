export type Complexity = "low" | "medium" | "high";
export type ProviderClass = "free" | "local" | "premium" | "standard";

export interface ProviderRule {
  id: string;
  worker: "codex" | "opencode" | "claude";
  class: ProviderClass;
  legal: boolean;
  roles: Array<"backend" | "frontend" | "testing" | "any">;
  max_complexity: Complexity;
  reserve_remaining: number;
  reservation: Record<Complexity, number>;
}

const levels: Complexity[] = ["low", "medium", "high"];
const classes: ProviderClass[] = ["free", "local", "premium", "standard"];

function finiteNonnegative(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error(`${field} must be a nonnegative number`);
  return value;
}

export function parseProviderPolicy(source: string): ProviderRule[] {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("provider_policy must be valid JSON");
  }
  const policy = value as { version?: unknown; providers?: unknown };
  if (policy?.version !== 1 || !Array.isArray(policy.providers))
    throw new Error("provider_policy requires version 1 and providers");
  if (policy.providers.length === 0)
    throw new Error("provider_policy.providers must not be empty");

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
    if (!["codex", "opencode", "claude"].includes(String(p.worker)))
      throw new Error(`${at}.worker is invalid`);
    if (p.worker === "codex" && !["codex", "ollama"].includes(p.id))
      throw new Error(`${at}: codex provider id must be "codex" or "ollama"`);
    if (p.worker === "claude" && p.id !== "claude")
      throw new Error(`${at}: claude provider id must be "claude"`);
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

export function providerPolicyConfigured(value: string | undefined) {
  return Boolean(value);
}
