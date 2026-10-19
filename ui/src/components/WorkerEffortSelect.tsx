import { useExecutors } from "../lib/queries";
import { NativeSelect } from "./ui/select";

const labels: Record<string, string> = {
  default: "默认（使用 CLI/模型默认值）",
  low: "low",
  medium: "medium",
  high: "high",
};

export function WorkerEffortSelect({
  value,
  onChange,
  name,
  executor,
}: {
  value: string;
  onChange?: (value: string) => void;
  name?: string;
  executor?: string;
}) {
  const q = useExecutors();
  const selected = executor ?? q.data?.coding_executor ?? "auto";
  const meta = q.data?.executors?.find((item) => item.id === selected);
  const unavailable = selected !== "auto" && meta?.effort_supported !== true;
  const help = unavailable
    ? `${meta?.label ?? selected} 不支持思考强度；运行时不会传递参数。`
    : selected === "auto"
      ? "仅在实际路由到 Claude 或 Codex 时应用。"
      : "独立于审查模型的思考强度。";
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <NativeSelect
        aria-label="工作执行器思考强度"
        name={name}
        disabled={unavailable}
        title={help}
        {...(onChange
          ? { value, onChange: (event) => onChange(event.target.value) }
          : { defaultValue: value })}
      >
        {(q.data?.effort_choices ?? ["default", "low", "medium", "high"]).map(
          (effort) => <option key={effort} value={effort}>{labels[effort] ?? effort}</option>,
        )}
      </NativeSelect>
      <small title={help}>{unavailable ? "不可用" : help}</small>
    </span>
  );
}
