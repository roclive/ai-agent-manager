# Planner 为复杂待办任务标注并授权 spawn subagent 协作

调整 planner 创建 backlog 新任务的行为：当任务复杂、可拆分且适合多个 agent 协作时，在任务中明确注明“复杂任务：允许并建议 spawn subagent 协作”，并说明可并行的子任务、主 worker 的协调责任和最终验收；普通小任务不得一律标记。

1. 阅读当前 planner（规则与 LLM）、任务 complexity 字段、计划输出解析/校验、落库与 worker prompt 生成流程。复用现有 complexity 表达，按最简方式增加明确的 subagent 协作标记/指示，避免只有 planner 内部知道、实际 worker 看不到。
2. 在 planner 将复杂任务加入待办池时，写入可见标记和简短协作说明：适合拆分的工作项、可独立并行的范围、主 worker 汇总/验收责任。此标记构成该任务内使用 subagent 的明确授权；仅适用于支持该能力的执行器。不可拆分的小任务保持普通执行方式；不通过提高 complexity 给所有任务默认生成多个 subagent。
3. 更新 planner 输出约定、校验和 worker 提示，保证任务创建后字段/说明可持久化、可查看，重试和派发时仍会传递。旧任务/缺少新标记的输出保持兼容；不要求为每个子任务新建 AAM 任务或用户聊天。
4. 主 worker 负责选择实际拆分方式、限制并发、避免多个 agent 同时修改相同文件，并汇总结果和完成最终验收；subagent 不替代 AAM 的独立任务运行、取消和审查机制。能力不支持或没有适合并行子工作时允许主 worker 自行完成并说明原因。
5. 用 fake planner/runner 验证复杂任务的标记、普通任务不误标、落库与派发 prompt 传递、旧输出兼容、错误输出校验；测试不得启动真实 Codex/Claude/opencode 或 subagent。执行 npm test 与 npm run typecheck；涉及 UI 时执行相应 UI 检查。交付简短文档和一个 planner 生成的复杂任务示例，不实际派生子任务或修改全局并发设置。
