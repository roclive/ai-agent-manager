// Adapted from paperclipai/paperclip (MIT)
import { WorkerBadge } from "./WorkerBadge";
import { ExecutorBadge } from "./ExecutorSelect";
import { effectiveExecutor } from "../lib/executor";
import { ProjectChip } from "./ProjectChip";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  GripVertical,
} from "lucide-react";
import {
  statuses,
  statusLabels,
  roleLabels,
  type Task,
  type TaskStatus,
  type Run,
  type Project,
  type ExecutorsView,
} from "../lib/types";
import { groupTasks, planDrop } from "../lib/board";
import { StatusIcon } from "./StatusIcon";
import { PriorityIcon } from "./PriorityIcon";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
function dependencies(task: Task): string[] {
  try {
    return typeof task.depends_on === "string"
      ? JSON.parse(task.depends_on)
      : task.depends_on;
  } catch {
    return [];
  }
}
const isLive = (r: Run) => r.status === "running" && r.live !== false;
// Lets the timer render from /api/tasks alone, before /api/runs arrives.
function lastRunAsRun(t: Task): Run | undefined {
  const r = t.last_run;
  return r && r.status === "running" && r.live !== false
    ? ({
        id: r.id,
        task_id: t.id,
        worker: t.worker,
        status: "running",
        started_at: r.started_at,
        ended_at: null,
        summary: null,
        live: true,
      } as Run)
    : undefined;
}
function Running({ run }: { run: Run }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(
    0,
    Math.floor((now - Date.parse(run.started_at)) / 1000),
  );
  return (
    <span className="running">
      <i />
      {`运行中 · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}
    </span>
  );
}
type ExecutorCtx = {
  projects?: Pick<Project, "id" | "coding_executor">[];
  executors?: Pick<ExecutorsView, "coding_executor">;
};
// Pending cards show the executor that dispatch will use; started work keeps its historical worker badge.
const isPending = (t: Task) => t.status === "backlog" || t.status === "ready";
function KanbanCard({
  task,
  run,
  ctx,
}: {
  task: Task;
  run?: Run;
  ctx: ExecutorCtx;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });
  return (
    <Card
      ref={setNodeRef}
      onPointerDown={(event) => {
        if (
          !(event.target as HTMLElement).closest(
            "a,button,input,select,textarea",
          )
        )
          listeners?.onPointerDown?.(event);
      }}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
      }}
      className="task-card"
      title={task.dependency_waiting || undefined}
    >
      <div className="card-meta">
        <ProjectChip
          projectKey={task.identifier.slice(
            0,
            task.identifier.lastIndexOf("-"),
          )}
        />
        <span>{task.identifier}</span>
        <PriorityIcon priority={task.priority} />
        <button
          {...attributes}
          {...listeners}
          className="drag-handle"
          aria-describedby={`drag-hint-${task.id}`}
          aria-label={`拖动 ${task.identifier} 到任意状态栏`}
          title="拖动到任意状态栏以更改任务状态"
        >
          <span className="keyboard-drag-hint" id={`drag-hint-${task.id}`}>
            按空格开始拖动，方向键选择目标任务或状态栏，再按空格放下。
          </span>
          <GripVertical size={14} />
        </button>
      </div>
      <Link
        className="task-title"
        to={`?task=${encodeURIComponent(task.identifier)}`}
      >
        {task.title}
        {task.status === "done" && task.integrated === 0 && (
          <span className="badge">待集成</span>
        )}
        {!!task.resolves_task_id &&
          !["done", "cancelled"].includes(task.status) && (
            <span className="badge">冲突解决中</span>
          )}
      </Link>
      <div className="card-tags">
        {isPending(task) ? (
          <span data-testid={`card-executor-${task.identifier}`}>
            <ExecutorBadge
              effective={effectiveExecutor(task, ctx.projects, ctx.executors)}
            />
          </span>
        ) : task.latest_worker ? (
          <WorkerBadge
            kind={task.latest_worker.kind}
            label={task.latest_worker.label}
          />
        ) : (
          <Badge variant="secondary">{task.worker}</Badge>
        )}
        <span>{roleLabels[task.role]}</span>
        <span className="ml-auto">
          {task.attempts}/{task.max_attempts} 次
        </span>
      </div>
      {dependencies(task).length > 0 && (
        <div className="card-tags">
          依赖{" "}
          {dependencies(task).map((d) => (
            <Badge key={d} variant="outline">
              {d}
            </Badge>
          ))}
        </div>
      )}
      {task.blocker && (
        <p className="blocker">
          <AlertTriangle size={13} />
          {task.blocker}
        </p>
      )}
      {run && <Running run={run} />}
    </Card>
  );
}
function KanbanColumn({
  status,
  tasks,
  runs,
  onCreate,
  ctx,
}: {
  status: TaskStatus;
  tasks: Task[];
  runs: Run[];
  onCreate: (s: TaskStatus) => void;
  ctx: ExecutorCtx;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const [collapsed, setCollapsed] = useState(status === "cancelled");
  return (
    <section
      ref={setNodeRef}
      className={`kanban-column ${collapsed ? "collapsed" : ""} ${isOver ? "over" : ""}`}
      data-status={status}
      aria-label={statusLabels[status]}
    >
      <header>
        <StatusIcon status={status} />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="column-label"
        >
          {statusLabels[status]}
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
        {isOver && <span className="drop-target-label">放到这里</span>}
        <span className="column-count">{tasks.length}</span>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`在${statusLabels[status]}新建任务`}
          onClick={() => onCreate(status)}
        >
          <Plus />
        </Button>
      </header>
      {!collapsed && (
        <div className="column-body">
          <SortableContext
            items={tasks.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {tasks.map((t) => (
              <KanbanCard
                key={t.id}
                task={t}
                ctx={ctx}
                run={
                  runs.find((r) => r.task_id === t.id && isLive(r)) ??
                  t.runs?.find(isLive) ??
                  lastRunAsRun(t)
                }
              />
            ))}
          </SortableContext>
          {tasks.length === 0 && <p className="column-empty">拖动任务至此</p>}
        </div>
      )}
    </section>
  );
}
export function KanbanBoard({
  tasks,
  runs,
  onMove,
  onCreate,
  disabled = false,
  allTasks = tasks,
  projects,
  executors,
}: {
  tasks: Task[];
  runs: Run[];
  onMove: (
    id: number,
    patch: { status: TaskStatus; sort_order: number },
  ) => void;
  onCreate: (status: TaskStatus) => void;
  disabled?: boolean;
  allTasks?: Task[];
  projects?: ExecutorCtx["projects"];
  executors?: ExecutorCtx["executors"];
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const grouped = groupTasks(tasks);
  const dragEnd = (event: DragEndEvent) => {
    if (disabled || !event.over) return;
    const patch = planDrop(allTasks, Number(event.active.id), event.over.id);
    if (patch) onMove(Number(event.active.id), patch);
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragEnd={dragEnd}
    >
      <div className="kanban-board" aria-busy={disabled}>
        {statuses.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            tasks={grouped[status]}
            runs={runs}
            onCreate={onCreate}
            ctx={{ projects, executors }}
          />
        ))}
      </div>
    </DndContext>
  );
}
