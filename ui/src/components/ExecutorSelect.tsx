import { useExecutors } from "../lib/queries";
import { NativeSelect } from "./ui/select";
import type { EffectiveExecutor, ExecutorInfo } from "../lib/types";
import { WorkerEffortSelect } from "./WorkerEffortSelect";

export const sourceText = { task: "任务", project: "项目", global: "全局" };

// Dropdown of coding executors. Executors that are not installed stay visible but disabled,
// with the install hint in the option text; aam never installs them.
export function ExecutorOptions({
  executors,
  inheritLabel,
}: {
  executors: ExecutorInfo[];
  inheritLabel?: string;
}) {
  return (
    <>
      {inheritLabel !== undefined && <option value="">{inheritLabel}</option>}
      <option value="auto">auto（按配额自动路由）</option>
      {executors.map((e) => {
        const cooling =
          e.cooldown_until && Date.parse(e.cooldown_until) > Date.now();
        return (
          <option
            key={e.id}
            value={e.id}
            disabled={!e.installed}
            title={e.installed ? undefined : e.install_hint}
          >
            {e.label}
            {!e.installed
              ? ` — 未安装 (not installed; ${e.install_hint})`
              : cooling
                ? " — 冷却中"
                : ""}
          </option>
        );
      })}
    </>
  );
}

export function ExecutorSelect({
  value,
  onChange,
  name,
  label,
  inheritLabel,
}: {
  value: string;
  onChange?: (value: string) => void;
  name?: string;
  label: string;
  inheritLabel?: string;
}) {
  const q = useExecutors();
  return (
    <NativeSelect
      aria-label={label}
      name={name}
      {...(onChange
        ? { value, onChange: (e) => onChange(e.target.value) }
        : { defaultValue: value })}
    >
      <ExecutorOptions executors={q.data?.executors ?? []} inheritLabel={inheritLabel} />
    </NativeSelect>
  );
}

// Filter dropdown: options come from the executors API, so new executors appear automatically.
export function ExecutorFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const q = useExecutors();
  const executors = q.data?.executors ?? [];
  return (
    <NativeSelect
      aria-label="筛选执行器"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">全部执行器</option>
      <option value="auto">auto</option>
      {executors.map((e) => (
        <option key={e.id} value={e.id}>
          {e.label}
        </option>
      ))}
      {value && value !== "auto" && !executors.some((e) => e.id === value) && (
        <option value={value}>{value}</option>
      )}
    </NativeSelect>
  );
}

export function ExecutorBadge({ effective }: { effective?: EffectiveExecutor }) {
  if (!effective) return null;
  return (
    <span
      className="executor-badge"
      data-source={effective.source}
      title={`执行器 ${effective.value}（来源：${sourceText[effective.source]}）`}
      style={{ fontSize: 11, borderRadius: 4, padding: "0 6px", border: "1px solid currentColor", whiteSpace: "nowrap" }}
    >
      {effective.value} · {sourceText[effective.source]}
    </span>
  );
}

// Board header: global executor switch + per-executor cooldown state.
export function GlobalExecutorSwitch({
  onChange,
  onEffortChange,
}: {
  onChange: (value: string) => void;
  onEffortChange: (value: string) => void;
}) {
  const q = useExecutors();
  if (!q.data) return null;
  const cooling = (q.data.executors ?? []).filter(
    (e) => e.cooldown_until && Date.parse(e.cooldown_until) > Date.now(),
  );
  return (
    <div className="executor-switch" style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span>编码执行器</span>
      <ExecutorSelect
        label="全局编码执行器"
        value={q.data.coding_executor}
        onChange={onChange}
      />
      <span>思考强度</span>
      <WorkerEffortSelect
        executor={q.data.coding_executor}
        value={q.data.worker_effort}
        onChange={onEffortChange}
      />
      {cooling.map((e) => (
        <span key={e.id} role="status" title={`冷却至 ${e.cooldown_until}`}>
          {e.label} 冷却中
        </span>
      ))}
    </div>
  );
}
