// Adapted from paperclipai/paperclip (MIT)
import { ProjectChip } from "../components/ProjectChip";
import { priorityLabels, workerLabels } from "../lib/types";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTasks, useProjects } from "../lib/queries";
import { statuses, statusLabels, roleLabels, type Task } from "../lib/types";
import { deps } from "../lib/page-utils";
import { request } from "../lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TaskDrawer } from "../components/TaskDrawer";
import { NewTaskDialog } from "../components/NewTaskDialog";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/select";
import { Button } from "../components/ui/button";
import { Load, ActionError, useAction } from "../components/PageSupport";
export async function bulkMove(ids: number[], status: string) {
  const results = await Promise.allSettled(
    ids.map((id) =>
      request(`/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    ),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length)
    throw new Error(
      `${failed.length} 个任务移动失败：${(failed[0] as PromiseRejectedResult).reason instanceof Error ? (failed[0] as PromiseRejectedResult).reason.message : "未知错误"}。已成功的任务保留更改。`,
    );
  return results;
}
export function Backlog({ project }: { project: string }) {
  const tasks = useTasks(),
    projects = useProjects(),
    action = useAction(),
    client = useQueryClient();
  const [text, setText] = useState(""),
    [status, setStatus] = useState(""),
    [sort, setSort] = useState("priority"),
    [selected, setSelected] = useState<number[]>([]),
    [creating, setCreating] = useState(false);
  const bulk = useMutation({
    mutationFn: (status: string) => bulkMove(selected, status),
    onSuccess: () => setSelected([]),
    onSettled: () => {
      void client.invalidateQueries();
    },
  });
  const projectId = projects.data?.find((p) => p.key === project)?.id;
  const rows = (tasks.data ?? [])
    .filter(
      (t) =>
        (!project || t.project_id === projectId) &&
        (!status || t.status === status) &&
        `${t.identifier} ${t.title}`.toLowerCase().includes(text.toLowerCase()),
    )
    .sort(
      (a, b) =>
        String(a[sort as keyof Task]).localeCompare(
          String(b[sort as keyof Task]),
        ) * (sort === "updated_at" ? -1 : 1),
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>待办</h1>
          <p>{rows.length} 个任务</p>
        </div>
        <Button onClick={() => setCreating(true)}>新建任务</Button>
      </div>
      <div className="filters">
        <Input
          aria-label="搜索任务"
          placeholder="搜索任务…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <NativeSelect
          aria-label="筛选状态"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">全部状态</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {statusLabels[s]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="排序"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="priority">按优先级</option>
          <option value="updated_at">最近更新</option>
          <option value="identifier">按编号</option>
          <option value="title">按标题</option>
        </NativeSelect>
      </div>
      {selected.length > 0 && (
        <div className="filters">
          <span>已选 {selected.length} 项</span>
          {["ready", "backlog", "cancelled"].map((s) => (
            <Button
              disabled={bulk.isPending}
              key={s}
              variant="outline"
              onClick={() => bulk.mutate(s)}
            >
              移至{statusLabels[s as Task["status"]]}
            </Button>
          ))}
          <Button variant="ghost" onClick={() => setSelected([])}>
            清除选择
          </Button>
        </div>
      )}
      <ActionError error={bulk.error ?? action.error} />
      <Load pending={tasks.isPending} error={tasks.error}>
        {!rows.length && <p className="empty-message">暂无符合条件的任务</p>}
        {statuses
          .filter((s) => rows.some((t) => t.status === s))
          .map((s) => (
            <details open key={s} className="list-group">
              <summary>
                {statusLabels[s]} · {rows.filter((t) => t.status === s).length}
              </summary>
              <div className="table-scroll">
                <table className="backlog-table">
                  <thead>
                    <tr>
                      {[
                        "选择",
                        "ID / 标题",
                        "项目",
                        "优先级",
                        "角色",
                        "执行器",
                        "状态",
                        "依赖",
                        "更新时间",
                      ].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows
                      .filter((t) => t.status === s)
                      .map((t) => (
                        <tr key={t.id}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`选择 ${t.identifier}`}
                              checked={selected.includes(t.id)}
                              onChange={(e) =>
                                setSelected(
                                  e.target.checked
                                    ? [...selected, t.id]
                                    : selected.filter((id) => id !== t.id),
                                )
                              }
                            />
                          </td>
                          <td>
                            <Link to={`?task=${t.identifier}`}>
                              {t.identifier}
                            </Link>
                            <Link
                              className="backlog-title"
                              to={`?task=${t.identifier}`}
                            >
                              {t.title}
                              {t.status === "done" && t.integrated === 0 && (
                                <span className="badge">待集成</span>
                              )}
                              {!!t.resolves_task_id &&
                                !["done", "cancelled"].includes(t.status) && (
                                  <span className="badge">冲突解决中</span>
                                )}
                            </Link>
                          </td>
                          <td>
                            <ProjectChip
                              projectKey={
                                projects.data?.find(
                                  (p) => p.id === t.project_id,
                                )?.key ??
                                t.identifier.slice(
                                  0,
                                  t.identifier.lastIndexOf("-"),
                                )
                              }
                            />
                          </td>
                          {(
                            ["priority", "role", "worker", "status"] as const
                          ).map((k) => (
                            <td key={k}>
                              {k === "role" ? (
                                roleLabels[t.role]
                              ) : (
                                <NativeSelect
                                  aria-label={`${t.identifier} ${k}`}
                                  value={t[k]}
                                  disabled={action.isPending}
                                  onChange={(e) =>
                                    action.mutate({
                                      path: `/tasks/${t.id}`,
                                      method: "PATCH",
                                      body: { [k]: e.target.value },
                                    })
                                  }
                                >
                                  {(k === "priority"
                                    ? ["P0", "P1", "P2", "P3"]
                                    : k === "worker"
                                      ? ["codex", "opencode"]
                                      : statuses
                                  ).map((v) => (
                                    <option key={v} value={v}>
                                      {statusLabels[v as Task["status"]] ??
                                        priorityLabels[v] ??
                                        workerLabels[v] ??
                                        v}
                                    </option>
                                  ))}
                                </NativeSelect>
                              )}
                            </td>
                          ))}
                          <td>{deps(t.depends_on).join(", ") || "—"}</td>
                          <td>
                            {new Date(t.updated_at).toLocaleString("zh-CN")}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
      </Load>
      <TaskDrawer />
      {creating && (
        <NewTaskDialog
          project={project}
          projects={projects.data ?? []}
          status="backlog"
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}
