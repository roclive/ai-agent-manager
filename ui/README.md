# aam UI

React 19 + Vite + Tailwind v4，组件改编自 Paperclip（MIT，见 THIRD_PARTY_NOTICES.md），无运行时 vendor 依赖。

```sh
cd ui
npm install --cache /tmp/aam-npm-cache
npm run dev
```

在仓库根目录运行 `npm run aam -- serve`，打开 http://127.0.0.1:5174 。Vite 将 `/api` 和 SSE 代理到 3199。
`npm run build` 生成 `ui/dist`，由 `aam serve` 在 `/` 提供。`npm test` 是离线 jsdom 测试；`npm run typecheck` 检查类型。

- `/`：执行器、任务状态、审查队列、受阻任务、冷却倒计时、心跳和最近活动。
- `/board`：看板；卡片正文或拖动手柄可拖动，标题打开详情。手柄聚焦时显示键盘提示。
- `/backlog`：按状态折叠、搜索与排序、行内编辑、勾选后批量移动。侧栏切换项目适用于总览、看板、待办和活动。
- `/board?task=ID`、`/backlog?task=ID`：任务抽屉，支持字段编辑、Markdown 预览、依赖多选、运行历史、日志及审查。多选依赖使用系统的 Ctrl/Cmd 或 Shift 选择方式。
- `/routines`：创建、编辑、启停、立即执行和删除定时任务，展开查看最近 20 次触发。提供四个 cron 预设及自定义表达式，服务端校验错误显示在表单中。Shell 任务以当前用户权限执行。
- `/activity`：按事件类型、任务编号、项目筛选，加载更多历史事件。
- `/settings`：并行数、超时、默认执行器、审查模式、清除冷却、项目编辑。

快捷键：`c` 新建任务，`/` 聚焦当前页任务搜索，`g b` 前往看板；输入时禁用。
SSE 触发查询刷新，断线时任务、运行和活动每 5 秒轮询，项目、状态、定时任务每 10 秒轮询。
运行中的日志每 2 秒刷新，可切换执行器/测试日志、运行编号及末尾 100/500/1000 行，并自动滚至底部。
手动运行、取消运行和删除定时任务均有确认对话框。合并必须填写非基础分支，由服务端再次校验。
