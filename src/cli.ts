import { setIntegration, promote } from "./core/integration.js";
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { tail } from "./core/logs.js";
import { Repo } from "./db/index.js";
import { autopilotStatus } from "./core/autopilot.js";
import { review } from "./core/review.js";
import { merge, prune } from "./core/worktree.js";
export const output = (v: unknown) =>
  console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
export function cli(repo: Repo) {
  const app = new Command()
    .name("aam")
    .description("Local AI agent manager")
    .showHelpAfterError();
  app.command("init").action(() => {
    repo.init();
    output(`Initialized ${repo.home}`);
  });
  const project = app.command("project");
  project
    .command("add")
    .requiredOption("--key <key>")
    .requiredOption("--name <name>")
    .requiredOption("--repo <path>")
    .option("--base <branch>", "base branch", "main")
    .option("--test <cmd>")
    .option("--setup <cmd>")
    .action((o) =>
      output(
        repo.addProject({
          key: o.key,
          name: o.name,
          repo_path: o.repo,
          base_branch: o.base,
          test_cmd: o.test,
          setup_cmd: o.setup,
        }),
      ),
    );
  project
    .command("promote <key>")
    .option("--into <branch>")
    .option("--yes")
    .action((key, o) => promote(repo, key, o.yes === true, o.into));
  project.command("list").action(() => output(repo.projects()));
  project
    .command("edit <key>")
    .option("--integration <on|off>")
    .option("--auto-review <on|off>")
    .option("--autopilot <on|off>")
    .option("--goal-file <path>")
    .option("--goal <text>")
    .option("--rank <n>")
    .option("--context-file <path>")
    .action((key, o) => {
      if (o.goalFile !== undefined && o.goal !== undefined)
        throw new Error("Use --goal or --goal-file");
      const patch: Record<string, unknown> = {};
      for (const [arg, col] of [
        ["autoReview", "auto_review"],
        ["autopilot", "autopilot"],
      ])
        if (o[arg!] !== undefined) {
          if (!["on", "off"].includes(o[arg!]))
            throw new Error("Expected on or off");
          patch[col!] = o[arg!] === "on" ? 1 : 0;
        }
      if (o.goalFile !== undefined || o.goal !== undefined)
        patch.goal =
          o.goalFile !== undefined ? readFileSync(o.goalFile, "utf8") : o.goal;
      if (o.rank !== undefined) patch.autopilot_rank = Number(o.rank);
      if (o.contextFile !== undefined) patch.context_file = o.contextFile;
      if (o.integration !== undefined) setIntegration(repo, key, o.integration);
      output(repo.updateProject(key, patch));
    });
  app
    .command("autopilot")
    .command("status")
    .action(() => output(autopilotStatus(repo)));
  const task = app.command("task");
  task
    .command("add")
    .requiredOption("--project <key>")
    .requiredOption("--title <title>")
    .option("--desc <text>")
    .option("--desc-file <path>")
    .option("--priority <priority>", "priority", "P1")
    .option("--role <role>", "role", "any")
    .option("--worker <worker>")
    .option("--depends <ids>")
    .option("--ready")
    .action((o) => {
      if (o.desc !== undefined && o.descFile)
        throw new Error("Use --desc or --desc-file");
      output(
        repo.addTask({
          ...o,
          description: o.descFile
            ? readFileSync(o.descFile, "utf8")
            : o.desc || "",
          depends_on: o.depends ? o.depends.split(",") : [],
          status: o.ready ? "ready" : "backlog",
        }),
      );
    });
  task
    .command("list")
    .option("--status <status>")
    .option("--project <key>")
    .option("--json")
    .action((o) => {
      const tasks = repo.tasks(o);
      output(
        o.json
          ? tasks
          : tasks
              .map(
                (t) => `${t.identifier} [${t.priority}] ${t.status} ${t.title}`,
              )
              .join("\n"),
      );
    });
  task.command("show <id>").action((id) => output(repo.detail(id)));
  task
    .command("move <id> <status>")
    .option("--note <text>")
    .action((id, status, o) => {
      if (repo.runs(repo.task(id).id).some((r) => r.status === "running"))
        throw new Error("Cannot move a task with a running worker");
      output(repo.updateTask(id, { status, feedback: o.note }));
      repo.event("move", status, repo.task(id).id);
    });
  task
    .command("edit <id>")
    .option("--attempts <n>")
    .option("--feedback-file <path>")
    .option("--title <title>")
    .option("--desc <text>")
    .option("--priority <priority>")
    .option("--worker <worker>")
    .option("--depends <ids>")
    .action((id, o) =>
      output(
        repo.updateTask(id, {
          attempts: o.attempts === undefined ? undefined : Number(o.attempts),
          feedback:
            o.feedbackFile === undefined
              ? undefined
              : readFileSync(o.feedbackFile, "utf8"),
          title: o.title,
          description: o.desc,
          priority: o.priority,
          worker: o.worker,
          depends_on: o.depends?.split(","),
        }),
      ),
    );
  const settings = app.command("settings");
  settings
    .command("get [key]")
    .action((k) => output(k ? repo.getSetting(k) : repo.settings()));
  settings.command("set <key> <value>").action((k, v) => {
    repo.setSetting(k, v);
    output(repo.settings());
  });
  app
    .command("logs <id>")
    .option("--run <n>", "run ID")
    .option("--tail <n>", "line count", "100")
    .action((id, o) => {
      const runs = repo.runs(repo.task(id).id);
      const r = o.run ? runs.find((r) => r.id === Number(o.run)) : runs[0];
      if (!r) throw new Error("Run not found");
      output(tail(r.log_path, Number(o.tail)));
    });
  app
    .command("review <id> <verdict>")
    .option("--note <text>", "review notes", "")
    .action((id, v, o) => review(repo, id, v, o.note));
  app
    .command("merge <id>")
    .requiredOption("--into <branch>")
    .action((id, o) => merge(repo, id, o.into));
  app
    .command("worktree")
    .command("prune <id>")
    .action((id) => prune(repo, id));
  return app;
}
async function main() {
  const repo = new Repo();
  try {
    const app = cli(repo);
    await register(app, repo);
    await app.parseAsync();
  } finally {
    repo.close();
  }
}
async function register(app: Command, repo: Repo) {
  const { tick } = await import("./core/tick.js");
  const { dispatch } = await import("./core/dispatch.js");
  const { withLock } = await import("./core/lock.js");
  app
    .command("serve")
    .option("--port <port>", "HTTP port", "3199")
    .action(async (o) => {
      const { startServer } = await import("./server.js");
      await startServer(repo, Number(o.port));
    });
  const { daemon, validateRoutine } = await import("./scheduler.js");
  const { launchd } = await import("./launchd.js");
  app
    .command("daemon")
    .option("--interval <seconds>", "heartbeat interval", "60")
    .action((o) => daemon(repo, Number(o.interval)));
  const routine = app.command("routine");
  routine
    .command("add")
    .requiredOption("--name <name>")
    .requiredOption("--cron <cron>")
    .requiredOption("--action <action>")
    .option("--payload <json>", "JSON payload", "{}")
    .action((o) => {
      const p = JSON.parse(o.payload);
      validateRoutine(o.cron, o.action, p);
      repo.addRoutine(o.name, o.cron, o.action, p);
    });
  routine.command("list").action(() => output(repo.routines()));
  for (const action of ["enable", "disable"])
    routine.command(`${action} <name>`).action((name) => {
      const r = repo.db
        .prepare("UPDATE routines SET enabled=? WHERE name=?")
        .run(action === "enable" ? 1 : 0, name);
      if (!r.changes) throw new Error("Routine not found");
    });
  const launch = app.command("launchd");
  for (const action of ["install", "uninstall", "status"])
    launch
      .command(action)
      .option("--load")
      .action((o) => output(launchd(repo, action, Boolean(o.load))));
  app
    .command("tick")
    .action(() =>
      output(tick(repo) ? "Heartbeat complete" : "Heartbeat already running"),
    );
  app
    .command("run <id>")
    .option("--force")
    .action((id, o) => {
      const run = withLock(repo, () => dispatch(repo, id, Boolean(o.force)));
      if (run === undefined) throw new Error("Heartbeat already running");
      output({ run });
    });
}
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
