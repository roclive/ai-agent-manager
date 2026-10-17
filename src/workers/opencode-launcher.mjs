import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const r = spawnSync(
  "opencode",
  [
    "run",
    "--format",
    "json",
    "--dir",
    process.argv[2],
    readFileSync(process.argv[3], "utf8"),
  ],
  { stdio: "inherit" },
);
if (r.error) console.error(r.error.message);
process.exit(r.status ?? 1);
