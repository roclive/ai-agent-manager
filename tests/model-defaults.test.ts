import { afterEach, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { Repo } from "../src/db/index.js";
import { executorsView } from "../src/core/executors.js";
import { reviewersView } from "../src/core/reviewers.js";
import { primaryCodexArgs } from "../src/core/llm.js";
let f: ReturnType<typeof fixture>;
afterEach(() => f?.cleanup());
it("keeps Sol worker, reviewer and CLI defaults on the requested model", () => {
  f = fixture();
  expect(f.repo.getSetting("primary_model")).toBe("gpt-6.1-sol");
  expect(executorsView(f.repo).executors.find(e => e.id === "codex-sol")?.model).toBe("gpt-6.1-sol");
  expect(reviewersView(f.repo).reviewers.find(e => e.id === "codex-sol")?.model).toBe("gpt-6.1-sol");
  const args = primaryCodexArgs(f.repo);
  expect(args[args.indexOf("--model") + 1]).toBe("gpt-6.1-sol");
});
it("upgrades the legacy built-in Sol default but preserves other explicit models", () => {
  f = fixture();
  const home = f.repo.home;
  f.repo.db.prepare("UPDATE settings SET value=? WHERE key='primary_model'").run("gpt-5.6-sol");
  const upgraded = new Repo(home);
  expect(upgraded.getSetting("primary_model")).toBe("gpt-6.1-sol");
  upgraded.db.prepare("UPDATE settings SET value=? WHERE key='primary_model'").run("gpt-5.6-luna");
  upgraded.close();
  const custom = new Repo(home);
  expect(custom.getSetting("primary_model")).toBe("gpt-5.6-luna");
  custom.close();
});
