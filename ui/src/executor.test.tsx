import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GlobalExecutorSwitch, ExecutorBadge, ExecutorSelect } from "./components/ExecutorSelect";

const view = {
  coding_executor: "claude",
  executor_fallback: [],
  reviewer: "codex",
  executors: [
    { id: "codex", label: "Codex", installed: true, install_hint: "npm i -g @openai/codex", cooldown_until: new Date(Date.now() + 600000).toISOString() },
    { id: "claude", label: "Claude (sonnet)", installed: true, install_hint: "", cooldown_until: null },
    { id: "hermes", label: "Hermes Agent (Nous)", installed: false, install_hint: "curl install.sh | bash", cooldown_until: null },
  ],
};
function wrap(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(view))));
});

it("lists executors, disables uninstalled ones with hint, and reports changes", async () => {
  const onChange = vi.fn();
  wrap(<GlobalExecutorSwitch onChange={onChange} />);
  const select = await screen.findByLabelText("全局编码执行器");
  await waitFor(() => expect(select.querySelectorAll("option").length).toBeGreaterThan(3));
  const hermes = screen.getByRole("option", { name: /Hermes.*not installed/ }) as HTMLOptionElement;
  expect(hermes.disabled).toBe(true);
  expect(hermes.textContent).toContain("curl install.sh");
  expect(screen.getByText("Codex 冷却中")).toBeInTheDocument();
  fireEvent.change(select, { target: { value: "codex" } });
  expect(onChange).toHaveBeenCalledWith("codex");
});

it("offers an inherit option and shows effective executor with source", async () => {
  wrap(
    <>
      <ExecutorSelect label="任务" inheritLabel="继承" value="" name="executor" />
      <ExecutorBadge effective={{ value: "claude", source: "project" }} />
    </>,
  );
  await screen.findByRole("option", { name: "继承" });
  expect(screen.getByText("claude · 项目")).toHaveAttribute("data-source", "project");
});
