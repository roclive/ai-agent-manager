// Adapted from paperclipai/paperclip (MIT)
import { WorkerBadge } from "./WorkerBadge";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Markdown from "react-markdown";
import { request } from "../lib/api";
import { useTasks } from "../lib/queries";
import {
  statuses,
  statusLabels,
  roleLabels,
  runStatusLabels,
  type TaskDetail,
} from "../lib/types";
import { deps } from "../lib/page-utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/select";
import { Load, useAction, ActionError } from "./PageSupport";
export function TaskDrawer() {
  const [params, setParams] = useSearchParams();
  const id = params.get("task");
  const detail = useQuery({
    queryKey: ["tasks", "detail", id],
    queryFn: () => request<TaskDetail>(`/tasks/${encodeURIComponent(id!)}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
  return (
    <Sheet
      open={!!id}
      onOpenChange={(open) => {
        if (!open) {
          const next = new URLSearchParams(params);
          next.delete("task");
          setParams(next);
        }
      }}
    >
      <SheetContent className="overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{detail.data?.identifier ?? id}</SheetTitle>
          <SheetDescription>任务详情</SheetDescription>
        </SheetHeader>
        <div className="p-5">
          <Load pending={detail.isPending} error={detail.error}>
            {detail.data && <Detail key={detail.data.id} task={detail.data} />}
          </Load>
        </div>
      </SheetContent>
    </Sheet>
  );
}
function Detail({ task }: { task: TaskDetail }) {
  const [tab, setTab] = useState("概览");
  const [description, setDescription] = useState(task.description);
  const action = useAction();
  const tasks = useTasks();
  const [note, setNote] = useState(""),
    [into, setInto] = useState(""),
    [confirm, setConfirm] = useState("");
  const patch = (body: unknown) =>
    action.mutate({ path: `/tasks/${task.id}`, method: "PATCH", body });
  const post = (path: string, body: unknown = {}) =>
    action.mutate({ path: `/tasks/${task.id}/${path}`, body });
  return (
    <>
      <div className="filters" role="tablist">
        {["概览", "运行记录", "日志", "审查"].map((t) => (
          <Button
            key={t}
            role="tab"
            aria-selected={tab === t}
            variant={tab === t ? "secondary" : "ghost"}
            onClick={() => setTab(t)}
          >
            {t}
          </Button>
        ))}
      </div>
      <ActionError error={action.error ?? tasks.error} />
      {tab === "概览" && (
        <>
          <form
            className="task-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              patch({
                title: f.get("title"),
                description: f.get("description"),
                status: f.get("status"),
                priority: f.get("priority"),
                role: f.get("role"),
                worker: f.get("worker"),
                max_attempts: Number(f.get("max_attempts")),
                depends_on: f.getAll("depends_on"),
              });
            }}
          >
            <label>
              标题
              <Input name="title" required defaultValue={task.title} />
            </label>
            <label>
              描述
              <Textarea
                name="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <details>
              <summary>Markdown 预览</summary>
              <Markdown>{description || "暂无描述"}</Markdown>
            </details>
            <div className="form-row">
              {[
                ["status", "状态", statuses],
                ["priority", "优先级", ["P0", "P1", "P2", "P3"]],
                ["role", "角色", Object.keys(roleLabels)],
                ["worker", "执行器", ["codex", "opencode"]],
              ].map(([key, label, values]) => (
                <label key={key as string}>
                  {label}
                  <NativeSelect
                    name={key as string}
                    defaultValue={String(task[key as keyof TaskDetail])}
                  >
                    {(values as readonly string[]).map((v) => (
                      <option key={v} value={v}>
                        {(statusLabels as Record<string, string>)[v] ??
                          (roleLabels as Record<string, string>)[v] ??
                          v}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              ))}
            </div>
            <label>
              依赖任务
              <select
                multiple
                name="depends_on"
                defaultValue={deps(task.depends_on)}
              >
                {tasks.data
                  ?.filter((t) => t.id !== task.id)
                  .map((t) => (
                    <option key={t.id} value={t.identifier}>
                      {t.identifier} · {t.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              最大尝试次数
              <Input
                type="number"
                min="1"
                required
                name="max_attempts"
                defaultValue={task.max_attempts}
              />
            </label>
            <Button
              disabled={action.isPending || tasks.isPending || tasks.isError}
            >
              保存更改
            </Button>
          </form>
          <dl className="metadata">
            {[
              ["分支", task.branch],
              ["工作目录", task.worktree_path],
              ["尝试次数", `${task.attempts}/${task.max_attempts}`],
              ["丢失次数", task.lost_count],
              ["阻碍", task.blocker],
              ["反馈", task.feedback],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <dt>{k}</dt>
                <dd>{v === "" || v == null ? "—" : v}</dd>
              </div>
            ))}
          </dl>
          <h2>事件时间线</h2>
          {task.events?.map((e) => (
            <p className="event-row" key={e.id}>
              <time>{e.ts}</time> {e.message}
            </p>
          ))}
        </>
      )}
      {tab === "运行记录" && (
        <>
          {!task.runs?.length && <p>暂无运行记录</p>}
          {task.runs?.map((r) => (
            <article className="event-row" key={r.id}>
              <strong>
                #{r.id} ·{" "}
                <WorkerBadge
                  kind={r.worker_kind}
                  label={r.worker_label ?? r.worker}
                />{" "}
                · {runStatusLabels[r.status]}
              </strong>
              <p>
                {r.started_at} → {r.ended_at ?? "运行中"} ·{" "}
                {Math.max(
                  0,
                  Math.floor(
                    (Date.parse(r.ended_at ?? new Date().toISOString()) -
                      Date.parse(r.started_at)) /
                      1000,
                  ),
                )}{" "}
                秒
              </p>
              <p>
                退出码 {r.exit_code ?? "—"} · 测试 {r.test_exit_code ?? "—"}
              </p>
              <p>{r.summary}</p>
            </article>
          ))}
        </>
      )}
      {tab === "日志" && <Logs task={task} />}
      {tab === "审查" && (
        <div className="task-form">
          <p>
            {task.status === "in_review"
              ? "等待人工审查"
              : "当前任务不在审查队列"}
          </p>
          <h2>变更统计</h2>
          <pre>{task.diff_stat || "暂无差异"}</pre>
          <h2>执行器最后消息</h2>
          <Markdown>{task.last_message || "暂无消息"}</Markdown>
          <p>测试退出码：{task.runs?.[0]?.test_exit_code ?? "未执行"}</p>
          <label>
            审查备注
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="filters">
            <Button
              disabled={action.isPending || task.status !== "in_review"}
              onClick={() => post("review", { verdict: "approve", note })}
            >
              批准
            </Button>
            <Button
              disabled={action.isPending || task.status !== "in_review"}
              variant="outline"
              onClick={() => post("review", { verdict: "reject", note })}
            >
              驳回
            </Button>
          </div>
          <label>
            目标集成分支（不能为基础分支）
            <Input value={into} onChange={(e) => setInto(e.target.value)} />
          </label>
          <Button
            disabled={!into.trim() || action.isPending}
            onClick={() => post("merge", { into })}
          >
            合并到集成分支
          </Button>
        </div>
      )}
      <div className="filters mt-6">
        {task.status === "blocked" && (
          <Button disabled={action.isPending} onClick={() => post("retry")}>
            再试一次
          </Button>
        )}
        <Button variant="outline" onClick={() => setConfirm("run")}>
          立即运行
        </Button>
        <Button variant="outline" onClick={() => setConfirm("cancel")}>
          取消运行
        </Button>
      </div>
      <Dialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认运行操作</DialogTitle>
            <DialogDescription>
              确认
              {confirm === "run" ? "立即运行此任务" : "取消正在运行的执行器"}？
            </DialogDescription>
          </DialogHeader>
          <Button
            disabled={action.isPending}
            onClick={() => {
              post(confirm);
              setConfirm("");
            }}
          >
            确认
          </Button>
          <Button variant="ghost" onClick={() => setConfirm("")}>
            返回
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
function Logs({ task }: { task: TaskDetail }) {
  const [run, setRun] = useState(String(task.runs?.[0]?.id ?? "")),
    [kind, setKind] = useState("log"),
    [tail, setTail] = useState("100");
  const end = useRef<HTMLDivElement>(null);
  const log = useQuery({
    queryKey: ["logs", run, kind, tail],
    queryFn: () =>
      request<{ log: string }>(`/runs/${run}/${kind}?tail=${tail}`),
    enabled: !!run,
    refetchInterval:
      task.runs?.find((r) => String(r.id) === run)?.status === "running"
        ? 2000
        : false,
  });
  useEffect(
    () => end.current?.scrollIntoView?.({ block: "nearest" }),
    [log.data],
  );
  return (
    <>
      <div className="filters">
        <NativeSelect
          aria-label="运行"
          value={run}
          onChange={(e) => setRun(e.target.value)}
        >
          {task.runs?.map((r) => (
            <option key={r.id} value={r.id}>
              #{r.id} {runStatusLabels[r.status]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="日志类型"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="log">执行器日志</option>
          <option value="test-log">测试日志</option>
        </NativeSelect>
        <NativeSelect
          aria-label="尾部行数"
          value={tail}
          onChange={(e) => setTail(e.target.value)}
        >
          {[100, 500, 1000].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </NativeSelect>
      </div>
      {!run ? (
        <p>暂无运行日志</p>
      ) : (
        <Load pending={log.isPending} error={log.error}>
          <pre className="log-viewer">
            {log.data?.log || "日志为空"}
            <div ref={end} />
          </pre>
        </Load>
      )}
    </>
  );
}
