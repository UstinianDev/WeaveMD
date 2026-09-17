# perf-agent-arch — 实施计划

> 创建：2026-09-15 | 来源：Phase 2 Plan 智能体

## 1. 变更清单

| 文件 | 优化项 | 类型 |
|------|--------|------|
| `src/main/ai/agent/agentPromptBuilder.ts` | A1 — 提示词工作流改写 | 内容变更 |
| `src/main/ai/agent/agentLoop.ts` | A2 — 首轮并行化 / A3 — 调用方适配 / B2 — 死代码删除 / 埋点 | 结构变更 |
| `src/main/ai/agent/agentCheckpoint.ts` | A3 — 签名扩展（新增可选参数） | 签名变更 |
| `src/main/ai/agent/agentEventStore.ts` | B3 — JSON 往返消除 | 结构变更 |
| `src/render/stores/agentStore.ts` | B1 — 动态 import 静态化 | 导入重构 |

## 2. 实施顺序

### 阶段 1：低风险清扫（可并行）
1. **B2** — 死代码删除（agentLoop.ts:993-1007，零风险）
2. **B1** — 动态 import 静态化（agentStore.ts 8 处→顶部 import）
3. **B3** — JSON 往返消除（agentEventStore.ts BatchEventItem 加 payload 字段）

### 阶段 2：架构级优化（串行，有行为影响）
4. **A3** — Checkpoint 真增量（agentCheckpoint.ts 签名扩展 + agentLoop.ts 调用适配）
5. **A1** — 工具调用时机前置（agentPromptBuilder.ts "工作流"新增第 0 条规则）
6. **A2** — Agent 首轮并行化（agentLoop.ts prepareAgentContext 重组）

### 阶段 3：埋点
7. 在 runAgentFlow 加 `// PERF:` 临时 performance.now() 打点

### 阶段 4：验收
8. tsc + vitest + 手动回归 + 打点数据对比 + 删除埋点

## 3. 各优化项具体方案

### A1 — 工具调用时机前置（agentPromptBuilder.ts）

在"## 工作流"标题下插入第 0 条规则：
```
0. 【关键】收到用户消息后，先规划完成任务需要哪些工具，
   然后立即调用工具获取信息，拿到工具返回结果后再基于
   结果输出文本回答。不要在调用工具前输出大段文字——
   文本应出现在工具结果之后。
```
原有 4 条顺延。不改 tool_choice。

### A2 — Agent 首轮并行化（agentLoop.ts:prepareAgentContext）

intent 分类完成后，将三个独立操作调整为并行候选：
- `listFiles(userId)` 提前到 intent 后立即执行
- `loadSkills()` 保持原位
- `buildLocalTreeSnapshot` 保持与 listFiles 并行
- 实际执行顺序不变（better-sqlite3 同步 API），但代码组织为后续异步化做准备

### A3 — Checkpoint 真增量（agentCheckpoint.ts + agentLoop.ts）

- agentCheckpoint.ts：`saveCheckpointIncremental` 新增可选参数 `existingMessages?: AgentLlmMessage[]` 和 `roundIndex?: number`
- 当传入时跳过 `loadCheckpoint`（DB read+JSON.parse），直接用内存数据
- agentLoop.ts：在 push toolTurn 前调用 saveCheckpointIncremental，传入 `ctx.llmMessages` 作为 existingMessages
- 保留向后兼容（不传 existingMessages 时走原逻辑）

### B1 — 动态 import 静态化（agentStore.ts）

- 顶部添加：`import { useFileTreeStore } from '@render/stores/fileTreeStore'`
- 8 处 `await import('@render/stores/fileTreeStore')` → `useFileTreeStore.getState()`
- 已确认无循环依赖

### B2 — 死代码删除（agentLoop.ts:993-1007）

删除 `oldMessageCount`/`newMessages`/`newTokenCount`/`compressionRatio` + console.log。压缩后 oldMessageCount 恒大于新数组长度，slice 返回空数组，reduce 恒为 0。

### B3 — JSON 往返消除（agentEventStore.ts）

- `BatchEventItem` 增加 `payload: unknown` 字段
- persistAndSend 同时存 payload 对象引用
- flushEventBatch IPC 路径直接用 `item.payload`，跳过 `JSON.parse`

## 4. 埋点

在 agentLoop.ts 的 runAgentFlow 添加 `// PERF:` 前缀临时打点：
- `perfStartE2E` — 入口
- `perfStartRound` — 每轮开始
- `console.log('[PERF]')` — 每轮耗时 + 端到端耗时

优化验收完成后全局搜索删除 `// PERF:`。

## 5. 风险点

| 优化项 | 风险 | 缓解 |
|--------|------|------|
| B2 | 零 | 删除永不行执行的代码 |
| B1 | 极低 | 已确认无循环依赖 |
| B3 | 极低 | 100ms 批量延迟内对象不可变 |
| A3 | 中 | 保留向后兼容路径；DB 写入内容不变 |
| A1 | 低 | 保留"简单问题直接回答"规则 |
| A2 | 极低 | 代码重组，不改变执行顺序 |

## 6. 验收流程

1. `npx tsc --noEmit` → 0 errors
2. `npx vitest run` → 1535 passed
3. 手动回归：简单对话、工具调用、多轮对话、异常路径
4. `[PERF]` 日志对比端到端耗时和每轮耗时
5. 全局删除 `// PERF:` 临时代码
6. 再次 tsc + vitest 确认清理后无破坏