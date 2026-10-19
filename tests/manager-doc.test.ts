import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const doc = readFileSync(resolve(root, "docs/MANAGER.md"), "utf8");
const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(resolve(d, e.name)) : [resolve(d, e.name)],
  );

describe("docs/MANAGER.md audit", () => {
  it("states the live coding_executor=claude dispatch path", () => {
    expect(doc).toMatch(/\| `coding_executor` \| `claude`/);
    expect(doc).toMatch(/Live answer: Claude/);
    expect(doc).toMatch(/`default_worker` is therefore effectively dormant/);
    for (const k of ["executor_fallback", "routing_overrides", "provider_policy"])
      expect(doc).toMatch(new RegExp(`\\| \`${k}\` \\| unset`));
  });
  it("cites the real scheduler path", () => {
    expect(existsSync(resolve(root, "src/scheduler.ts"))).toBe(true);
    expect(existsSync(resolve(root, "src/core/scheduler.ts"))).toBe(false);
    expect(doc).toContain("src/scheduler.ts");
  });
  it("review_mode is only referenced in db defaults/validation", () => {
    const hits = walk(resolve(root, "src"))
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => readFileSync(f, "utf8").includes("review_mode"))
      .map((f) => f.slice(root.length + 1));
    expect(hits).toEqual(["src/db/index.ts"]);
  });
  it("documents the extracted manager routing policy", () => {
    const dispatch = readFileSync(resolve(root, "src/core/dispatch.ts"), "utf8");
    const backend = readFileSync(resolve(root, "src/core/manager-backend.ts"), "utf8");
    expect(dispatch).toContain("backend.decide([t], { repo })");
    expect(backend).toContain("selectExecutor(repo, effective)");
    expect(doc).toContain("manager_backend");
    expect(doc).toContain("src/core/manager-backend.ts");
  });
});
