import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
export const statuses = [
  "backlog",
  "ready",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
] as const;
export const priorities = ["P0", "P1", "P2", "P3"] as const;
export interface Project {
  id: number;
  key: string;
  name: string;
  repo_path: string;
  base_branch: string;
  integration_branch: string;
  test_cmd: string | null;
  setup_cmd: string | null;
  auto_review: number;
  autopilot: number;
  goal: string;
  autopilot_rank: number;
  context_file: string | null;
  created_at: string;
}
export interface Task {
  id: number;
  project_id: number;
  identifier: string;
  seq: number;
  sort_order: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  role: string;
  worker: string;
  depends_on: string;
  attempts: number;
  integrated: number;
  resolves_task_id: number | null;
  lost_count: number;
  max_attempts: number;
  branch: string | null;
  worktree_path: string | null;
  feedback: string;
  blocker: string;
  created_at: string;
  updated_at: string;
}
export interface Run {
  id: number;
  task_id: number;
  worker: string;
  pid: number | null;
  status: string;
  start_sha: string | null;
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
  test_exit_code: number | null;
  log_path: string;
  last_message_path: string;
  summary: string | null;
}
export interface Routine {
  id: number;
  name: string;
  cron: string;
  action: string;
  payload: string;
  enabled: number;
  last_run_at: string | null;
}
export class Repo {
  db: Database.Database;
  home: string;
  constructor(home = process.env.AAM_HOME || resolve(".aam")) {
    this.home = resolve(home);
    mkdirSync(this.home, { recursive: true });
    this.db = new Database(resolve(this.home, "aam.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY,key TEXT UNIQUE NOT NULL,name TEXT NOT NULL,repo_path TEXT NOT NULL,base_branch TEXT NOT NULL DEFAULT 'main',test_cmd TEXT,setup_cmd TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL REFERENCES projects(id),identifier TEXT UNIQUE NOT NULL,seq INTEGER NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'backlog',priority TEXT NOT NULL DEFAULT 'P1',role TEXT NOT NULL DEFAULT 'any',worker TEXT NOT NULL DEFAULT 'codex',depends_on TEXT NOT NULL DEFAULT '[]',attempts INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 3,branch TEXT,worktree_path TEXT,feedback TEXT NOT NULL DEFAULT '',blocker TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY,task_id INTEGER NOT NULL REFERENCES tasks(id),worker TEXT NOT NULL,pid INTEGER,status TEXT NOT NULL,started_at TEXT NOT NULL,ended_at TEXT,exit_code INTEGER,test_exit_code INTEGER,log_path TEXT NOT NULL,last_message_path TEXT NOT NULL,summary TEXT);
    CREATE TABLE IF NOT EXISTS routines(id INTEGER PRIMARY KEY,name TEXT UNIQUE NOT NULL,cron TEXT NOT NULL,action TEXT NOT NULL,payload TEXT NOT NULL DEFAULT '{}',enabled INTEGER NOT NULL DEFAULT 1,last_run_at TEXT);
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,ts TEXT NOT NULL,task_id INTEGER REFERENCES tasks(id),kind TEXT NOT NULL,message TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    const projectColumns = this.db.pragma("table_info(projects)") as {
      name: string;
    }[];
    for (const [name, declaration] of Object.entries({
      integration_branch: "TEXT NOT NULL DEFAULT ''",
      auto_review: "INTEGER NOT NULL DEFAULT 0",
      autopilot: "INTEGER NOT NULL DEFAULT 0",
      goal: "TEXT NOT NULL DEFAULT ''",
      autopilot_rank: "INTEGER NOT NULL DEFAULT 100",
      context_file: "TEXT",
    }))
      if (!projectColumns.some((c) => c.name === name))
        this.db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${declaration}`);
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS autopilot_jobs(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, project_id INTEGER NOT NULL REFERENCES projects(id), task_id INTEGER REFERENCES tasks(id), started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 1, notes TEXT NOT NULL DEFAULT '');`,
    );
    const columns = this.db.pragma("table_info(tasks)") as { name: string }[];
    if (!columns.some((c) => c.name === "lost_count"))
      this.db.exec(
        "ALTER TABLE tasks ADD COLUMN lost_count INTEGER NOT NULL DEFAULT 0",
      );
    if (!columns.some((c) => c.name === "sort_order")) {
      this.db.exec(
        "ALTER TABLE tasks ADD COLUMN sort_order REAL NOT NULL DEFAULT 0",
      );
      this.db.exec("UPDATE tasks SET sort_order=seq");
    }
    for (const [name, declaration] of Object.entries({
      integrated: "INTEGER NOT NULL DEFAULT 1",
      resolves_task_id: "INTEGER REFERENCES tasks(id)",
    }))
      if (!columns.some((c) => c.name === name))
        this.db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${declaration}`);
    const runColumns = this.db.pragma("table_info(runs)") as { name: string }[];
    if (!runColumns.some((c) => c.name === "start_sha"))
      this.db.exec("ALTER TABLE runs ADD COLUMN start_sha TEXT");
    for (const [k, v] of Object.entries({
      max_parallel: "2",
      worker_timeout_min: "45",
      default_worker: "codex",
      review_mode: "manual",
      cooldown_until: "",
      last_tick_at: "",
      auto_review_daily_max: "80",
      planner_daily_max: "10",
      keep_awake: "1",
      keep_awake_pid: "",
      idle_since: "",
    }))
      this.db.prepare("INSERT OR IGNORE INTO settings VALUES (?,?)").run(k, v);
  }
  close() {
    this.db.close();
  }
  getSetting(key: string) {
    return (
      this.db.prepare("SELECT value FROM settings WHERE key=?").get(key) as
        { value: string } | undefined
    )?.value;
  }
  settings() {
    return Object.fromEntries(
      (
        this.db.prepare("SELECT * FROM settings").all() as {
          key: string;
          value: string;
        }[]
      ).map((r) => [r.key, r.value]),
    );
  }
  setSetting(key: string, value: string) {
    if (!Object.hasOwn(this.settings(), key))
      throw new Error("Unknown setting");
    if (
      ["auto_review_daily_max", "planner_daily_max"].includes(key) &&
      (!Number.isInteger(Number(value)) || Number(value) < 0)
    )
      throw new Error("Expected nonnegative integer");
    if (key === "keep_awake" && !["0", "1"].includes(value))
      throw new Error("Expected 0 or 1");
    if (
      ["max_parallel", "worker_timeout_min"].includes(key) &&
      (!Number.isFinite(Number(value)) ||
        Number(value) <= 0 ||
        (key === "max_parallel" && !Number.isInteger(Number(value))))
    )
      throw new Error("Expected positive number");
    if (
      (key === "default_worker" && !["codex", "opencode"].includes(value)) ||
      (key === "review_mode" && !["manual", "claude"].includes(value)) ||
      (key === "cooldown_until" &&
        value !== "" &&
        !Number.isFinite(Date.parse(value)))
    )
      throw new Error("Invalid setting value");
    this.db.prepare("UPDATE settings SET value=? WHERE key=?").run(value, key);
  }
  projects() {
    return this.db
      .prepare("SELECT * FROM projects ORDER BY key")
      .all() as Project[];
  }
  project(key: string | number) {
    const p = this.db
      .prepare(
        `SELECT * FROM projects WHERE ${typeof key === "number" ? "id" : "key"}=?`,
      )
      .get(key) as Project | undefined;
    if (!p) throw new Error("Project not found");
    return p;
  }
  addProject(p: {
    key: string;
    name: string;
    repo_path: string;
    base_branch?: string;
    test_cmd?: string;
    setup_cmd?: string;
  }) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(p.key))
      throw new Error("Invalid project key");
    const r = this.db
      .prepare(
        "INSERT INTO projects(key,name,repo_path,base_branch,test_cmd,setup_cmd,created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        p.key,
        p.name,
        resolve(p.repo_path),
        p.base_branch || "main",
        p.test_cmd || null,
        p.setup_cmd || null,
        new Date().toISOString(),
      );
    return this.project(Number(r.lastInsertRowid));
  }
  updateProject(key: string, patch: Record<string, unknown>) {
    const allowed = [
      "name",
      "repo_path",
      "base_branch",
      "test_cmd",
      "setup_cmd",
      "auto_review",
      "autopilot",
      "goal",
      "autopilot_rank",
      "context_file",
    ];
    if (Object.keys(patch).some((k) => !allowed.includes(k)))
      throw new Error("Unsupported project field");
    const data = { ...patch };
    for (const k of ["auto_review", "autopilot"])
      if (data[k] !== undefined) {
        if (![0, 1, false, true].includes(data[k] as number))
          throw new Error(`Invalid ${k}`);
        data[k] = Number(data[k]);
      }
    if (
      data.autopilot_rank !== undefined &&
      !Number.isSafeInteger(data.autopilot_rank)
    )
      throw new Error("Invalid autopilot_rank");
    for (const k of allowed.filter(
      (k) => !["auto_review", "autopilot", "autopilot_rank"].includes(k),
    ))
      if (
        data[k] !== undefined &&
        !(
          data[k] === null &&
          ["test_cmd", "setup_cmd", "context_file"].includes(k)
        ) &&
        typeof data[k] !== "string"
      )
        throw new Error(`Invalid ${k}`);
    for (const k of ["name", "repo_path", "base_branch"])
      if (data[k] !== undefined && !String(data[k]).trim())
        throw new Error(`Invalid ${k}`);
    const p = this.project(key);
    if (Object.keys(data).length)
      this.db
        .prepare(
          `UPDATE projects SET ${Object.keys(data)
            .map((k) => `${k}=?`)
            .join(",")} WHERE id=?`,
        )
        .run(...Object.values(data), p.id);
    return this.project(key);
  }
  tasks(filter: { status?: string; project?: string } = {}) {
    return (
      this.db
        .prepare("SELECT * FROM tasks ORDER BY priority,seq,id")
        .all() as Task[]
    ).filter(
      (t) =>
        (!filter.status || t.status === filter.status) &&
        (!filter.project || t.project_id === this.project(filter.project).id),
    );
  }
  task(id: string | number) {
    if (typeof id === "string" && /^\d+$/.test(id)) id = Number(id);
    const t = this.db
      .prepare(
        `SELECT * FROM tasks WHERE ${typeof id === "number" ? "id" : "identifier"}=?`,
      )
      .get(id) as Task | undefined;
    if (!t) throw new Error("Task not found");
    return t;
  }
  addTask(input: Record<string, unknown>) {
    if (typeof input.title !== "string" || !input.title.trim())
      throw new Error("Title required");
    return this.db.transaction(() => {
      const p = this.project(String(input.project));
      const seq = (
        this.db
          .prepare(
            "SELECT COALESCE(MAX(CAST(substr(identifier, length(?) + 2) AS INTEGER)),0)+1 AS n FROM tasks WHERE project_id=?",
          )
          .get(p.key, p.id) as { n: number }
      ).n;
      const now = new Date().toISOString();
      const r = this.db
        .prepare(
          "INSERT INTO tasks(project_id,identifier,seq,sort_order,title,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          p.id,
          `${p.key}-${seq}`,
          seq,
          seq,
          String(input.title || ""),
          now,
          now,
        );
      return this.updateTask(Number(r.lastInsertRowid), {
        ...input,
        worker: input.worker || this.getSetting("default_worker"),
      });
    })();
  }
  updateTask(id: string | number, patch: Record<string, unknown>) {
    const t = this.task(id);
    const allowed = [
      "title",
      "description",
      "status",
      "priority",
      "role",
      "worker",
      "depends_on",
      "attempts",
      "integrated",
      "resolves_task_id",
      "lost_count",
      "max_attempts",
      "branch",
      "worktree_path",
      "feedback",
      "blocker",
      "seq",
      "sort_order",
    ];
    const data = Object.fromEntries(
      Object.entries(patch).filter(
        ([k, v]) => allowed.includes(k) && v !== undefined,
      ),
    );
    for (const key of ["title", "description", "feedback", "blocker"]) {
      if (data[key] !== undefined && typeof data[key] !== "string")
        throw new Error(`Invalid ${key}`);
    }
    if (data.title !== undefined && !String(data.title).trim())
      throw new Error("Title required");
    for (const [k, values] of Object.entries({
      status: statuses,
      priority: priorities,
      role: ["backend", "frontend", "testing", "any"],
      worker: ["codex", "opencode"],
    }))
      if (
        data[k] !== undefined &&
        !(values as readonly unknown[]).includes(data[k])
      )
        throw new Error(`Invalid ${k}`);
    for (const k of ["attempts", "lost_count", "max_attempts", "seq"])
      if (
        data[k] !== undefined &&
        (!Number.isInteger(data[k]) ||
          Number(data[k]) < (["attempts", "lost_count"].includes(k) ? 0 : 1))
      )
        throw new Error(`Invalid ${k}`);
    if (
      data.sort_order !== undefined &&
      (typeof data.sort_order !== "number" || !Number.isFinite(data.sort_order))
    )
      throw new Error("Invalid sort_order");
    if (data.status === "ready" && t.status === "blocked") data.blocker = "";
    if (data.depends_on !== undefined) {
      const deps =
        typeof data.depends_on === "string"
          ? JSON.parse(data.depends_on)
          : data.depends_on;
      if (
        !Array.isArray(deps) ||
        deps.some((x) => typeof x !== "string" || x === t.identifier)
      )
        throw new Error("Invalid dependencies");
      const visit = (identifier: string, seen = new Set<string>()) => {
        const dep = this.task(identifier);
        if (dep.id === t.id) throw new Error("Dependency cycle");
        if (seen.has(identifier)) return;
        seen.add(identifier);
        for (const child of JSON.parse(dep.depends_on) as string[])
          visit(child, seen);
      };
      for (const dep of deps) visit(dep);
      data.depends_on = JSON.stringify(deps);
    }
    data.updated_at = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE tasks SET ${Object.keys(data)
          .map((k) => `${k}=?`)
          .join(",")} WHERE id=?`,
      )
      .run(...Object.values(data), t.id);
    return this.task(t.id);
  }
  event(kind: string, message: string, taskId: number | null = null) {
    this.db
      .prepare("INSERT INTO events(ts,task_id,kind,message) VALUES (?,?,?,?)")
      .run(new Date().toISOString(), taskId, kind, message);
  }
  events(limit = 50, taskId?: number) {
    return this.db
      .prepare(
        `SELECT * FROM events ${taskId === undefined ? "" : "WHERE task_id=?"} ORDER BY id DESC LIMIT ?`,
      )
      .all(...(taskId === undefined ? [limit] : [taskId, limit]));
  }
  runs(taskId?: number) {
    return this.db
      .prepare(
        `SELECT * FROM runs ${taskId === undefined ? "" : "WHERE task_id=?"} ORDER BY id DESC`,
      )
      .all(...(taskId === undefined ? [] : [taskId])) as Run[];
  }
  detail(id: string) {
    const task = this.task(id);
    return {
      ...task,
      runs: this.runs(task.id),
      events: this.events(50, task.id),
    };
  }
  routines() {
    return this.db
      .prepare("SELECT * FROM routines ORDER BY id")
      .all() as Routine[];
  }
  addRoutine(
    name: string,
    cron: string,
    action: string,
    payload: unknown = {},
  ) {
    if (typeof name !== "string" || !name.trim())
      throw new Error("Routine name required");
    if (!["heartbeat", "create_task", "shell"].includes(action))
      throw new Error("Invalid action");
    this.db
      .prepare(
        "INSERT INTO routines(name,cron,action,payload) VALUES (?,?,?,?)",
      )
      .run(name, cron, action, JSON.stringify(payload));
  }
  init() {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO routines(name,cron,action) VALUES ('heartbeat','*/5 * * * *','heartbeat')",
      )
      .run();
  }
}
