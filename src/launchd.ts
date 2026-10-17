import {
  realpathSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Repo } from "./db/index.js";
import { runner, type Runner } from "./core/process.js";
const xml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
export function nodePath(exists = existsSync) {
  return exists("/opt/homebrew/bin/node")
    ? "/opt/homebrew/bin/node"
    : process.execPath;
}
export function daemonLogPath() {
  return resolve(homedir(), "Library/Logs/aam/daemon.log");
}
export function plist(repo: Repo) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const args = [
    nodePath(),
    "--import",
    resolve(root, "node_modules/tsx/dist/loader.mjs"),
    resolve(root, "src/cli.ts"),
    "daemon",
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.aam.daemon</string>
<key>ProgramArguments</key><array>${args.map((a) => `<string>${xml(a)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${xml(homedir())}</string>
<key>EnvironmentVariables</key><dict><key>AAM_HOME</key><string>${xml(repo.home)}</string><key>PATH</key><string>${xml(`/opt/homebrew/bin:${homedir()}/.local/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}`)}</string></dict>
<key>KeepAlive</key><true/><key>RunAtLoad</key><true/>
<key>StandardOutPath</key><string>${xml(daemonLogPath())}</string>
<key>StandardErrorPath</key><string>${xml(daemonLogPath())}</string>
</dict></plist>\n`;
}
export function launchd(
  repo: Repo,
  action: string,
  load = false,
  run: Runner = runner,
) {
  const path = resolve(homedir(), "Library/LaunchAgents/com.aam.daemon.plist");
  if (action === "install") {
    const body = plist(repo);
    mkdirSync(dirname(daemonLogPath()), { recursive: true });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    if (load) {
      const r = run("launchctl", ["load", path], process.cwd());
      if (r.status !== 0) throw new Error(r.stderr);
    }
    return body;
  }
  if (action === "uninstall") {
    if (existsSync(path)) {
      const r = run("launchctl", ["unload", path], process.cwd());
      if (
        r.status !== 0 &&
        process.platform === "darwin" &&
        run("launchctl", ["list", "com.aam.daemon"], process.cwd()).status === 0
      )
        throw new Error(r.stderr);
      unlinkSync(path);
    }
    return "Uninstalled";
  }
  if (action === "status") {
    const result = run("launchctl", ["list", "com.aam.daemon"], process.cwd());
    const detail = run(
      "launchctl",
      ["print", `gui/${process.getuid?.() ?? 0}/com.aam.daemon`],
      process.cwd(),
    );
    const match = detail.stdout.match(/last exit code\s*=\s*(-?\d+)/);
    const lastExitCode = match ? Number(match[1]) : null;
    const protectedPaths = ["Desktop", "Documents", "Downloads"].map((name) =>
      resolve(homedir(), name),
    );
    const protectedRepo = [
      process.cwd(),
      repo.home,
      ...repo.projects().map((p) => p.repo_path),
    ].some((path) =>
      protectedPaths.some(
        (root) => path === root || path.startsWith(root + "/"),
      ),
    );
    return {
      lastExitCode,
      logPath: daemonLogPath(),
      ...(lastExitCode === 78 && protectedRepo
        ? {
            hint: `macOS privacy protection can block launchd access to Desktop, Documents or Downloads. Grant Full Disk Access to the node binary (${realpathSync(nodePath())}) or move the repos. The plist already keeps its cwd and logs outside protected folders.`,
          }
        : {}),
      installed: existsSync(path),
      loaded: result.status === 0,
      path,
      plist: existsSync(path) ? readFileSync(path, "utf8") : null,
    };
  }
  throw new Error("Unknown launchd action");
}
