import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { Repo } from "../src/db/index.js";
import { git, killGroup } from "../src/core/process.js";
export function fixture(script = "printf changed > changed.txt\nexit 0") {
  const root = mkdtempSync(resolve(tmpdir(), "aam-test-"));
  const path = resolve(root, "project");
  mkdirSync(path);
  git(path, ["init", "-b", "main"]);
  git(path, ["config", "user.name", "Test"]);
  git(path, ["config", "user.email", "test@local"]);
  writeFileSync(resolve(path, "initial.txt"), "initial");
  git(path, ["add", "."]);
  git(path, ["commit", "-m", "initial"]);
  const repo = new Repo(resolve(root, ".aam"));
  repo.addProject({ key: "T", name: "Test", repo_path: path });
  const fake = resolve(root, "fake.sh");
  writeFileSync(fake, `#!/bin/sh\ncd "$1" || exit 1\n${script}\n`, {
    mode: 0o755,
  });
  process.env.AAM_FAKE_WORKER = fake;
  const fakeClaude = resolve(root, "claude.sh");
  writeFileSync(
    fakeClaude,
    `#!/bin/sh\ncat >/dev/null\nprintf '{"result":"ok","is_error":false}'\n`,
    { mode: 0o755 },
  );
  process.env.AAM_FAKE_CLAUDE = fakeClaude;
  return {
    root,
    path,
    repo,
    fake,
    task: (extra: Record<string, unknown> = {}) =>
      repo.addTask({
        project: "T",
        title: "Example",
        status: "ready",
        ...extra,
      }),
    cleanup: () => {
      if (!repo.db.open) return;
      for (const r of repo.runs()) if (r.status === "running") killGroup(r.pid);
      repo.close();
      rmSync(root, { recursive: true, force: true });
      delete process.env.AAM_FAKE_WORKER;
      delete process.env.AAM_FAKE_CLAUDE;
    },
  };
}
export async function waitExit(repo: Repo, id: number) {
  const run = repo.runs().find((r) => r.id === id)!;
  const file = resolve(dirname(run.log_path), "exit_code");
  for (let i = 0; i < 200; i++) {
    if (existsSync(file)) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Fake worker did not finish");
}
