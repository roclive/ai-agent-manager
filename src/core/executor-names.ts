// Pure names/validation shared by the DB layer and the executor module (no imports: avoids cycles).
export const EXECUTORS = [
  "codex",
  "claude",
  "opencode",
  "opencode-local",
  "pi",
  "hermes",
] as const;
export type Executor = (typeof EXECUTORS)[number];
export const EXECUTOR_VALUES: string[] = ["auto", ...EXECUTORS];

export function parseFallback(value: string | undefined): Executor[] {
  return (value || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean) as Executor[];
}
export function validFallback(value: string) {
  return parseFallback(value).every((x) =>
    (EXECUTORS as readonly string[]).includes(x),
  );
}
