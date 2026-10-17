import { Repo } from "../db/index.js";
import { git, runner, type Runner } from "./process.js";
export function review(repo: Repo, id: string, verdict: string, notes = "") {
  if (!["approve", "reject"].includes(verdict))
    throw new Error("Expected approve or reject");
  const t = repo.task(id);
  if (t.status !== "in_review") throw new Error("Task is not in review");
  const attempts = t.attempts + (verdict === "reject" ? 1 : 0);
  const blocked = verdict === "reject" && attempts >= t.max_attempts;
  repo.updateTask(id, {
    status: verdict === "approve" ? "done" : blocked ? "blocked" : "ready",
    attempts,
    feedback: notes,
    blocker: blocked ? notes || "Review attempts exhausted" : "",
  });
  repo.event("review", `${verdict}: ${notes}`, t.id);
}
export function parseVerdict(
  text: string,
): { verdict: string; notes: string } | null {
  try {
    const outer = JSON.parse(text);
    if (typeof outer.result === "string") text = outer.result;
  } catch {
    /* may include prose */
  }
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] !== "}") continue;
      try {
        const v = JSON.parse(text.slice(i, j + 1));
        if (
          ["approve", "reject"].includes(v.verdict) &&
          typeof v.notes === "string"
        )
          return v;
      } catch {
        /* keep scanning */
      }
    }
  }
  return null;
}
export function claudeReview(repo: Repo, id: string, run: Runner = runner) {
  const t = repo.task(id);
  const p = repo.project(t.project_id);
  if (!t.worktree_path) return;
  const diff = git(t.worktree_path, ["diff", `${p.base_branch}...${t.branch}`]);
  const stat = git(t.worktree_path, [
    "diff",
    `${p.base_branch}...${t.branch}`,
    "--stat",
  ]);
  const prompt = `Review ${t.identifier}: ${t.title}\n${t.description}\nTests: ${JSON.stringify(repo.runs(t.id)[0])}\n${stat}\n${Buffer.from(diff).subarray(0, 60000).toString()}\nReply with JSON {"verdict":"approve"|"reject","notes":"..."}.`;
  const r = run(
    "claude",
    ["-p", "--output-format", "json", prompt],
    t.worktree_path,
    undefined,
    120000,
  );
  const v = r.status === 0 ? parseVerdict(r.stdout) : null;
  if (v) review(repo, id, v.verdict, v.notes);
  else
    repo.event("review_error", r.stderr || "Unparseable Claude review", t.id);
}
