import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { failover } from "./opencode-failover.mjs";
import { loadCodingProviders, routedModels } from "./coding-providers.mjs";
const [worktree, promptFile] = process.argv.slice(2);
const routingPath = resolve(dirname(promptFile), "../../opencode-routing.json");
const policy = loadCodingProviders(routingPath);
const models = routedModels(policy);
const prompt = readFileSync(promptFile, "utf8");
const result = await failover(
  models,
  (model) =>
    new Promise((resolveRun) => {
      writeFileSync(
        resolve(dirname(promptFile), "coding-backend.json"),
        JSON.stringify({
          model: model || "configured default",
          at: new Date().toISOString(),
        }),
      );
      const args = [
        "run",
        "--pure",
        "--format",
        "json",
        "--dir",
        worktree,
        ...(model ? ["--model", model] : []),
        ...(policy.agent ? ["--agent", policy.agent] : []),
        ...(policy.auto ? ["--auto"] : []),
        prompt,
      ];
      const child = spawn("opencode", args, {
        env: {
          ...process.env,
          ...(policy.config
            ? { OPENCODE_CONFIG_CONTENT: JSON.stringify(policy.config) }
            : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "",
        pending = "",
        errorEvent = false,
        finished = false;
      child.stdout.on("data", (bytes) => {
        process.stdout.write(bytes);
        output = (output + bytes.toString()).slice(-100000);
        pending += bytes.toString();
        const lines = pending.split("\n");
        pending = lines.pop() || "";
        for (const line of lines) {
          try {
            const e = JSON.parse(line);
            if (e.type === "error") errorEvent = true;
            if (e.type === "step_finish" && e.part?.reason === "stop")
              finished = true;
          } catch {}
        }
      });
      child.stderr.on("data", (bytes) => {
        process.stderr.write(bytes);
        output = (output + bytes.toString()).slice(-100000);
      });
      child.on("error", (e) => {
        output += e.message;
      });
      child.on("close", (code) =>
        resolveRun({
          status: code === 0 && (!errorEvent || finished) ? 0 : code || 1,
          output,
        }),
      );
    }),
  (from, to) =>
    process.stdout.write(
      JSON.stringify({ type: "aam_backend_switch", from, to }) + "\n",
    ),
);
process.exit(result.status);
