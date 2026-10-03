# agent-history-toolcards — 历史会话「一卡一工具」渲染回归修复

> 来源：/devflow 2026-10-03 用户报障「打包上传后，之前的会话一个执行过程装一个工具（很早的没事）」；档位 **S**（Bug 短路径：复现 → 最小修复），TDD light

## 1. 需求清单

| # | 需求 | 说明 |
| - | ---- | ---- |
| R1 | 连续工具占位行合并为一张执行卡 | `groupToolTurns` 纯函数：agent 模式下连续 `role=assistant && toolCalls>0 && content=''` 的消息合并为一组，单卡多轮次；user/带正文消息断组 |
| R2 | AgentTab 接线 | `visibleMessages` → `groupToolTurns` → toolGroup 渲染单卡，其余分支原逻辑不变（含原 originalIndex/retry 语义） |

## 2. 复现与根因（本地库只读实测，2026-10-03）

- **数据形态两段**：2026-09-27 前 = 一轮全部工具存**一条**消息（n=5~28，loopIndex 轮内 0..k，正常）；**2026-10-01 起 = 每轮一条 `content=''` 占位行**（memory-B2 `appendToolTurnWithAssistant` 单事务落库 `0f4595f` 后的形态，n=1/条，loopIndex 递增）。
- **渲染**：`AgentTab:111` 按「每消息一张 `AgentWorkflowCard`」→ 占位行形态被拆成单工具卡 = 症状；正常期数据单条多工具故显示正常（「很早的没事」）。
- 排除项：请求体/累积/回填/UI 分组代码均支持多工具（`llmClient` 按 index 累积全量 flush、`assembleToolTurn` 全量 map、`groupByRound` 按 loopIndex）——纯渲染分组回归，非模型/传输问题；执行段历史误诊改动已全部撤销。

## 3. 验收标准

1. 异常期形态（连续空正文工具行）→ 1 张卡含全部工具（`groupToolTurns` 单测 6 例）；
2. 正常期单条多工具 → 渲染等价不变；带正文工具行、user 断组、非 agent 模式不合并；
3. `npm run typecheck` + `npm run test` + `npm run lint` 全绿；playwright 31 例基线零新增。

## 4. 已对齐问题

- 流式在线卡片（`isStreaming`）与 `AgentWorkspace`（全仓无引用，未动）不在范围；
- thinking-only 占位行（loopIndex=-1）随组合并，卡片内 `loopIndex<0` 已有过滤，空组 `return null` 已有兜底。
