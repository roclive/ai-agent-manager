// Adapted from paperclipai/paperclip (MIT)
import { statuses, type Task, type TaskStatus } from "./types";
export const order = (t: Task) => t.sort_order ?? t.seq;
export function groupTasks(tasks: Task[]) {
  return Object.fromEntries(
    statuses.map((s) => [
      s,
      tasks
        .filter((t) => t.status === s)
        .sort(
          (a, b) =>
            order(a) - order(b) ||
            a.priority.localeCompare(b.priority) ||
            a.id - b.id,
        ),
    ]),
  ) as Record<TaskStatus, Task[]>;
}
export function planDrop(
  tasks: Task[],
  activeId: number,
  overId: number | string,
) {
  const active = tasks.find((t) => t.id === activeId);
  if (!active || activeId === overId) return null;
  const target = tasks.find((t) => t.id === overId);
  const status =
    target?.status ??
    (statuses.includes(overId as TaskStatus) ? (overId as TaskStatus) : null);
  if (!status) return null;
  const column = groupTasks(tasks.filter((t) => t.id !== activeId))[status];
  let index = target
    ? column.findIndex((t) => t.id === target.id)
    : column.length;
  if (target && active.status === status && order(active) < order(target))
    index++;
  index = Math.min(index, column.length);
  const prev = column[index - 1],
    next = column[index];
  const sort_order =
    prev && next
      ? (order(prev) + order(next)) / 2
      : prev
        ? order(prev) + 1024
        : next
          ? order(next) / 2
          : 1024;
  return { status, sort_order };
}
export async function applyDrop(
  tasks: Task[],
  id: number,
  patch: { status: TaskStatus; sort_order: number },
  write: (id: number, p: typeof patch) => Promise<unknown>,
  update: (tasks: Task[]) => void,
) {
  update(tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  try {
    await write(id, patch);
  } catch (error) {
    update(tasks);
    throw error;
  }
}
