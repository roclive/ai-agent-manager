import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GlobalExecutorSwitch, ExecutorBadge, ExecutorSelect } from "./components/ExecutorSelect";

const view = {
  coding_executor: "claude",
  worker_effort: "default",
  effort_choices: ["default", "low", "medium", "high"],
  executor_fallback: [],
  reviewer: "codex",
  executors: [
    { id: "codex-sol", label: "Codex (Sol)", installed: true, install_hint: "npm i -g @openai/codex", effort_supported: true, cooldown_until: new Date(Date.now() + 600000).toISOString(), model: "gpt-6.1-sol" },
    { id: "claude", label: "Claude (Sonnet)", installed: true, install_hint: "", effort_supported: true, cooldown_until: null },
    { id: "claude-opus", label: "Claude (Opus)", installed: true, install_hint: "", effort_supported: true, cooldown_until: null, model: "opus" },
    { id: "codex-luna", label: "Codex (Luna)", installed: true, install_hint: "", effort_supported: true, cooldown_until: null, model: "gpt-5.6-luna" },
    { id: "hermes", label: "Hermes Agent (Nous)", installed: false, install_hint: "curl install.sh | bash", effort_supported: false, cooldown_until: null },
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

it("persists effort, refetches it, and disables it after switching executor", async () => {
  let current = { ...view };
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      current = { ...current, ...JSON.parse(String(init.body)) };
    }
    return new Response(JSON.stringify(current));
  });
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <GlobalExecutorSwitch
        onChange={(coding_executor) => void fetch("/executors", { method: "PUT", body: JSON.stringify({ coding_executor }) }).then(() => client.invalidateQueries({ queryKey: ["executors"] }))}
        onEffortChange={(worker_effort) => void fetch("/executors", { method: "PUT", body: JSON.stringify({ worker_effort }) }).then(() => client.invalidateQueries({ queryKey: ["executors"] }))}
      />
    </QueryClientProvider>,
  );
  const effort = await screen.findByLabelText("工作执行器思考强度");
  fireEvent.change(effort, { target: { value: "high" } });
  await waitFor(() => expect(effort).toHaveValue("high"));
  fireEvent.change(screen.getByLabelText("全局编码执行器"), { target: { value: "hermes" } });
  await waitFor(() => expect(effort).toBeDisabled());
  expect(screen.getByText("不可用")).toBeInTheDocument();
});

it("lists executors, disables uninstalled ones with hint, and reports changes", async () => {
  const onChange = vi.fn();
  wrap(<GlobalExecutorSwitch onChange={onChange} />);
  const select = await screen.findByLabelText("全局编码执行器");
  await waitFor(() => expect(select.querySelectorAll("option").length).toBeGreaterThan(3));
  const hermes = screen.getByRole("option", { name: /Hermes.*not installed/ }) as HTMLOptionElement;
  expect(hermes.disabled).toBe(true);
  expect(hermes.textContent).toContain("curl install.sh");
  expect(screen.getByText("Codex (Sol) 冷却中")).toBeInTheDocument();
  fireEvent.change(select, { target: { value: "codex-sol" } });
  expect(onChange).toHaveBeenCalledWith("codex-sol");
});

it("offers an inherit option and shows effective executor with source", async () => {
  wrap(
    <>
      <ExecutorSelect label="任务" inheritLabel="继承" value="" name="executor" />
      <ExecutorBadge effective={{ value: "claude", source: "project" }} />
    </>,
  );
  await screen.findByRole("option", { name: "继承" });
  expect(await screen.findByText("Claude (Sonnet) · 项目")).toHaveAttribute("data-source", "project");
});

import { effectiveExecutor } from "./lib/executor";
import { Backlog } from "./pages/Backlog";
import { MemoryRouter } from "react-router-dom";

it("resolves effective executor as task > project > global, ignoring legacy worker", () => {
  const projects = [
    { id: 1, coding_executor: "hermes" },
    { id: 2, coding_executor: "" },
  ];
  const g = { coding_executor: "claude" };
  const t = (o: object) => ({ project_id: 1, worker: "codex", ...o }) as never;
  expect(effectiveExecutor(t({ executor: "pi" }), projects, g)).toEqual({ value: "pi", source: "task" });
  expect(effectiveExecutor(t({}), projects, g)).toEqual({ value: "hermes", source: "project" });
  expect(effectiveExecutor(t({ project_id: 2 }), projects, g)).toEqual({ value: "claude", source: "global" });
  expect(effectiveExecutor(t({ project_id: 2 }), projects, { coding_executor: "" })).toEqual({ value: "auto", source: "global" });
  const server = { value: "codex-sol", source: "global" as const };
  expect(effectiveExecutor(t({ project_id: 2, effective_executor: server }), undefined, undefined)).toBe(server);
});

it("backlog filter options follow API, labels/filter use effective executor and refresh on settings change", async () => {
  let current = { ...view, executors: [...view.executors, { id: "pi", label: "pi", installed: true, install_hint: "", cooldown_until: null }] };
  const task = (id: number, extra: object) => ({
    id, project_id: 1, identifier: `AAM-${id}`, title: `t${id}`, description: "", status: "ready",
    priority: "P1", role: "any", worker: "codex", depends_on: "[]", updated_at: "2026-01-01", ...extra,
  });
  const tasks = [task(1, {}), task(2, { executor: "pi" })];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/executors")) return new Response(JSON.stringify(current));
    if (String(url).includes("/projects")) return new Response(JSON.stringify([{ id: 1, key: "AAM", name: "AAM" }]));
    return new Response(JSON.stringify(tasks));
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><Backlog project="" /></MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole("option", { name: "pi" });
  expect(screen.getByRole("option", { name: "Hermes Agent (Nous)" })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId("executor-AAM-1")).toHaveTextContent("Claude (Sonnet) · 全局"));
  expect(screen.getByTestId("executor-AAM-2")).toHaveTextContent("pi · 任务");
  fireEvent.change(screen.getByLabelText("筛选执行器"), { target: { value: "pi" } });
  expect(screen.queryByTestId("executor-AAM-1")).toBeNull();
  expect(screen.getByTestId("executor-AAM-2")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("筛选执行器"), { target: { value: "" } });
  current = { ...current, coding_executor: "opencode" };
  await client.invalidateQueries({ queryKey: ["executors"] });
  await waitFor(() => expect(screen.getByTestId("executor-AAM-1")).toHaveTextContent("opencode · 全局"));
});

import { BoardPage } from "./pages-board";

it("kanban pending cards use effective executor, keep historical worker on active cards, and refresh via SSE", async () => {
  let current = { ...view };
  const task = (id: number, extra: object) => ({
    id, project_id: 1, identifier: `AAM-${id}`, title: `t${id}`, description: "", status: "backlog",
    priority: "P1", role: "any", worker: "codex", depends_on: "[]", attempts: 1, max_attempts: 3,
    updated_at: "2026-01-01", latest_worker: { run_id: 1, kind: "codex", model: null, label: "OLDWORKER" }, ...extra,
  });
  const tasks = [
    task(1, {}),
    task(2, { status: "ready", executor: "hermes" }),
    task(3, { status: "in_progress" }),
  ];
  let listener: (() => void) | undefined;
  class FakeES {
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    addEventListener(_: string, fn: () => void) { listener = fn; }
    close() {}
  }
  vi.stubGlobal("EventSource", FakeES);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/executors")) return new Response(JSON.stringify(current));
    if (String(url).includes("/projects")) return new Response(JSON.stringify([{ id: 1, key: "AAM", name: "AAM" }]));
    if (String(url).includes("/runs")) return new Response("[]");
    return new Response(JSON.stringify(tasks));
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><BoardPage project="" /></MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("card-executor-AAM-1")).toHaveTextContent("Claude (Sonnet) · 全局"));
  expect(screen.getByTestId("card-executor-AAM-2")).toHaveTextContent("Hermes Agent (Nous) · 任务");
  expect(screen.queryByTestId("card-executor-AAM-3")).toBeNull();
  expect(screen.getAllByText("OLDWORKER").length).toBe(1);
  current = { ...current, coding_executor: "opencode" };
  listener?.();
  await waitFor(() => expect(screen.getByTestId("card-executor-AAM-1")).toHaveTextContent("opencode · 全局"));
});

it("shows model variants and maps legacy codex to Codex (Sol)", async () => {
  wrap(<form aria-label="settings"><ExecutorSelect label="x" inheritLabel="inherit" value="codex" name="e" /></form>);
  await screen.findByRole("option", { name: "Claude (Opus)" });
  expect(screen.getByRole("option", { name: "Codex (Luna)" })).toBeInTheDocument();
  const select = screen.getByLabelText("x") as HTMLSelectElement;
  expect(select.value).toBe("codex-sol");
  expect(new FormData(select.form!).get("e")).toBe("codex-sol");
  expect(effectiveExecutor({ executor: "codex", project_id: 1 } as never, [], undefined)).toEqual({ value: "codex-sol", source: "task" });
});
