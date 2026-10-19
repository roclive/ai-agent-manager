import { vi } from "vitest";
// Catch accidental calls even when a test forgets AAM_FAKE_WORKER or an injected runner.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const guard = (cmd: unknown, args: unknown) => {
    if (
      ["codex", "opencode", "claude", "ollama", "vm_stat"].includes(
        String(cmd),
      ) ||
      (Array.isArray(args) &&
        args.some(
          (a) =>
            ["codex", "opencode", "claude", "ollama", "vm_stat"].includes(
              String(a),
            ) || String(a).endsWith("opencode-launcher.mjs"),
        ))
    )
      throw new Error("Real AI CLI invocation forbidden in tests");
  };
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      guard(args[0], args[1]);
      return actual.spawn(...args);
    },
    spawnSync: (...args: Parameters<typeof actual.spawnSync>) => {
      guard(args[0], args[1]);
      return actual.spawnSync(...args);
    },
  };
});
