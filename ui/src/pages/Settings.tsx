import { UsageSnapshots } from "../components/UsageSnapshots";
import { RoutingConsole } from "../components/RoutingConsole";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "../lib/api";
import { useProjects } from "../lib/queries";
import type { Project } from "../lib/types";
import { ExecutorSelect } from "../components/ExecutorSelect";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { Load, useAction, ActionError } from "../components/PageSupport";
export function Settings() {
  const q = useQuery({
    queryKey: ["settings"],
    queryFn: () => request<Record<string, string>>("/settings"),
  });
  const projects = useProjects(),
    action = useAction();
  const [promoting, setPromoting] = useState<Project | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>设置</h1>
          <p>执行器、审查与项目配置。</p>
        </div>
      </div>
      <RoutingConsole />
      <UsageSnapshots />
      <ActionError error={action.error} />
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
              编码执行器（全局默认，自动审查驳回后重派也使用它）
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
              审查与规划模型
              <NativeSelect
                name="reviewer"
                defaultValue={q.data.reviewer || "codex"}
              >
                <option value="codex">Codex</option>
                <option value="claude">Claude</option>
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
      <section className="page-section">
        <h2>项目</h2>
        <Load pending={projects.isPending} error={projects.error}>
          {!projects.data?.length && <p>暂无项目</p>}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>项目</th>
                  <th>仓库路径</th>
                  <th>基础分支</th>
                  <th>测试命令</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {projects.data?.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.key}{" "}
                      {!!p.auto_review && (
                        <span className="badge">自动审查</span>
                      )}{" "}
                      {!!p.autopilot && <span className="badge">自动驾驶</span>}
                    </td>
                    <td>{p.repo_path}</td>
                    <td>
                      {p.base_branch}
                      {p.integration_branch && (
                        <p>
                          {p.integration_branch} · 领先{" "}
                          {p.ahead_of_base ?? "未知"} 个提交
                        </p>
                      )}
                    </td>
                    <td>{p.test_cmd || "—"}</td>
                    <td>
                      {p.integration_branch && (
                        <Button
                          variant="outline"
                          onClick={() => setPromoting(p)}
                        >
                          合并集成分支到 {p.base_branch}
                        </Button>
                      )}
                      <Button variant="ghost" onClick={() => setEditing(p)}>
                        编辑
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Load>
      </section>
      <Dialog
        open={!!promoting}
        onOpenChange={(v) => {
          if (!v) setPromoting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认合并到 {promoting?.base_branch}</DialogTitle>
            <DialogDescription>
              以下提交将进入基础分支，请确认。
            </DialogDescription>
          </DialogHeader>
          <pre>{promoting?.integration_commits || "无新增提交"}</pre>
          <ActionError error={action.error} />
          <Button
            disabled={action.isPending}
            onClick={() =>
              action.mutate(
                {
                  path: `/projects/${encodeURIComponent(promoting!.key)}/promote`,
                  body: { confirm: true },
                },
                { onSuccess: () => setPromoting(null) },
              )
            }
          >
            确认合并
          </Button>
        </DialogContent>
      </Dialog>
      {editing && (
        <ProjectEditor project={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
function ProjectEditor({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const action = useAction();
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !action.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑项目 {project.key}</DialogTitle>
          <DialogDescription>配置仓库与测试命令。</DialogDescription>
        </DialogHeader>
        <form
          className="task-form"
          onSubmit={(e) => {
            e.preventDefault();
            action.mutate(
              {
                path: `/projects/${encodeURIComponent(project.key)}`,
                method: "PATCH",
                body: (() => {
                  const f = new FormData(e.currentTarget);
                  return {
                    ...Object.fromEntries(f),
                    auto_review: f.has("auto_review") ? 1 : 0,
                    autopilot: f.has("autopilot") ? 1 : 0,
                    autopilot_rank: Number(f.get("autopilot_rank")),
                  };
                })(),
              },
              { onSuccess: onClose },
            );
          }}
        >
          {(
            [
              "name",
              "repo_path",
              "base_branch",
              "test_cmd",
              "setup_cmd",
            ] as const
          ).map((k, i) => (
            <label key={k}>
              {["名称", "仓库路径", "基础分支", "测试命令", "初始化命令"][i]}
              <Input
                name={k}
                required={i < 3}
                defaultValue={project[k] ?? ""}
              />
            </label>
          ))}
          <label>
            <input
              type="checkbox"
              name="auto_review"
              defaultChecked={!!project.auto_review}
            />
            自动审查
          </label>
          <label>
            <input
              type="checkbox"
              name="autopilot"
              defaultChecked={!!project.autopilot}
            />
            自动驾驶
          </label>
          <label>
            编码执行器（覆盖全局）
            <ExecutorSelect
              name="coding_executor"
              label="项目编码执行器"
              inheritLabel="继承全局"
              value={project.coding_executor ?? ""}
            />
          </label>
          <label>
            项目目标
            <textarea name="goal" defaultValue={project.goal || ""} />
          </label>
          <label>
            优先级
            <Input
              name="autopilot_rank"
              type="number"
              required
              defaultValue={project.autopilot_rank ?? 100}
            />
          </label>
          <label>
            共享上下文文件
            <Input
              name="context_file"
              defaultValue={project.context_file || ""}
            />
          </label>
          <ActionError error={action.error} />
          <Button disabled={action.isPending}>保存项目</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
