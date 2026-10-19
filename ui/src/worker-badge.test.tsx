import { it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkerBadge } from "./components/WorkerBadge";

it("shows the real worker label with a kind-specific badge", () => {
  render(<WorkerBadge kind="claude" label="Claude (sonnet)" />);
  const badge = screen.getByText("Claude (sonnet)");
  expect(badge).toHaveAttribute("data-kind", "claude");
});
it("falls back to unknown for missing identity", () => {
  render(<WorkerBadge kind={null} />);
  expect(screen.getByText("未知")).toHaveAttribute("data-kind", "unknown");
});
