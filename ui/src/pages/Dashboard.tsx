// Adapted from paperclipai/paperclip (MIT)
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, CheckCheck, Play, AlertTriangle } from "lucide-react";
import { useTasks, useRuns, useStatus, useProjects } from "../lib/queries";
import { request } from "../lib/api";
import { type Event, statuses, statusLabels } from "../lib/types";
import { remainingSeconds } from "../lib/page-utils";
import { MetricCard } from "../components/MetricCard";
import { Button } from "../components/ui/button";
import { Load, ActionError, useAction } from "../components/PageSupport";
export function Cooldown({ until }: { until: string | null | undefined }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = remainingSeconds(until, now);
  return seconds > 0 ? (
    <div role="status" className="cooldown-banner">
      执行器冷却中 · 剩余 {Math.floor(seconds / 60)} 分 {seconds % 60} 秒
    </div>
  ) : null;
}
export function Dashboard({ project }: { project: string }) {
  const tasks = useTasks(),
    runs = useRuns(),
    status = useStatus(),
    projects = useProjects(),
    action = useAction();
  const events = useQuery({
    queryKey: ["events"],
    queryFn: () => request<Event[]>("/events?limit=20"),
    refetchInterval: 5000,
  });
  const projectId = projects.data?.find((p) => p.key === project)?.id;
  const rows = (tasks.data ?? []).filter(
    (t) => !project || t.project_id === projectId,
  );
  const running = (runs.data ?? []).filter(
    (r) => r.status === "running" && rows.some((t) => t.id === r.task_id),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>总览</h1>
          <p>
            {status.data?.daemon.running ? "守护进程运行中" : "守护进程已停止"}{" "}
            · 上次心跳{" "}
            {status.data?.daemon.last_tick_at
              ? new Date(status.data.daemon.last_tick_at).toLocaleString(
                  "zh-CN",
                )
              : "尚无记录"}
          </p>
        </div>
        <Button
          disabled={action.isPending}
          onClick={() => action.mutate({ path: "/tick" })}
        >
          立即心跳
        </Button>
      </div>
      <ActionError error={action.error} />
      <Cooldown until={status.data?.cooldown_until} />
      <Load
        pending={tasks.isPending || runs.isPending}
        error={tasks.error ?? runs.error ?? status.error}
      >
        <div className="metric-strip">
          <MetricCard
            icon={Play}
            value={running.length}
            label="运行中的执行器"
          />
          <MetricCard icon={Activity} value={rows.length} label="全部任务" />
          <MetricCard
            icon={CheckCheck}
            value={rows.filter((t) => t.status === "in_review").length}
            label="等待审查"
          />
          <MetricCard
            icon={AlertTriangle}
            value={rows.filter((t) => t.status === "blocked").length}
            label="受阻任务"
          />
        </div>
        <section className="page-section">
          <h2>任务状态</h2>
          <div className="status-bars">
            {statuses.map((s) => {
              const n = rows.filter((t) => t.status === s).length;
              return (
                <div key={s}>
                  <span>{statusLabels[s]}</span>
                  <progress value={n} max={Math.max(1, rows.length)} />
                  <b>{n}</b>
                </div>
              );
            })}
          </div>
        </section>
        <section className="page-section">
          <h2>运行中的执行器</h2>
          {running.length === 0 && <p>暂无运行中的执行器</p>}
          {running.map((r) => (
            <div className="event-row" key={r.id}>
              <Link
                to={`/board?task=${rows.find((t) => t.id === r.task_id)?.identifier}`}
              >
                {rows.find((t) => t.id === r.task_id)?.identifier} ·{" "}
                {rows.find((t) => t.id === r.task_id)?.title}
              </Link>
              <span>
                {r.worker} · 已运行{" "}
                {Math.floor((Date.now() - Date.parse(r.started_at)) / 60000)}{" "}
                分钟
              </span>
            </div>
          ))}
        </section>
        <section className="page-section">
          <h2>审查队列</h2>
          {!rows.some((t) => t.status === "in_review") && <p>暂无待审查任务</p>}
          {rows
            .filter((t) => t.status === "in_review")
            .map((t) => (
              <div className="event-row" key={t.id}>
                <Link to={`/board?task=${t.identifier}`}>
                  {t.identifier} · {t.title}
                </Link>
                <div className="filters">
                  <Button
                    disabled={action.isPending}
                    size="sm"
                    onClick={() =>
                      action.mutate({
                        path: `/tasks/${t.id}/review`,
                        body: { verdict: "approve", note: "" },
                      })
                    }
                  >
                    批准
                  </Button>
                  <Button
                    disabled={action.isPending}
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      action.mutate({
                        path: `/tasks/${t.id}/review`,
                        body: { verdict: "reject", note: "" },
                      })
                    }
                  >
                    驳回
                  </Button>
                </div>
              </div>
            ))}
        </section>
        <section className="page-section">
          <h2>受阻任务</h2>
          {!rows.some((t) => t.status === "blocked") && <p>暂无受阻任务</p>}
          {rows
            .filter((t) => t.status === "blocked")
            .map((t) => (
              <div className="event-row" key={t.id}>
                <Link to={`/board?task=${t.identifier}`}>
                  {t.identifier} · {t.title}
                </Link>
                <p>{t.blocker || "未提供原因"}</p>
              </div>
            ))}
        </section>
        <section className="page-section">
          <h2>最近活动</h2>
          <Load pending={events.isPending} error={events.error}>
            {!events.data?.length && <p>暂无活动</p>}
            {events.data
              ?.filter((e) => !project || rows.some((t) => t.id === e.task_id))
              .map((e) => (
                <p className="event-row" key={e.id}>
                  <time>{new Date(e.ts).toLocaleString("zh-CN")}</time>{" "}
                  {e.message}
                </p>
              ))}
          </Load>
        </section>
      </Load>
    </>
  );
}
