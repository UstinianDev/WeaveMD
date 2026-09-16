---
name: s6-tool-result-storage
description: S6大结果持久化——单工具30k阈值、聚合120k预算、ContentReplacementState确定性替换、tool-results/子目录持久化
metadata:
  type: project
---

# S6 — 大结果持久化

**实施日期**: 2026-09-16
**状态**: 已完成

## 设计

- 单工具阈值 `MAX_SINGLE_RESULT_CHARS = 30_000`（约 7,500 tokens）
- 单轮聚合预算 `MAX_AGGREGATE_RESULTS_CHARS = 120_000`（约 30,000 tokens）
- 结果写入 `app.getPath('userData')/tool-results/` 目录（与 images/files 同级）
- `ContentReplacementState`：Map<toolCallId, {filePath, preview}> 确保同一 toolCallId 在所有 API 调用中返回相同替换

## 集成点

1. `executeOneTool`：成功结果超出阈值 → `persistLargeResult` → 返回预览
2. `executeToolRound` / `processStreamingToolRound`：合并结果后 → `applyAggregateBudget` → 压缩最大结果
3. `runAgentFlow`：创建 `ContentReplacementState` 实例并注入 `ctx.replacementState`，跨轮共享

## 关键文件

- `src/main/ai/agent/toolResultStorage.ts` — 核心模块
- `src/main/ai/agent/agentToolExecutor.ts` — executeOneTool + executeToolRound 集成
- `src/main/ai/agent/StreamingToolExecutor.ts` — replacementState 传入构造器
- `src/main/ai/agent/agentLoop.ts` — ContentReplacementState 创建 + 流/兜底双路径集成
- `src/main/ai/agent/agentContext.ts` — AgentContext.replacementState 字段
- `tests/main/ai/toolResultStorage.test.ts` — 20 测试全绿

## 注意事项

- `applyAggregateBudget` 使用泛型 `<T extends ResultLike>` 避免循环依赖
- `persistLargeResult` 支持 `force` 参数用于聚合预算（跳过单工具阈值）
- 文件名使用 `sanitizedId` 替换特殊字符（`[^a-zA-Z0-9_-]` → `_`）
- 死循环检测使用持久化后的预览文本（前 500 字符），不同结果可区分