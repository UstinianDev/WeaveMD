# perf-agent-arch — Agent 架构级性能优化需求

> 创建：2026-09-15 | 来源：用户实测反馈 + 瓶颈扫描 | 状态：需求对齐完成

## 背景

用户实测 Agent 执行速度明显变慢，核心体验问题：**"文本都差不多输出完了工具才调用"**，导致用户在 LLM 文本输出期间干等，然后工具才开始执行。选择 C 方案解除行为不变限制，但保持硬性约束。

## 硬性约束

| 约束 | 说明 |
|------|------|
| 工具行为不变 | 每个工具的功能、输入输出、副作用不可变 |
| 上下文不瘦身 | 不压缩系统提示、不减少历史轮次、不截断工具结果 |
| 最大轮次不变 | 保持意图动态分配轮次机制 |
| 交互卡不丢 | ask_question_card 触发逻辑保持 |
| 历史不忘 | LLM 短期记忆保持 3 轮 |
| 分轮策略不变 | Clarification Rules 完整保留 |

## 优化清单

### P0 — 架构级优化

| # | 优化项 | 文件 | 原理 | 预期收益 |
|---|--------|------|------|----------|
| A1 | 工具调用时机前置 | `agentPromptBuilder.ts` | 系统提示中增加"先规划→先调工具→拿到结果→再输出文本"流程，让 LLM 优先调工具而非先刷文本 | 减少无效等待 5-15s |
| A2 | Agent 首轮并行化 | `agentLoop.ts` | `prepareAgentContext` 中文件列表查询、本地文件树、技能列表并行执行 | 首轮初始化省 5-10ms |
| A3 | Checkpoint 真增量 | `agentCheckpoint.ts` + `agentLoop.ts` | `saveCheckpointIncremental` 跳过 DB read+JSON.parse，直接用内存 `ctx.llmMessages` 构建 checkpoint | 每轮省 1-2ms |

### P1 — 代码清理

| # | 优化项 | 文件 | 原理 |
|---|--------|------|------|
| B1 | 动态 import 静态化 | `agentStore.ts` | 8 处 `await import('fileTreeStore')` 改顶部静态 import |
| B2 | 死代码删除 | `agentLoop.ts:993-1007` | 删除 `oldMessageCount`/`newMessages`/`newTokenCount` 死变量 |
| B3 | JSON 往返消除 | `agentEventStore.ts` | `BatchEventItem` 同时存 payload 对象引用，跳过 `JSON.parse` |
| B4 | 去重逻辑保留 | `agentLoop.ts` | ask_question_card 去重已有效，保持不变 |

## 验收标准

| 指标 | 测量方式 | 目标 |
|------|----------|------|
| 端到端耗时 | `performance.now()` 打点 | 典型任务缩短 15-30% |
| 平均每轮耗时 | 同上报点 | 降低 |
| 工具调用时机 | 首个 tool_call 出现时间 | 不晚于首个文本块 |
| 回归测试 | `npx vitest run` | 1535 passed |
| 类型检查 | `npx tsc --noEmit` | 0 errors |

## 不优化项

| 项目 | 原因 |
|------|------|
| 上下文瘦身 | 影响输出质量 |
| 减少最大轮次 | 复杂任务可能执行不完 |
| 减少历史保留轮次 | 影响多轮任务连贯性 |
| 系统提示压缩 | 影响 Agent 能力 |
| 工具行为变更 | 硬性约束 |