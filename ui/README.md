# aam UI

React 19 + Vite + Tailwind v4，界面改编自 Paperclip（MIT）。

```sh
cd ui
npm install --cache /tmp/aam-npm-cache
npm run dev
```

打开 http://127.0.0.1:5174/board 。在仓库根目录运行 `npm run aam -- serve`，Vite 会将 `/api`（包括 SSE）代理到 3199 端口。

`npm run build` 生成 `ui/dist`；AAM-4 的静态服务器从 `/` 提供该目录。资源路径采用相对路径。
`npm test` 运行离线 jsdom 测试，`npm run typecheck` 检查类型。

没有 SSE 时每 5 秒刷新任务和运行记录；状态及项目每 10 秒刷新。旧 API 不提供守护进程状态和运行列表时显示不可用状态。排序优先 PATCH `sort_order`；只有旧服务器明确拒绝字段时才回退到 `sort`。
