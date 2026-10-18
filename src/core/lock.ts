import {
  openSync,
  readFileSync,
  writeFileSync,
  closeSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import { Repo } from "../db/index.js";
import { alive } from "./process.js";
export function withLock<T>(
  repo: Repo,
  fn: () => T,
  name = "tick",
): T | undefined {
  const path = resolve(repo.home, `${name}.lock`);
  // Serialize acquisition (including stale-file replacement) across manager processes.
  // The transaction ends before the heartbeat; the file guards the actual work.
  const acquired = repo.db
    .transaction(() => {
      try {
        const raw = readFileSync(path, "utf8");
        const pid = Number(raw);
        if (Number.isInteger(pid) && pid > 0) {
          if (alive(pid)) return false;
        } else if (Date.now() - statSync(path).mtimeMs < 30000) return false;
        unlinkSync(path);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      let fd: number;
      try {
        fd = openSync(path, "wx");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw e;
      }
      try {
        writeFileSync(fd, String(process.pid));
      } finally {
        closeSync(fd);
      }
      return true;
    })
    .immediate();
  if (!acquired) return;
  try {
    return fn();
  } finally {
    repo.db
      .transaction(() => {
        try {
          if (readFileSync(path, "utf8") === String(process.pid))
            unlinkSync(path);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
      })
      .immediate();
  }
}
