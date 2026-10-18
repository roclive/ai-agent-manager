export const eventLabels: Record<string, string> = {
  dispatch: "派工",
  finalize: "完成运行",
  review: "审查",
  move: "状态变更",
  edit: "编辑",
  create: "新建",
  routine_fire: "定时触发",
  cooldown: "冷却",
  cancel: "取消",
  setup: "准备",
  merge: "合并",
  dependency_merge: "合并依赖",
  routine: "定时任务",
  tick: "心跳",
  settings: "设置",
  reap: "回收运行",
  error: "错误",
};
export function eventMessage(message: string) {
  try {
    const data: unknown = JSON.parse(message);
    if (
      data &&
      typeof data === "object" &&
      "name" in data &&
      typeof data.name === "string"
    )
      return `「${data.name}」`;
  } catch {
    /* Plain text event. */
  }
  return message;
}
