import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { Repo } from "../db/index.js";
import { alive } from "./process.js";
export function keepAwake(
  repo: Repo,
  deps = { exists: existsSync, spawn, alive },
) {
  let owned: ReturnType<typeof spawn> | undefined;
  const check = () => {
    if (repo.getSetting("keep_awake") !== "1") {
      stop();
      return;
    }
    if (owned?.pid && deps.alive(owned.pid)) return;
    if (!deps.exists("/usr/bin/caffeinate")) return;
    owned = deps.spawn(
      "/usr/bin/caffeinate",
      ["-i", "-m", "-w", String(process.pid)],
      {
        stdio: "ignore",
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
      },
    );
    owned.on("error", () => {
      repo.setSetting("keep_awake_pid", "");
    });
    repo.setSetting("keep_awake_pid", String(owned.pid || ""));
  };
  const stop = () => {
    owned?.kill();
    owned = undefined;
    repo.setSetting("keep_awake_pid", "");
  };
  return { check, stop };
}
