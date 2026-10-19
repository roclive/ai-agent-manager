import { TaskDrawer } from "./components/TaskDrawer";
import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Search, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import {
  useTasks,
  useRuns,
  useEventStream,
  useProjects,
  useExecutors,
  useBoardActivity,
} from "./lib/queries";
import { effectiveExecutor } from "./lib/executor";
import { api } from "./lib/api";
import { applyDrop } from "./lib/board";
import type { Task, TaskStatus } from "./lib/types";
import { KanbanBoard } from "./components/KanbanBoard";
import { NewTaskDialog } from "./components/NewTaskDialog";
import { Button } from "./components/ui/button";
import { Skeleton } from "./components/ui/skeleton";
import { Input } from "./components/ui/input";
import { ExecutorFilter } from "./components/ExecutorSelect";
import { BoardExecutorReviewer } from "./components/BoardExecutorReviewer";
import { NativeSelect } from "./components/ui/select";
export function BoardPage({ project }: { project: string }) {
  const live = useEventStream();
  const tasks = useTasks(live),
    runs = useRuns(live),
    projects = useProjects(),
    executors = useExecutors(),
    activity = useBoardActivity(live);
  const client = useQueryClient();
  const [search, setSearch] = useState(""),
    [worker, setWorker] = useState(""),
    [priority, setPriority] = useState("");
  const [creating, setCreating] = useState<TaskStatus | null>(null),
    [toast, setToast] = useState(""),
    [pending, setPending] = useState(false);
  const moving = useRef(false);
  const move = async (
    id: number,
    patch: { status: TaskStatus; sort_order: number },
  ) => {
    if (moving.current) return;
    moving.current = true;
    setPending(true);
    setToast("");
    await client.cancelQueries({ queryKey: ["tasks"] });
    const snapshot = client.getQueryData<Task[]>(["tasks"]) ?? [];
    try {
      await applyDrop(snapshot, id, patch, api.patchTask, (items) =>
        client.setQueryData(["tasks"], items),
      );
    } catch (error) {
      const message = (error as Error).message;
      setToast(
        message === "Task has a running worker"
          ? "任务有正在运行的执行器，无法移动。"
          : `移动失败：${message}`,
      );
    } finally {
      moving.current = false;
      setPending(false);
      void client.invalidateQueries({ queryKey: ["tasks"] });
      void client.invalidateQueries({ queryKey: ["projects"] });
    }
  };
  const projectId = projects.data?.find((p) => p.key === project)?.id;
  const runSafeAction = async (action: "dispatch" | "review") => {
    setPending(true);
    setToast("");
    try {
      await (action === "dispatch" ? api.dispatchReady() : api.requestReview());
      await Promise.all([
        client.invalidateQueries({ queryKey: ["tasks"] }),
        client.invalidateQueries({ queryKey: ["runs"] }),
        client.invalidateQueries({ queryKey: ["board-activity"] }),
      ]);
    } catch (error) {
      setToast(`操作未执行：${(error as Error).message}`);
    } finally {
      setPending(false);
    }
  };
  const filtered = (tasks.data ?? []).filter(
    (t) =>
      (!project || t.project_id === projectId) &&
      (!worker ||
        effectiveExecutor(t, projects.data, executors.data)?.value === worker) &&
      (!priority || t.priority === priority) &&
      `${t.identifier} ${t.title} ${t.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>看板</h1>
          <p>跟进任务，从待办到完成。</p>
        </div>
        <BoardExecutorReviewer
          onExecutorChange={(value) =>
            void api
              .setExecutors({ coding_executor: value })
              .then(() => client.invalidateQueries({ queryKey: ["executors"] }))
              .catch((e: Error) => setToast(`切换执行器失败：${e.message}`))
          }
          onEffortChange={(value) =>
            void api
              .setExecutors({ worker_effort: value })
              .then(() => client.invalidateQueries({ queryKey: ["executors"] }))
              .catch((e: Error) => setToast(`切换思考强度失败：${e.message}`))
          }
          onError={setToast}
        />
        <Button onClick={() => setCreating("backlog")}>
          <Plus />
          新建任务
        </Button>
      </div>
      <div className="filters">
        <div className="search-field">
          <Search size={15} />
          <Input
            aria-label="搜索任务"
            placeholder="搜索任务…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ExecutorFilter value={worker} onChange={setWorker} />
        <NativeSelect
          aria-label="筛选优先级"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          <option value="">全部优先级</option>
          {["P0", "P1", "P2", "P3"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </NativeSelect>
        <span className="filter-count">
          {filtered.length} 个任务 · {live ? "实时更新" : "每 5 秒更新"}
          {!live && (
            <span className="reconnecting" role="status">
              {" "}
              · 重新连接中…
            </span>
          )}
        </span>
      </div>
      {toast && (
        <div className="toast" role="alert">
          {toast}
          <Button variant="ghost" onClick={() => setToast("")}>
            关闭
          </Button>
        </div>
      )}
      {activity.data?.active && (
        <section className="board-activity" aria-label="进行中活动">
          <h2>进行中</h2>
          {activity.data.active.map((item) => (
            <div className="activity-work" key={`${item.kind}-${item.activity_id}`}>
              <strong>{item.kind === "coding" ? "编码执行中" : "自动审查中"}</strong>
              <Link to={`?task=${encodeURIComponent(item.identifier)}`}>{item.identifier} {item.title}</Link>
              <span>状态：{item.status === "pending" ? "待完成（pending）" : "运行中（running）"}</span>
              {item.identity && <span>{item.kind === "review" ? "审查者" : "执行者"}：{item.identity}</span>}
              {item.worktree_path && <span title={item.worktree_path}>工作树：{item.worktree_path}</span>}
              {item.branch && <span>分支：{item.branch}</span>}
            </div>
          ))}
          {activity.data.idle && (
            <div className="idle-guidance" role="status">
              <span>当前无编码或自动审查活动：{activity.data.idle.reason}</span>
              {activity.data.idle.action && (
                <Button disabled={pending} variant="outline" onClick={() => void runSafeAction(activity.data!.idle!.action!)}>
                  {activity.data.idle.action === "dispatch" ? "安全派发就绪任务" : "请求自动审查"}
                </Button>
              )}
              {activity.data.idle.control && (
                <Link to="/settings">查看{activity.data.idle.control === "projects" ? "项目" : "全局"}设置</Link>
              )}
            </div>
          )}
        </section>
      )}
      {tasks.isPending || (!!project && projects.isPending) ? (
        <div role="status" aria-label="正在加载任务…" className="board-skeleton">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} data-testid="task-skeleton">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ))}
        </div>
      ) : tasks.isError ? (
        <div role="alert">
          无法加载任务：{tasks.error.message}
          <Button variant="outline" onClick={() => void tasks.refetch()}>
            重试
          </Button>
        </div>
      ) : (
        <KanbanBoard
          allTasks={tasks.data}
          projects={projects.data}
          executors={executors.data}
          tasks={filtered}
          runs={runs.data ?? []}
          onMove={(id, patch) => void move(id, patch)}
          onCreate={setCreating}
          disabled={pending}
        />
      )}
      {creating && (
        <NewTaskDialog
          status={creating}
          projects={projects.data ?? []}
          project={project}
          onClose={() => setCreating(null)}
        />
      )}
      <TaskDrawer />
    </>
  );
}
