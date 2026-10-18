import { describe, it, expect } from "vitest";
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fixture } from "./helpers.js";
import { git } from "../src/core/process.js";
import { ensureWorktree } from "../src/core/worktree.js";
import { review } from "../src/core/review.js";
import {
  setIntegration,
  promote,
  reconcileIntegration,
  integrate,
} from "../src/core/integration.js";

describe("integration branch", () => {
  it("queues conflicts, preserves both intents, and promotes only explicitly", () => {
    const f = fixture();
    try {
      setIntegration(f.repo, "T", "on");
      const base = git(f.path, ["rev-parse", "main"]);
      const a = f.task(),
        b = f.task();
      const wa = ensureWorktree(f.repo, a),
        wb = ensureWorktree(f.repo, b);
      for (const [path, value] of [
        [wa, "first"],
        [wb, "second"],
      ]) {
        writeFileSync(resolve(path, "initial.txt"), value);
        git(path, ["add", "."]);
        git(path, ["commit", "-m", value]);
      }
      for (const t of [a, b]) {
        f.repo.updateTask(t.id, { status: "in_review" });
        review(f.repo, t.identifier, "approve");
      }
      expect(f.repo.task(a.id).integrated).toBe(1);
      expect(f.repo.task(b.id).integrated).toBe(0);
      expect(f.repo.task(b.id).status).toBe("done");
      const resolution = f.repo
        .tasks()
        .find((t) => t.resolves_task_id === b.id)!;
      expect(resolution.priority).toBe("P0");
      expect(resolution.description).toContain("initial.txt");
      const wr = ensureWorktree(f.repo, resolution);
      try {
        git(wr, ["merge", b.branch || `aam/${b.identifier}`]);
      } catch {
        /* expected */
      }
      writeFileSync(resolve(wr, "initial.txt"), "first\nsecond\n");
      git(wr, ["add", "."]);
      git(wr, ["commit", "-m", "resolve both"]);
      f.repo.updateTask(resolution.id, { status: "in_review" });
      review(f.repo, resolution.identifier, "approve");
      expect(f.repo.task(b.id).integrated).toBe(1);
      // A stale, approved snapshot from an earlier attempt must not restart
      // conflict resolution after the later genuine merge has landed.
      const obsolete = f.task({
        status: "done",
        resolves_task_id: b.id,
        integrated: 0,
      });
      const obsoletePath = ensureWorktree(f.repo, obsolete);
      writeFileSync(resolve(obsoletePath, "initial.txt"), "obsolete snapshot");
      git(obsoletePath, ["add", "."]);
      git(obsoletePath, ["commit", "-m", "old snapshot"]);
      // Reproduce legacy IDs: the already-integrated solution is the newer one.
      f.repo.db
        .prepare("UPDATE tasks SET resolves_task_id=NULL WHERE id=?")
        .run(resolution.id);
      const newer = f.task({
        status: "done",
        resolves_task_id: b.id,
        integrated: 1,
        branch: resolution.branch || `aam/${resolution.identifier}`,
      });
      const count = f.repo.tasks().length;
      const tip = git(f.path, ["rev-parse", "aam/integration"]);
      for (let i = 0; i < 3; i++) reconcileIntegration(f.repo);
      integrate(f.repo, obsolete.identifier);
      expect(f.repo.tasks()).toHaveLength(count);
      expect(git(f.path, ["rev-parse", "aam/integration"])).toBe(tip);
      expect(f.repo.task(obsolete.id).integrated).toBe(0);
      expect(f.repo.task(newer.id).integrated).toBe(1);
      expect(git(f.path, ["show", "aam/integration:initial.txt"])).toBe(
        "first\nsecond",
      );
      expect(git(f.path, ["rev-parse", "main"])).toBe(base);
      expect(() => promote(f.repo, "T", false)).toThrow("confirmation");
      writeFileSync(resolve(f.path, "dirty.txt"), "dirty");
      expect(() => promote(f.repo, "T", true)).toThrow("uncommitted");
      git(f.path, ["clean", "-f"]);
      promote(f.repo, "T", true);
      expect(readFileSync(resolve(f.path, "initial.txt"), "utf8")).toBe(
        "first\nsecond\n",
      );
    } finally {
      f.cleanup();
    }
  });
  it("bounds resolution tasks even when third-party integration edits conflict", () => {
    const f = fixture();
    try {
      setIntegration(f.repo, "T", "on");
      const original = f.task();
      const wt = ensureWorktree(f.repo, original);
      writeFileSync(resolve(wt, "initial.txt"), "task");
      git(wt, ["add", "."]);
      git(wt, ["commit", "-m", "task"]);
      // A third-party commit lands directly on integration.
      git(f.path, ["checkout", "aam/integration"]);
      writeFileSync(resolve(f.path, "initial.txt"), "third party");
      git(f.path, ["add", "."]);
      git(f.path, ["commit", "-m", "third party"]);
      git(f.path, ["checkout", "main"]);
      f.repo.updateTask(original.id, { status: "in_review" });
      review(f.repo, original.identifier, "approve");
      f.repo.setSetting("integration_max_resolves", "2");
      for (let i = 0; i < 2; i++) {
        const r = f.repo
          .tasks()
          .filter((t) => t.resolves_task_id === original.id)
          .at(-1)!;
        // Simulate a worker submitting the conflicting original instead of resolving it.
        f.repo.updateTask(r.id, {
          status: "in_review",
          branch: `aam/${original.identifier}`,
        });
        review(f.repo, r.identifier, "approve");
      }
      expect(
        f.repo.tasks().filter((t) => t.resolves_task_id === original.id),
      ).toHaveLength(2);
      expect(f.repo.task(original.id).status).toBe("blocked");
      expect(f.repo.task(original.id).blocker).toContain("maximum 2");
      expect(git(f.path, ["show", "main:initial.txt"])).toBe("initial");
    } finally {
      f.cleanup();
    }
  });
  it("keeps existing projects opted out", () => {
    const f = fixture();
    try {
      expect(f.repo.project("T").integration_branch).toBe("");
    } finally {
      f.cleanup();
    }
  });
});
