import type { Hono } from "hono";
import type { Repo } from "../db/index.js";
import { activeReservation, providerCooldown, providerRules } from "../core/providers.js";
import { usageState } from "../core/usage.js";
import { parseOverrides, type RoutingOverrides } from "../core/routing-overrides.js";

const legacyIds = ["codex", "opencode", "ollama"];

function knownIds(repo: Repo) {
  const rules = providerRules(repo);
  return rules.length ? rules.map((r) => r.id) : legacyIds;
}

export function routingView(repo: Repo) {
  const overrides = parseOverrides(repo.getSetting("routing_overrides"));
  const rules = providerRules(repo);
  const ids = knownIds(repo);
  const providers = ids.map((id) => {
    const rule = rules.find((r) => r.id === id);
    const quota = repo
      .usageSnapshots(id)
      .filter((s) => s.type === "quota")
      .map((s) => ({
        window: s.window,
        state: usageState(s),
        used: s.used,
        remaining: s.remaining,
        reset_at: s.reset_at,
        collected_at: s.freshness,
        source: s.source,
      }));
    const known = quota.some(
      (q) => q.state === "fresh" && q.remaining !== "unknown",
    );
    const policyReserve = rule?.reserve_remaining ?? 0;
    return {
      id,
      worker: rule?.worker ?? (id === "opencode" ? "opencode" : "codex"),
      class: rule?.class ?? "standard",
      free_tier:
        rule?.class === "local"
          ? "local"
          : rule?.class === "free"
            ? "free"
            : rule
              ? "paid"
              : "unknown",
      quota_known: known,
      paused: overrides.paused.includes(id),
      allowed: !overrides.allowed || overrides.allowed.includes(id),
      policy_reserve_remaining: policyReserve,
      reserve_remaining: overrides.reserve_remaining[id] ?? policyReserve,
      reserved: activeReservation(repo, id),
      cooldown_until: providerCooldown(repo, id),
      quota,
    };
  });
  const ready = repo
    .tasks({ status: "ready" })
    .filter((t) => !repo.runs(t.id).some((r) => r.status === "running"));
  const history = repo.db
    .prepare(
      `SELECT e.id,e.ts,e.kind,e.message,t.identifier FROM events e
       LEFT JOIN tasks t ON t.id=e.task_id
       WHERE e.kind IN ('route_selected','route_switch','quota_deferred','provider_cooldown','routing')
       ORDER BY e.id DESC LIMIT 50`,
    )
    .all();
  return {
    schema_version: 1,
    overrides,
    providers,
    queue: {
      ready: ready.length,
      identifiers: ready.slice(0, 20).map((t) => t.identifier),
    },
    history,
  };
}

export function routingRoutes(app: Hono, repo: Repo) {
  app.get("/api/routing", (c) => c.json(routingView(repo)));
  app.put("/api/routing", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("Invalid routing body");
    const current = parseOverrides(repo.getSetting("routing_overrides"));
    const next: RoutingOverrides = parseOverrides(
      JSON.stringify({ ...current, ...body }),
    );
    const ids = knownIds(repo);
    const unknown = [
      ...next.paused,
      ...(next.allowed ?? []),
      ...Object.keys(next.reserve_remaining),
    ].filter((id) => !ids.includes(id));
    if (unknown.length) throw new Error(`Unknown provider: ${unknown[0]}`);
    if (next.allowed && next.allowed.length === 0)
      throw new Error("allowed must keep at least one backend");
    repo.setSetting("routing_overrides", JSON.stringify(next));
    repo.event(
      "routing",
      `Routing overrides updated: paused=[${next.paused}] allowed=${next.allowed ? `[${next.allowed}]` : "all"}`,
    );
    return c.json(routingView(repo));
  });
}
