import { Link } from "react-router-dom";
import { TaskDrawer } from "../components/TaskDrawer";
import { useTasks } from "../lib/queries";
import { eventLabels, eventMessage } from "../lib/events";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { request } from "../lib/api";
import type { Event } from "../lib/types";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/select";
import { Button } from "../components/ui/button";
import { Load } from "../components/PageSupport";
export function ActivityPage({ project }: { project: string }) {
  const tasks = useTasks();
  const [kind, setKind] = useState("");
  const [task, setTask] = useState("");
  const q = useInfiniteQuery({
    queryKey: ["events", "activity", kind, task, project],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "50", kind, task, project });
      if (pageParam !== null) params.set("before", String(pageParam));
      return request<Event[]>(`/events?${params}`);
    },
    getNextPageParam: (last) =>
      last.length === 50 ? last.at(-1)!.id : undefined,
    refetchInterval: 5000,
  });
  const rows = [
    ...new Map(q.data?.pages.flat().map((e) => [e.id, e])).values(),
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>活动</h1>
          <p>工作空间事件 · 实时更新</p>
        </div>
      </div>
      <div className="filters">
        <NativeSelect
          aria-label="事件类型"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">全部类型</option>
          {[
            ...new Set([
              ...Object.keys(eventLabels),
              "create",
              "edit",
              "move",
              "dispatch",
              "review",
              "cancel",
              "merge",
              "routine",
              "routine_fire",
              "settings",
              "tick",
              ...rows.map((e) => e.kind),
            ]),
          ]
            .sort()
            .map((k) => (
              <option key={k} value={k}>
                {eventLabels[k] ?? k}
              </option>
            ))}
        </NativeSelect>
        <Input
          aria-label="搜索任务"
          placeholder="按任务编号筛选…"
          value={task}
          onChange={(e) => setTask(e.target.value)}
        />
      </div>
      <Load pending={q.isPending} error={q.error}>
        {!rows?.length && <p className="empty-message">暂无符合条件的活动</p>}
        {[
          ...new Set(
            rows.map((e) => new Date(e.ts).toLocaleDateString("zh-CN")),
          ),
        ].map((day) => (
          <section key={day}>
            <h2>{day}</h2>
            {rows
              .filter((e) => new Date(e.ts).toLocaleDateString("zh-CN") === day)
              .map((e) => {
                const task = tasks.data?.find((t) => t.id === e.task_id);
                return (
                  <article className="event-row" key={e.id}>
                    <time>{new Date(e.ts).toLocaleTimeString("zh-CN")}</time>
                    <span
                      className="event-kind"
                      style={{
                        background: `hsl(${[...e.kind].reduce((n, c) => n + c.charCodeAt(0), 0) % 360} 60% 50% / .15)`,
                      }}
                    >
                      {eventLabels[e.kind] ?? e.kind}
                    </span>
                    {e.task_id && (
                      <Link to={`?task=${task?.identifier ?? e.task_id}`}>
                        {task?.identifier ?? e.task_id}
                      </Link>
                    )}
                    <p>{eventMessage(e.message)}</p>
                  </article>
                );
              })}
          </section>
        ))}
        <Button
          variant="outline"
          disabled={!q.hasNextPage || q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          加载更多
        </Button>
      </Load>
      <TaskDrawer />
    </>
  );
}
