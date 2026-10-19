export interface RoutingOverrides {
  paused: string[];
  allowed: string[] | null;
  reserve_remaining: Record<string, number>;
}

const idPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function emptyOverrides(): RoutingOverrides {
  return { paused: [], allowed: null, reserve_remaining: {} };
}

function ids(value: unknown, field: string) {
  if (
    !Array.isArray(value) ||
    value.length > 64 ||
    value.some((id) => typeof id !== "string" || !idPattern.test(id))
  )
    throw new Error(`${field} must be a list of provider ids`);
  return [...new Set(value as string[])];
}

export function parseOverrides(source: string | undefined): RoutingOverrides {
  if (!source) return emptyOverrides();
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("routing_overrides must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("routing_overrides must be an object");
  const known = ["paused", "allowed", "reserve_remaining"];
  for (const key of Object.keys(value))
    if (!known.includes(key)) throw new Error(`Unknown field ${key}`);
  const reserve = value.reserve_remaining ?? {};
  if (typeof reserve !== "object" || reserve === null || Array.isArray(reserve))
    throw new Error("reserve_remaining must be an object");
  const thresholds: Record<string, number> = {};
  for (const [id, amount] of Object.entries(reserve)) {
    if (
      !idPattern.test(id) ||
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount < 0
    )
      throw new Error(`reserve_remaining.${id} must be a nonnegative number`);
    thresholds[id] = amount;
  }
  return {
    paused: ids(value.paused ?? [], "paused"),
    allowed:
      value.allowed === null || value.allowed === undefined
        ? null
        : ids(value.allowed, "allowed"),
    reserve_remaining: thresholds,
  };
}
