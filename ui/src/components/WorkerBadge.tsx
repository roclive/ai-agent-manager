export type WorkerKind =
  | "codex"
  | "claude"
  | "opencode"
  | "pi"
  | "hermes"
  | "fake"
  | "other"
  | "unknown";
export interface WorkerInfo {
  kind?: string | null;
  label?: string | null;
}
const kindText: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "opencode",
  pi: "pi",
  hermes: "Hermes",
  fake: "local",
  other: "local",
  unknown: "未知",
};
const kindColor: Record<string, string> = {
  claude: "28 85% 45%",
  codex: "160 70% 33%",
  opencode: "215 75% 48%",
  pi: "190 70% 36%",
  hermes: "330 60% 45%",
  fake: "270 45% 48%",
  other: "270 45% 48%",
  unknown: "220 8% 45%",
};
// Small colored badge naming the executor that really ran the work.
export function WorkerBadge({
  kind,
  label,
}: WorkerInfo) {
  const k = kind && kindText[kind] ? kind : "unknown";
  const hsl = kindColor[k];
  return (
    <span
      className="worker-badge"
      data-kind={k}
      title={label ?? kindText[k]}
      style={{
        color: `hsl(${hsl})`,
        backgroundColor: `hsl(${hsl} / .12)`,
        borderRadius: 4,
        padding: "0 6px",
        fontSize: 11,
        whiteSpace: "nowrap",
      }}
    >
      {label || kindText[k]}
    </span>
  );
}
