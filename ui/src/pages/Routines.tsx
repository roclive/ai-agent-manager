// Adapted from paperclipai/paperclip (MIT)
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "../lib/api";
import { useProjects } from "../lib/queries";
import { roleLabels, type Routine, type Event, type Role } from "../lib/types";
import {
  cronPresets,
  cronDescription,
  routinePayload,
} from "../lib/page-utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { NativeSelect } from "../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { Load, ActionError, useAction } from "../components/PageSupport";
export function Routines() {
  const query = useQuery({
    queryKey: ["routines"],
    queryFn: () => request<Routine[]>("/routines"),
    refetchInterval: 10000,
  });
  const action = useAction();
  const [editing, setEditing] = useState<Routine | null | undefined>(),
    [deleting, setDeleting] = useState<Routine | null>(null);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>定时任务</h1>
          <p>按计划触发心跳、创建任务或运行命令。</p>
        </div>
        <Button onClick={() => setEditing(null)}>新建定时任务</Button>
      </div>
      <ActionError error={action.error} />
      <Load pending={query.isPending} error={query.error}>
        {!query.data?.length && <p className="empty-message">暂无定时任务</p>}
        {query.data?.map((r) => (
          <section className="routine-row" key={r.id}>
            <div className="routine-main">
              <div>
                <h2>{r.name}</h2>
                <p>
                  {
                    {
                      heartbeat: "心跳",
                      create_task: "创建任务",
                      shell: "Shell 命令",
                    }[r.action]
                  }{" "}
                  · {r.cron} · {cronDescription(r.cron)}
                </p>
                <p>
                  下次运行：
                  {r.next_run_at
                    ? new Date(r.next_run_at).toLocaleString("zh-CN")
                    : "—"}{" "}
                  · 上次运行：
                  {r.last_run_at
                    ? new Date(r.last_run_at).toLocaleString("zh-CN")
                    : "尚未运行"}
                </p>
              </div>
              <div className="filters">
                <label>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`启用 ${r.name}`}
                    checked={!!r.enabled}
                    disabled={action.isPending}
                    onChange={(e) =>
                      action.mutate({
                        path: `/routines/${r.id}`,
                        method: "PATCH",
                        body: { enabled: e.target.checked },
                      })
                    }
                  />{" "}
                  启用
                </label>
                <Button
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({ path: `/routines/${r.id}/run` })
                  }
                >
                  立即运行
                </Button>
                <Button variant="ghost" onClick={() => setEditing(r)}>
                  编辑
                </Button>
                <Button variant="ghost" onClick={() => setDeleting(r)}>
                  删除
                </Button>
              </div>
            </div>
            <details>
              <summary>最近 20 次触发</summary>
              <Firings id={r.id} />
            </details>
          </section>
        ))}
      </Load>
      {editing !== undefined && (
        <RoutineEditor
          routine={editing}
          onClose={() => setEditing(undefined)}
        />
      )}
      <Dialog
        open={!!deleting}
        onOpenChange={(v) => {
          if (!v) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除定时任务</DialogTitle>
            <DialogDescription>
              确认删除「{deleting?.name}」？此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <Button
            disabled={action.isPending}
            onClick={() => {
              action.mutate(
                { path: `/routines/${deleting!.id}`, method: "DELETE" },
                { onSuccess: () => setDeleting(null) },
              );
            }}
          >
            确认删除
          </Button>
          <ActionError error={action.error} />
        </DialogContent>
      </Dialog>
    </>
  );
}
function Firings({ id }: { id: number }) {
  const q = useQuery({
    queryKey: ["routines", id, "runs"],
    queryFn: () => request<Event[]>(`/routines/${id}/runs`),
    refetchInterval: 10000,
  });
  return (
    <Load pending={q.isPending} error={q.error}>
      {!q.data?.length && <p>暂无触发记录</p>}
      {q.data?.map((e) => (
        <p className="event-row" key={e.id}>
          {e.ts} · {e.message}
        </p>
      ))}
    </Load>
  );
}
export function RoutineEditor({
  routine,
  onClose,
}: {
  routine: Routine | null;
  onClose: () => void;
}) {
  const projects = useProjects(),
    action = useAction();
  const initial = routine
    ? typeof routine.payload === "string"
      ? JSON.parse(routine.payload)
      : routine.payload
    : {};
  const [name, setName] = useState(routine?.name ?? ""),
    [cron, setCron] = useState(routine?.cron ?? "*/5 * * * *"),
    [kind, setKind] = useState(routine?.action ?? "heartbeat"),
    [fields, setFields] = useState<Record<string, string>>({
      project: projects.data?.[0]?.key ?? "",
      title: "",
      description: "",
      priority: "P1",
      role: "any",
      worker: "codex",
      cmd: "",
      cwd: "",
      ...initial,
    });
  useEffect(() => {
    if (!fields.project && projects.data?.[0])
      setFields((f) => ({ ...f, project: projects.data![0].key }));
  }, [projects.data, fields.project]);
  const field = (key: string, label: string, options?: string[]) => (
    <label key={key}>
      {label}
      {options ? (
        <NativeSelect
          required
          value={fields[key]}
          onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
        >
          {options.map((v) => (
            <option key={v} value={v}>
              {key === "role" ? roleLabels[v as Role] : v}
            </option>
          ))}
        </NativeSelect>
      ) : key === "description" ? (
        <Textarea
          value={fields[key]}
          onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
        />
      ) : (
        <Input
          required
          value={fields[key]}
          onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
        />
      )}
    </label>
  );
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !action.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{routine ? "编辑" : "新建"}定时任务</DialogTitle>
          <DialogDescription>时间按本机时区执行。</DialogDescription>
        </DialogHeader>
        <form
          className="task-form"
          onSubmit={(e) => {
            e.preventDefault();
            action.mutate(
              {
                path: routine ? `/routines/${routine.id}` : "/routines",
                method: routine ? "PATCH" : "POST",
                body: {
                  name,
                  cron,
                  action: kind,
                  payload: routinePayload(kind, fields),
                },
              },
              { onSuccess: onClose },
            );
          }}
        >
          <label>
            名称
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            计划预设
            <NativeSelect
              value={Object.hasOwn(cronPresets, cron) ? cron : ""}
              onChange={(e) => setCron(e.target.value)}
            >
              {Object.entries(cronPresets).map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
              <option value="">自定义</option>
            </NativeSelect>
          </label>
          <label>
            Cron 表达式
            <Input
              required
              value={cron}
              onChange={(e) => setCron(e.target.value)}
            />
          </label>
          <p>{cronDescription(cron)}</p>
          <label>
            动作
            <NativeSelect
              value={kind}
              onChange={(e) => setKind(e.target.value as Routine["action"])}
            >
              <option value="heartbeat">心跳</option>
              <option value="create_task">创建任务</option>
              <option value="shell">Shell 命令</option>
            </NativeSelect>
          </label>
          {kind === "shell" && (
            <>
              <p role="note" className="cooldown-banner">
                Shell 定时任务以你的用户权限执行，请确认命令和工作目录可信。
              </p>
              {field("cmd", "命令")}
              {field("cwd", "工作目录")}
            </>
          )}
          {kind === "create_task" && (
            <>
              {field("project", "项目", projects.data?.map((p) => p.key) ?? [])}
              {field("title", "任务标题")}
              {field("description", "描述")}
              {field("priority", "优先级", ["P0", "P1", "P2", "P3"])}
              {field("role", "角色", ["any", "backend", "frontend", "testing"])}
              {field("worker", "执行器", ["codex", "opencode"])}
            </>
          )}
          <ActionError error={action.error} />
          <Button disabled={action.isPending || !name.trim() || !cron.trim()}>
            保存定时任务
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
