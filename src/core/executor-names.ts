// Pure names/validation shared by the DB layer and the executor module (no imports: avoids cycles).
// Model variants are distinct stable ids; AAM's persisted selector (not any desktop-app UI) picks the CLI model.
export const EXECUTORS = [
  "codex-sol",
  "codex-luna",
  "claude",
  "claude-opus",
  "opencode",
  "opencode-local",
  "pi",
  "hermes",
] as const;
export type Executor = (typeof EXECUTORS)[number];
// Ids persisted before model variants existed keep working: they resolve to the variant they always ran.
export const LEGACY_EXECUTORS: Record<string, Executor> = { codex: "codex-sol" };
export const EXECUTOR_VALUES: string[] = [
  "auto",
  ...EXECUTORS,
  ...Object.keys(LEGACY_EXECUTORS),
];

export function normalizeExecutor<T extends string>(value: T): T | Executor {
  return LEGACY_EXECUTORS[value] ?? value;
}

export function parseFallback(value: string | undefined): Executor[] {
  return (value || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => normalizeExecutor(x)) as Executor[];
}
export function validFallback(value: string) {
  return parseFallback(value).every((x) =>
    (EXECUTORS as readonly string[]).includes(x),
  );
}
