# agent-kb-split — 大文件拆解重构需求

> 创建：2026-09-15 | 来源：grill-me 对齐 | 定档：M

## 目标

将两个大文件拆解为多个小文件，零行为变化。

## 范围

| 文件 | 行数 | 操作 | 拆分后 |
|------|------|------|--------|
| `agentLoop.ts` | 1153 | 拆为 4 文件 | agentLoop + agentContext + agentToolExecutor + agentHelpers |
| `kbSearch.ts` | 901 | 拆为 2 文件 | kbSearch + kbSearchFts |

## 硬性约束

- 严格不可改变任何模块功能的任何行为
- 相同输入 → 相同输出
- 原文件保留对外 export（re-export from new files），外部调用方无需修改 import 路径
- 所有既有测试必须通过

## 拆分方案

### agentLoop.ts → 4 文件

| 新文件 | 内容 | ~行数 |
|--------|------|------|
| `agentLoop.ts` | runAgentFlow + AgentLoopDeps/AgentReqPayload/AgentLlmMessage/AgentContext 类型 + 全部 re-export | ~350 |
| `agentContext.ts` | prepareAgentContext + createSend + sendStream + CHANNEL_TO_EVENT_TYPE 映射 | ~250 |
| `agentToolExecutor.ts` | executeToolRound + handleToolResult + executeOneTool + ToolRoundResult/ToolExecResult 类型 | ~350 |
| `agentHelpers.ts` | detectTextQuestions + sendProgress + makeAgentResult + getCompressThreshold + getRoundsForIntent + needsKbSendConsent + 常量 | ~150 |

### kbSearch.ts → 2 文件

| 新文件 | 内容 | ~行数 |
|--------|------|------|
| `kbSearch.ts` | 搜索入口 + 结果去重/过滤 + 编排 | ~450 |
| `kbSearchFts.ts` | FTS5 SQL 构建 + BM25 评分 + tokenizer + 排序 | ~450 |

## 验收标准

- `npx tsc --noEmit` → 0 errors
- `npx vitest run` → 1535 passed
- 外部调用方（agentTaskWorker, toolRegistry 等）的 import 路径无需修改