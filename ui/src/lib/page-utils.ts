export const cronPresets = {
  "*/5 * * * *": "每5分钟",
  "0 * * * *": "每小时",
  "0 7 * * *": "每天 07:00",
  "0 9 * * 1": "每周一 09:00",
};
export const cronDescription = (cron: string) =>
  cronPresets[cron as keyof typeof cronPresets] ?? `自定义：${cron}`;
export function routinePayload(action: string, fields: Record<string, string>) {
  if (action === "heartbeat") return {};
  if (action === "shell") return { cmd: fields.cmd, cwd: fields.cwd };
  return Object.fromEntries(
    ["project", "title", "description", "priority", "role", "worker"].map(
      (k) => [k, fields[k] ?? ""],
    ),
  );
}
export const remainingSeconds = (
  until: string | null | undefined,
  now = Date.now(),
) => Math.max(0, Math.ceil((Date.parse(until ?? "") - now) / 1000)) || 0;
export const deps = (value: string | string[]) =>
  typeof value === "string" ? (JSON.parse(value) as string[]) : value;
