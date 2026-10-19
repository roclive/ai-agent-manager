import { it, expect } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { wrapper } from "../src/core/autopilot.js";

it.each([false, true])(
  "persists large stdout/stderr without killing reviewer (Codex=%s)",
  (codex) => {
    const dir = mkdtempSync(join(tmpdir(), "aam-output-"));
    try {
      const prompt = join(dir, "prompt"),
        out = join(dir, "result.json"),
        last = join(dir, "last.md");
      writeFileSync(prompt, "Review fake output");
      const verdict = JSON.stringify({
        verdict: "approve",
        notes: "large output survived",
      });
      const script = `process.stdin.resume();process.stdout.write('x'.repeat(2*1024*1024));process.stderr.write('e'.repeat(2*1024*1024));${codex ? `require('node:fs').writeFileSync(${JSON.stringify(last)},${JSON.stringify(verdict)});` : `process.stdout.write(${JSON.stringify(verdict)});`}`;
      const r = spawnSync(
        process.execPath,
        [
          "-e",
          wrapper,
          process.execPath,
          dir,
          prompt,
          out,
          JSON.stringify(["-e", script]),
          codex ? last : "",
        ],
        { timeout: 10000, encoding: "utf8" },
      );
      expect(r.status, r.stderr).toBe(0);
      const result = JSON.parse(readFileSync(out, "utf8"));
      expect(result.status).toBe(0);
      expect(result.stdout.endsWith(verdict)).toBe(true);
      expect(statSync(join(dir, "stdout.log")).size).toBeGreaterThan(
        1024 * 1024,
      );
      expect(result.stderr.length).toBe(256 * 1024);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

it("reports an oversized final response explicitly and retains raw logs", () => {
  const dir = mkdtempSync(join(tmpdir(), "aam-output-"));
  try {
    const prompt = join(dir, "prompt"),
      out = join(dir, "result.json"),
      last = join(dir, "last.md");
    writeFileSync(prompt, "fake");
    const script = `const fs=require('node:fs');fs.closeSync(fs.openSync(${JSON.stringify(last)},'w'));fs.truncateSync(${JSON.stringify(last)},64*1024*1024+1);console.log('retained evidence');`;
    const r = spawnSync(
      process.execPath,
      [
        "-e",
        wrapper,
        process.execPath,
        dir,
        prompt,
        out,
        JSON.stringify(["-e", script]),
        last,
      ],
      { timeout: 10000, encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    expect(JSON.parse(readFileSync(out, "utf8"))).toMatchObject({
      status: -1,
      code: "AAM_OUTPUT_TOO_LARGE",
    });
    expect(readFileSync(join(dir, "stdout.log"), "utf8")).toContain(
      "retained evidence",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
