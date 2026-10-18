import { useQuery } from "@tanstack/react-query";
import { request } from "../lib/api";
import { Load } from "./PageSupport";
type Snapshot = {
  id: number; provider: string; type: "quota" | "cost"; window: string;
  used: number | "unknown"; remaining: number | "unknown"; source: string;
  freshness: string; reset_at: string | null; state: "fresh" | "stale" | "unknown";
  warning: string | null;
};
const amount = (value: number | "unknown") => value === "unknown" ? "未知" : String(value);
export function UsageSnapshots() {
  const query = useQuery({queryKey: ["usage"], queryFn: async () => {
    const data = await request<{schema_version: number; snapshots: Snapshot[]}>("/usage");
    if (data.schema_version !== 1 || !Array.isArray(data.snapshots)) throw Error("额度快照格式不可识别，额度未知");
    return data;
  }, refetchInterval: 30000});
  return <section aria-label="额度快照">
    <h2>额度与费用快照</h2>
    <p>未知或陈旧数据不能证明有可用免费额度；费用记录不代表剩余额度。</p>
    <Load pending={query.isPending} error={query.error}>
      {!query.data?.snapshots?.length ? <p>尚无快照，额度未知。</p> : <div className="table-wrap"><table>
        <thead><tr><th>提供方 / 窗口</th><th>类型</th><th>已用 / 剩余</th><th>状态</th><th>来源与采集时间</th><th>重置时间</th></tr></thead>
        <tbody>{query.data.snapshots.map(row => <tr key={row.id}>
          <td>{row.provider} / {row.window}</td><td>{row.type === "cost" ? "费用" : "额度"}</td>
          <td>{amount(row.used)} / {row.type === "cost" ? "不适用" : amount(row.remaining)}</td>
          <td>{({fresh: "新鲜", stale: "陈旧", unknown: "未知"})[row.state]}{row.warning && <p>{row.warning}</p>}</td>
          <td>{row.source}<br />{row.freshness}</td><td>{row.reset_at ?? "未知"}</td>
        </tr>)}</tbody>
      </table></div>}
    </Load>
  </section>;
}
