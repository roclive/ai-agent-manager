import { it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { writeFileSync, existsSync } from "node:fs";
import { fixture } from "./helpers.js";
let f: ReturnType<typeof fixture>;
afterEach(() => f?.cleanup());
it("does not launch a startup health probe or renew cooldown during backoff", async () => {
  f=fixture();
  const until=new Date(Date.now()+60000).toISOString();f.repo.setSetting("cooldown_until",until);
  const marker=resolve(f.root,"health-started");
  const quoted="'"+marker.replaceAll("'", "'\\''")+"'";
  writeFileSync(process.env.AAM_FAKE_CLAUDE!,`#!/bin/sh\ncat >/dev/null\nprintf hit > ${quoted}\nprintf '{"result":"ok","is_error":false}'\n`,{mode:0o755});
  const child=spawn(resolve("bin/aam"),["daemon","--interval","0.05"],{cwd:f.root,env:{...process.env,AAM_HOME:f.repo.home},stdio:"ignore"});
  try {
    // Starting tsx can take more than two seconds while the full suite is spawning
    // other CLI processes. Wait for the observable heartbeat, but fail promptly if
    // the daemon itself exits instead of obscuring that failure as a timing issue.
    let exited: number | null | undefined;
    child.once("exit", (code) => { exited = code; });
    const deadline = Date.now() + 10_000;
    while (!f.repo.getSetting("last_tick_at") && exited === undefined && Date.now() < deadline)
      await new Promise(r=>setTimeout(r,20));
    expect(exited, "daemon exited before its first heartbeat").toBeUndefined();
    expect(f.repo.getSetting("last_tick_at")).toBeTruthy();
    const ended=new Promise<number|null>(r=>child.once("exit",r));child.kill("SIGTERM");expect(await ended).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(f.repo.getSetting("cooldown_until")).toBe(until);
    expect(f.repo.getSetting("reviewer_checked_at")).toBe("");
  } finally {child.kill("SIGKILL");}
});
