import { UsageSnapshots } from "../components/UsageSnapshots";
import { RoutingConsole } from "../components/RoutingConsole";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "../lib/api";
import { ExecutorSelect } from "../components/ExecutorSelect";
import { WorkerEffortSelect } from "../components/WorkerEffortSelect";
import { ReviewerSelect } from "../components/ReviewerSelect";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/select";
import { Load, useAction, ActionError } from "../components/PageSupport";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { SettingsProjects } from "./SettingsProjects";
import { useLocation, useNavigate } from "react-router-dom";
export function Settings() {
  const location = useLocation();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["settings"],
    queryFn: () => request<Record<string, string>>("/settings"),
  });
  const action = useAction();
  const [reviewerChoice, setReviewerChoice] = useState<string | null>(null);
  const [reviewerModel, setReviewerModel] = useState<string | null>(null);
  const [tab, setTab] = useState(() => selectedSettingsTab(location.search));
  const manager = useQuery({ queryKey: ["manager"], queryFn: () => request<{backend:string;model:string;base_url:string;fallback_to_rules:boolean;daily_cap:string}>('/manager') });
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>设置</h1>
          <p>执行器、审查与项目配置。</p>
        </div>
      </div>
      <Tabs value={tab} onValueChange={(value) => changeTab(value)}>
      <TabsList><TabsTrigger value="settings" onClick={() => changeTab("settings")}>设置</TabsTrigger><TabsTrigger value="projects" onClick={() => changeTab("projects")}>项目</TabsTrigger></TabsList>
      <TabsContent value="settings">
      <RoutingConsole />
      <UsageSnapshots />
      <ActionError error={action.error} />
      <section className="page-section">
        <h2>Manager</h2>
        <Load pending={manager.isPending} error={manager.error}>
          {manager.data && <form className="task-form" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); action.mutate({path:"/manager",method:"PUT",body:{manager_backend:form.get("backend"),manager_local_model:form.get("model"),manager_local_base_url:form.get("base_url"),manager_fallback_to_rules:form.has("fallback") ? "1" : "0",manager_daily_max:form.get("daily_cap")}}); }}>
            <label>Backend<NativeSelect name="backend" defaultValue={manager.data.backend}><option value="rules">Rules</option><option value="claude">Claude</option><option value="codex">Codex</option><option value="local-small">Local small model</option></NativeSelect></label>
            <label>Local model name<Input name="model" defaultValue={manager.data.model}/></label>
            <label>Local model base URL<Input name="base_url" type="url" defaultValue={manager.data.base_url}/></label>
            <label>Daily cap<Input name="daily_cap" type="number" min="0" required defaultValue={manager.data.daily_cap}/></label>
            <label><input type="checkbox" name="fallback" defaultChecked={manager.data.fallback_to_rules}/> Fall back to rules if manager call fails</label>
            <Button disabled={action.isPending}>Save manager settings</Button>
            <Button type="button" variant="outline" onClick={() => { const f = document.querySelector<HTMLFormElement>(".page-section form"); if (!f) return; const data=new FormData(f); action.mutate({path:"/manager/test-connection",body:{model:data.get("model"),base_url:data.get("base_url")}}); }}>Test local connection</Button>
            <Button type="button" variant="outline" onClick={() => action.mutate({path:"/manager/switch-to-rules"})}>Switch to rules</Button>
          </form>}
        </Load>
      </section>
      <Load pending={q.isPending} error={q.error}>
        {q.data && (
          <form
            key={JSON.stringify(q.data)}
            className="task-form settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              action.mutate({
                path: "/settings",
                method: "PUT",
                body: Object.fromEntries(f),
              });
            }}
          >
            <label>
              最大并行数
              <Input
                required
                name="max_parallel"
                type="number"
                min="1"
                max="6"
                defaultValue={q.data.max_parallel}
              />
            </label>
            <label>
              执行器超时（分钟）
              <Input
                required
                name="worker_timeout_min"
                type="number"
                min="1"
                defaultValue={q.data.worker_timeout_min}
              />
            </label>
            <label>
              默认执行器
              <NativeSelect
                name="default_worker"
                defaultValue={q.data.default_worker}
              >
                <option>codex</option>
                <option>opencode</option>
              </NativeSelect>
            </label>
            <label>
              编码执行器（全局默认，自动审查驳回后重派也使用它；具体模型由 AAM
              保存的此选项决定，不读取 Codex 桌面应用的模型选择）
              <ExecutorSelect
                name="coding_executor"
                label="全局编码执行器"
                value={q.data.coding_executor || "auto"}
              />
            </label>
            <label>
              执行器回退列表（逗号分隔；为空则限流时等待，绝不静默回退到 Codex）
              <Input
                name="executor_fallback"
                defaultValue={q.data.executor_fallback ?? ""}
              />
            </label>
            <label>
              工作执行器思考强度（不影响审查）
              <WorkerEffortSelect
                name="worker_effort"
                value={q.data.worker_effort || "default"}
                executor={q.data.coding_executor || "auto"}
              />
            </label>
            <label>
              Claude 工作执行器快速模式
              <NativeSelect
                name="worker_fast_mode"
                defaultValue={q.data.worker_fast_mode || "1"}
              >
                <option value="1">开启</option>
                <option value="0">关闭</option>
              </NativeSelect>
            </label>
            <label>
              审查模式
              <NativeSelect
                name="review_mode"
                defaultValue={q.data.review_mode}
              >
                <option value="manual">人工审查</option>
                <option value="claude">自动审查</option>
              </NativeSelect>
            </label>
            <label>
              审查器（独立于编码执行器）
              <ReviewerSelect
                value={reviewerChoice ?? q.data.reviewer ?? "codex-sol"}
                onChange={(value) => {
                  setReviewerChoice(value);
                  if (value.startsWith("claude"))
                    setReviewerModel(
                      value === "claude" ? "sonnet" : value.slice(7),
                    );
                }}
              />
            </label>
            <label>
              Claude 审查模型
              <NativeSelect
                name="reviewer_model"
                value={reviewerModel ?? q.data.reviewer_model ?? "opus"}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setReviewerModel(value);
                  if (
                    (reviewerChoice ?? q.data!.reviewer ?? "").startsWith(
                      "claude",
                    )
                  )
                    setReviewerChoice(
                      value === "sonnet" ? "claude" : `claude-${value}`,
                    );
                }}
              >
                <option value="opus">Opus</option>
                <option value="sonnet">Sonnet</option>
                <option value="haiku">Haiku</option>
              </NativeSelect>
            </label>
            <label>
              Claude 审查思考强度
              <NativeSelect
                name="reviewer_effort"
                defaultValue={q.data.reviewer_effort || "max"}
              >
                {["low", "medium", "high", "xhigh", "max"].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label>
              Claude 审查快速模式
              <NativeSelect
                name="reviewer_fast_mode"
                defaultValue={q.data.reviewer_fast_mode || "1"}
              >
                <option value="1">开启</option>
                <option value="0">关闭</option>
              </NativeSelect>
            </label>
            {[
              ["auto_review_concurrency", "自动审查并发数"],
              ["auto_review_daily_max", "每日自动审查上限"],
              ["planner_daily_max", "每日规划上限"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <Input
                  name={key}
                  type="number"
                  min={key === "auto_review_concurrency" ? "1" : "0"}
                  max={key === "auto_review_concurrency" ? "5" : undefined}
                  required
                  defaultValue={q.data![key!]}
                />
              </label>
            ))}
            <label>
              保持唤醒
              <NativeSelect name="keep_awake" defaultValue={q.data.keep_awake}>
                <option value="1">开启</option>
                <option value="0">关闭</option>
              </NativeSelect>
            </label>
            <p>冷却截止时间：{q.data.cooldown_until || "无冷却"}</p>
            <Button
              type="button"
              variant="outline"
              disabled={!q.data.cooldown_until || action.isPending}
              onClick={() =>
                action.mutate({
                  path: "/settings",
                  method: "PUT",
                  body: { cooldown_until: "" },
                })
              }
            >
              清除冷却
            </Button>
            <Button disabled={action.isPending}>保存设置</Button>
            {action.isSuccess && <p role="status">设置已保存</p>}
          </form>
        )}
      </Load>
      </TabsContent>
      <TabsContent value="projects"><SettingsProjects /></TabsContent>
      </Tabs>
    </>
  );

  function changeTab(value: string) {
    const next = value === "projects" ? "projects" : "settings";
    setTab(next);
    const params = new URLSearchParams(location.search);
    if (next === "settings") params.delete("tab");
    else params.set("tab", next);
    navigate({ pathname: location.pathname, search: params.toString() ? `?${params}` : "", hash: location.hash }, { replace: true });
  }
}

function selectedSettingsTab(search = window.location.search): "settings" | "projects" {
  return new URLSearchParams(search).get("tab") === "projects" ? "projects" : "settings";
}
