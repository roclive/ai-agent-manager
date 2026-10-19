import type { Hono } from "hono";
import type { Repo } from "../db/index.js";
import { runner } from "../core/process.js";

export function managerRoutes(app: Hono, repo: Repo) {
  app.get("/api/manager", (c) => {
    const decision = repo.db.prepare("SELECT ts,message FROM events WHERE kind='manager_decision' ORDER BY id DESC LIMIT 1").get() as { ts: string; message: string } | undefined;
    return c.json({ backend: repo.getSetting("manager_backend"), model: repo.getSetting("manager_local_model"), base_url: repo.getSetting("manager_local_base_url"), fallback_to_rules: repo.getSetting("manager_fallback_to_rules") !== "0", daily_cap: repo.getSetting("manager_daily_max"), calls_today: repo.getSetting("manager_call_day") === new Date().toISOString().slice(0, 10) ? repo.getSetting("manager_call_count") : "0", last_decision: decision ?? null });
  });
  app.put("/api/manager", async (c) => {
    const p = await c.req.json<Record<string, unknown>>();
    const allowed = ["manager_backend", "manager_local_model", "manager_local_base_url", "manager_fallback_to_rules", "manager_daily_max"];
    if (!Object.keys(p).length || Object.keys(p).some((k) => !allowed.includes(k))) throw new Error("Unsupported manager setting");
    repo.db.transaction(() => { for (const [key, value] of Object.entries(p)) repo.setSetting(key, String(value)); })();
    repo.event("settings", `Updated manager settings: ${Object.keys(p).join(", ")}`);
    return c.json({ backend: repo.getSetting("manager_backend"), model: repo.getSetting("manager_local_model"), base_url: repo.getSetting("manager_local_base_url"), fallback_to_rules: repo.getSetting("manager_fallback_to_rules") !== "0", daily_cap: repo.getSetting("manager_daily_max") });
  });
  app.post("/api/manager/test-connection", async (c) => {
    const p = await c.req.json<Record<string, unknown>>();
    const base = String(p.base_url ?? repo.getSetting("manager_local_base_url")).replace(/\/+$/, "");
    const model = String(p.model ?? repo.getSetting("manager_local_model"));
    const url = new URL(base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || /[\r\n]/.test(model)) throw new Error("Invalid local model endpoint");
    const result = runner("curl", ["--silent", "--show-error", "--fail", "--max-time", "5", "-H", "content-type: application/json", "--data-binary", "@-", `${base}/chat/completions`], repo.home, JSON.stringify({ model, temperature: 0, stream: false, messages: [{ role: "user", content: "Reply with OK" }] }), 6000);
    const ok = result.status === 0;
    return c.json({ ok, message: ok ? "Connected" : (result.stderr || `Connection failed (exit ${result.status})`).slice(0, 300) });
  });
  app.post("/api/manager/switch-to-rules", (c) => {
    repo.setSetting("manager_backend", "rules");
    repo.event("manager_decision", "Switched to rules backend by user");
    return c.json({ backend: "rules" });
  });
}
