import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { failover } from "./opencode-failover.mjs";
import {
  loadCodingProviders,
  openCodeConfigContent,
  routedProviders,
} from "./coding-providers.mjs";
import { fallbackProvider, fallbackRunArgs } from "./opencode-fallback.mjs";
const [worktree, promptFile] = process.argv.slice(2);
const routingPath = resolve(dirname(promptFile), "../../opencode-routing.json");
const policy = loadCodingProviders(routingPath);
const requested = process.argv[4] || undefined;
const fallbackModel = process.argv[5] || undefined;
const providers = fallbackModel
  ? [fallbackProvider(requested || "opencode-fallback", fallbackModel)]
  : requested
    ? routedProviders(policy).filter((provider) => provider.id === requested)
    : routedProviders(policy);
if (requested && !providers.length)
  throw new Error(`Provider ${requested} is not in the configured route`);
const prompt = readFileSync(promptFile, "utf8");
const result = await failover(
  providers,
  (provider) =>
    new Promise((resolveRun) => {
      writeFileSync(
        resolve(dirname(promptFile), "coding-backend.json"),
        JSON.stringify({
          provider: provider.id,
          kind: provider.kind,
          model: provider.model || "configured default",
          ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
          at: new Date().toISOString(),
        }),
      );
      const args = fallbackModel
        ? fallbackRunArgs(worktree, fallbackModel, prompt)
        : [
            "run",
            "--pure",
            "--format",
            "json",
            "--dir",
            worktree,
            ...(provider.model ? ["--model", provider.model] : []),
            ...(policy.agent ? ["--agent", policy.agent] : []),
            ...(policy.auto ? ["--auto"] : []),
            prompt,
          ];
      const configContent = openCodeConfigContent(
        policy,
        provider,
        process.env.OPENCODE_CONFIG_CONTENT,
      );
      const child = spawn("opencode", args, {
        env: {
          ...process.env,
          ...(configContent !== undefined
            ? { OPENCODE_CONFIG_CONTENT: configContent }
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
      JSON.stringify({
        type: "aam_backend_switch",
        from: from.id,
        to: to.id,
      }) + "\n",
    ),
);
process.exit(result.status);
