#!/usr/bin/env node
// Read-only health smoke against an independent GW (OpenAI-compatible) process.
// Only issues GET /models (+ optional GET /health); never sends a completion,
// so no model/cloud quota is consumed. The key (AAM_GW_API_KEY) is never printed.
// Usage: AAM_GW_BASE_URL=http://127.0.0.1:4000/v1 node scripts/gw-health-smoke.mjs
const base = (process.env.AAM_GW_BASE_URL || "http://127.0.0.1:4000/v1").replace(/\/+$/, "");
const headers = process.env.AAM_GW_API_KEY ? { authorization: `Bearer ${process.env.AAM_GW_API_KEY}` } : {};
async function get(path) {
  const r = await fetch(base + path, { headers, signal: AbortSignal.timeout(5000) });
  return { status: r.status, body: await r.text() };
}
try {
  const m = await get("/models");
  let ids = [];
  try { ids = (JSON.parse(m.body).data || []).map((x) => x.id); } catch { /* not JSON */ }
  console.log(JSON.stringify({ base, status: m.status, models: ids, note: "model identity is what the gateway advertises; limits/quota: unknown" }, null, 2));
  process.exit(m.status === 200 && ids.length ? 0 : 1);
} catch (e) {
  console.log(JSON.stringify({ base, error: String(e.cause?.code || e.message) }));
  process.exit(2);
}
