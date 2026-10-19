import { it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Repo } from "../src/db/index.js";
import { dispatch } from "../src/core/dispatch.js";
import { detectIdentity, scriptIdentity } from "../src/workers/identity.js";
import { fixture } from "./helpers.js";

let f: ReturnType<typeof fixture>;
afterEach(() => f?.cleanup());

it("detects codex, opencode and header-declared claude identities", () => {
  expect(detectIdentity("codex", { modelArgs: ["-m", "gpt-x"] }, "")).toMatchObject({
    kind: "codex",
    label: "Codex (gpt-x)",
  });
  expect(detectIdentity("opencode", { model: "gemma4:e4b" }, "")).toMatchObject({
    kind: "opencode",
    label: "opencode (gemma4:e4b)",
  });
  f = fixture();
  const s = resolve(f.root, "cw.sh");
  writeFileSync(s, "#!/bin/sh\n# aam-worker: claude sonnet\nexit 0\n");
  expect(scriptIdentity(s)).toEqual({
    kind: "claude",
    model: "sonnet",
    label: "Claude (sonnet)",
  });
  expect(detectIdentity("codex", {}, s).kind).toBe("claude");
});

it("shows the basename for scripts without a header", () => {
  f = fixture();
  const s = resolve(f.root, "custom-thing.sh");
  writeFileSync(s, "#!/bin/sh\nexit 0\n");
  expect(scriptIdentity(s)).toMatchObject({ kind: "fake", label: "custom-thing.sh" });
});

it("records the real executor on the run, backend.json and the dispatch event", () => {
  f = fixture("sleep 5");
  writeFileSync(
    process.env.AAM_FAKE_WORKER!,
    "#!/bin/sh\n# aam-worker: claude sonnet\ncd \"$1\" || exit 1\nsleep 5\n",
  );
  const t = f.task();
  const id = dispatch(f.repo, t.identifier);
  const run = f.repo.runs(t.id)[0];
  expect(run).toMatchObject({
    worker_kind: "claude",
    worker_model: "sonnet",
    worker_label: "Claude (sonnet)",
  });
  const backend = JSON.parse(
    require("node:fs").readFileSync(resolve(f.repo.home, "runs", String(id), "backend.json"), "utf8"),
  );
  expect(backend).toMatchObject({ worker_kind: "claude", worker_label: "Claude (sonnet)" });
  expect(JSON.stringify(f.repo.events(5, t.id))).toContain("Started claude run");
  expect(f.repo.latestWorker(t.id)).toMatchObject({ kind: "claude" });
  process.kill(run.pid!, "SIGKILL");
});

it("backfills identity for runs recorded before the columns existed", () => {
  f = fixture();
  const t = f.task();
  const ins = f.repo.db.prepare(
    "INSERT INTO runs(task_id,worker,status,started_at,log_path,last_message_path) VALUES (?,?,'failed','x','','')",
  );
  const a = Number(ins.run(t.id, "codex").lastInsertRowid);
  const b = Number(ins.run(t.id, "opencode").lastInsertRowid);
  const c = Number(ins.run(t.id, "codex").lastInsertRowid);
  mkdirSync(resolve(f.repo.home, "runs", String(c)), { recursive: true });
  writeFileSync(resolve(f.repo.home, "runs", String(c), "worker.log"), "I am Claude Code");
  const d = Number(ins.run(t.id, "weird").lastInsertRowid);
  mkdirSync(resolve(f.repo.home, "runs", String(d)), { recursive: true });
  writeFileSync(resolve(f.repo.home, "runs", String(d), "worker.log"), "nothing");
  f.repo.db.exec("UPDATE runs SET worker_kind=NULL");
  const again = new Repo(f.repo.home);
  const kind = (id: number) =>
    again.runs().find((r) => r.id === id)!.worker_kind;
  expect([kind(a), kind(b), kind(c), kind(d)]).toEqual([
    "codex",
    "opencode",
    "claude",
    "unknown",
  ]);
});
