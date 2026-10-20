## 派发候选池与 Ready 队列优先选择高优先级任务

调整 AAM 自动派发策略：在待提升的 backlog 候选池和 ready 派发队列中，都应先选择优先级更高的任务（P0 高于 P1，高于 P2，高于 P3）。当前容量不足、依赖未完成的高优先级任务不得阻塞可运行任务；现有依赖、冷却、并发容量、review/integration 冲突等派发门槛必须保留。

1. 审查并统一优先级比较规则，避免用字典序造成顺序不明确；P0/P1/P2/P3 映射显式定义并可复用。
2. Backlog 候选池（包括 idle refill/promoteIdle 以及任何自动挑选 ready 候选的路径）按优先级从高到低排序，再使用现有项目轮转/autopilot rank、sort_order、seq/id 作为同优先级 tie-breaker；若保留项目公平性，需保证低优先级任务不会越过当前可选的高优先级任务。
3. Ready 队列在每个 tick 的 dispatch 迭代前按优先级从高到低排序，保证并发槽位先分配给当前可派发的最高优先级任务；同优先级继续按既有稳定顺序。
4. 增加 fake-worker 自动化测试：候选池混有多个优先级和项目 rank 时，高优先级先提升；ready 混有多个优先级、依赖未完成任务及多并发槽位时，最高优先级可派发任务先启动；同优先级顺序稳定；依赖、cooldown、max_parallel 等规则仍有效。
5. 如 UI 或 API 输出使用同一排序承诺，确保 ready 列表与派发次序一致；否则文档明确这是调度顺序，并避免界面显示造成相反预期。

验收：`npm test`、`npm run typecheck`、UI tests/typecheck 通过；集成测试不得调用真实 worker CLI，使用 `AAM_FAKE_WORKER`。
