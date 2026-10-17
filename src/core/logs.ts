import { readFileSync } from "node:fs";
export function tail(path: string, lines = 100) {
  if (!Number.isInteger(lines) || lines < 0 || lines > 10000)
    throw new Error("Invalid tail count");
  if (lines === 0) return "";
  try {
    const text = readFileSync(path, "utf8");
    const parts = text.split("\n");
    if (parts.at(-1) === "") parts.pop();
    return parts.slice(-lines).join("\n");
  } catch {
    return "";
  }
}
