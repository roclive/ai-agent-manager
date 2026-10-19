export const REVIEWERS = ["codex-sol", "codex-luna", "claude", "claude-opus", "gw"] as const;
export type Reviewer = (typeof REVIEWERS)[number];

export const LEGACY_REVIEWERS: Record<string, Reviewer> = { codex: "codex-sol" };

export function normalizeReviewer(value: string | undefined): string {
  return LEGACY_REVIEWERS[value || ""] ?? value ?? "";
}

export function validReviewer(value: string): boolean {
  return REVIEWERS.includes(normalizeReviewer(value) as Reviewer);
}
