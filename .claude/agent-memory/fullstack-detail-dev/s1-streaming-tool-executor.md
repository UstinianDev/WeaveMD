---
name: s1-streaming-tool-executor
description: S1 流式推测执行架构：StreamingToolExecutor 状态机、agentLoop 集成模式、processStreamingToolRound 与 executeToolRound 共存策略
metadata:
  type: project
---

# S1 流式推测执行架构

阶段 1 核心优化：StreamingToolExecutor 嵌入 agentLoop 的 for-await 循环，安全工具在 LLM 流中立即执行。

## 架构决策

**Why**: 现有 `executeToolRound` 在流完全结束后才执行所有工具，用户干等 2-3 秒。流式推测执行让安全工具（TOP10 只读/proposal-only）在流中并行执行，减少总耗时。

**How to apply**: 后续工具执行优化需保持两个路径共存：编译时常量 `STREAMING_TOOL_EXEC_ENABLED` 控制新旧切换。新增工具或修改执行逻辑时，需同步更新两个路径。

## 关键文件与交互

- `StreamingToolExecutor.ts` — 状态机（queued→executing→completed→yielded），只执行安全工具（fire-and-forget），非安全工具仅入队
- `agentLoop.ts` — 集成点：`L186 executor创建` → `L224 onToolCall注册` → `L291 processStreamingToolRound处理`
- `agentToolExecutor.ts` — 提供 `executeOneTool`（复用）、`handleToolResult`（复用）；兜底路径 `executeToolRound` 不动
- `processStreamingToolRound` — 后处理函数，负责去重 ask_question_card、force_confirm 检查、非安全工具串行执行、handleToolResult 管道、交互暂停

## 避免的坑

1. **循环依赖**: StreamingToolExecutor import executeOneTool from agentToolExecutor。不能反向引用。后处理函数放在 agentLoop.ts 避免循环依赖。
2. **ask_question_card 去重**: 在 processStreamingToolRound 中重做，因为流结束后才能完整去重
3. **force_confirm 不改动**: 非安全工具不在 executor 中执行，由 processStreamingToolRound 用原始逻辑处理
4. **dead loop 检测顺序**: handleToolResult 按 tc.index 顺序处理，与 executeToolRound 一致
5. **PERF 打点使用 `[PERF]` 前缀**: 临时日志，验收后全局搜索删除

## 相关记忆

- [[concurrencyDefs]] — S2 产物，isToolConcurrencySafe 全量 24 工具定义
- [[agent-perf-optimize-plan]] — 完整实施计划