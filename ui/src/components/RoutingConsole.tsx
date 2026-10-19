import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ActionError, Load, useAction } from "./PageSupport";

type Quota = {
  window: string;
  state: "fresh" | "stale" | "unknown";
  used: number | "unknown";
  remaining: number | "unknown";
  reset_at: string | null;
  collected_at: string;
  source: string;
};
type Provider = {
  id: string;
  worker: string;
  free_tier: "free" | "local" | "paid" | "unknown";
  quota_known: boolean;
  paused: boolean;
  allowed: boolean;
  reserve_remaining: number;
  reserved: number;
  cooldown_until: string | null;
  quota: Quota[];
};
type Routing = {
  schema_version: number;
  providers: Provider[];
  overrides: { allowed: string[] | null };
  queue: { ready: number; identifiers: string[] };
  history: { id: number; ts: string; kind: string; message: string; identifier: string | null }[];
};

const num = (v: number | "unknown") => (v === "unknown" ? "未知" : String(v));
const tier = { free: "免费", local: "本地", paid: "付费", unknown: "未知" };
const stateText = { fresh: "新鲜", stale: "陈旧", unknown: "未知" };
const kindText: Record<string, string> = {
  route_selected: "选路",
  route_switch: "切换",
  quota_deferred: "额度延后",
  provider_cooldown: "熔断",
  routing: "配置",
};

function describe(kind: string, message: string) {
  try {
    const data = JSON.parse(message);
    if (kind === "route_selected") return `${data.provider}：${data.reason}`;
    if (kind === "route_switch") return `${data.from} → ${data.to}`;
  } catch {
    /* plain message */
  }
  return message;
}

function ReserveEditor({ provider, onSave }: { provider: Provider; onSave: (value: number) => void }) {
  const [value, setValue] = useState(String(provider.reserve_remaining));
  const n = Number(value);
  const invalid = value.trim() === "" || !Number.isFinite(n) || n < 0;
  return (
    <span>
      <Input
        aria-label={`${provider.id} 保留阈值`}
        type="number"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="button" disabled={invalid} onClick={() => onSave(n)}>
        保存阈值
      </Button>
      {invalid && <p role="alert">阈值必须是不小于 0 的数字</p>}
    </span>
  );
}

export function RoutingConsole() {
  const query = useQuery({
    queryKey: ["routing"],
    queryFn: async () => {
      const data = await request<Routing>("/routing");
      if (data.schema_version !== 1 || !Array.isArray(data.providers))
        throw Error("选路数据格式不可识别");
      return data;
    },
    refetchInterval: 30000,
  });
  const action = useAction();
  const put = (body: unknown) => action.mutate({ path: "/routing", method: "PUT", body });
  const data = query.data;
  const allowedIds = data
    ? data.overrides.allowed ?? data.providers.map((p) => p.id)
    : [];
  return (
    <section aria-label="额度与选路控制台">
      <h2>额度与选路控制台</h2>
      <p>免费额度未知时标注“未知”，不代表可用；此处不显示任何凭证。</p>
      <ActionError error={action.error} />
      <Load pending={query.isPending} error={query.error}>
        {data && (
          <>
            <p>本地排队（内存/数据库，等待分派的 ready 任务）：{data.queue.ready} {data.queue.identifiers.join(", ")}</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>提供方</th><th>类型</th><th>额度（新鲜度 / 重置）</th><th>保留阈值</th><th>状态</th><th>操作</th></tr>
                </thead>
                <tbody>
                  {data.providers.map((p) => (
                    <tr key={p.id}>
                      <td>{p.id}<br />{p.worker}</td>
                      <td>{tier[p.free_tier]}{!p.quota_known && "（额度未知）"}</td>
                      <td>
                        {p.quota.length ? p.quota.map((q) => (
                          <p key={q.window}>
                            {q.window}：剩余 {num(q.remaining)}，{stateText[q.state]}，采集 {q.collected_at}，重置 {q.reset_at ?? "未知"}
                          </p>
                        )) : "无额度记录（未知）"}
                      </td>
                      <td><ReserveEditor key={p.reserve_remaining} provider={p} onSave={(v) => put({ reserve_remaining: { [p.id]: v } })} /></td>
                      <td>
                        {p.paused ? "已暂停" : "运行中"}
                        {!p.allowed && "，未允许"}
                        {p.cooldown_until && `，熔断至 ${p.cooldown_until}`}
                      </td>
                      <td>
                        <Button type="button" onClick={() => {
                          const paused = data.providers.filter((x) => x.paused && x.id !== p.id).map((x) => x.id);
                          put({ paused: p.paused ? paused : [...paused, p.id] });
                        }}>{p.paused ? `恢复 ${p.id}` : `暂停 ${p.id}`}</Button>
                        <label>
                          <input
                            type="checkbox"
                            checked={p.allowed}
                            aria-label={`允许 ${p.id}`}
                            onChange={(e) => {
                              const next = e.target.checked ? [...allowedIds, p.id] : allowedIds.filter((id) => id !== p.id);
                              put({ allowed: next.length === data.providers.length ? null : next });
                            }}
                          />
                          允许
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>选路与切换历史</h3>
            {!data.history.length ? <p>暂无记录。</p> : (
              <ul>
                {data.history.map((h) => (
                  <li key={h.id}>{h.ts} [{kindText[h.kind] ?? h.kind}] {h.identifier ?? ""} {describe(h.kind, h.message)}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </Load>
    </section>
  );
}
