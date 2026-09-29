---
name: agent-memory-optimize-b-c-done
description: agent-memory-optimize 批 B 第二波 B-c（读取集成）交付事实：DB tool_calls 是 IAgentToolCall[] 必须转 LLM 形状、修复接在 cleanup 之后、mock key 级联
metadata:
  type: project
---

agent-memory-optimize P0 第一批 · 批 B 第二波 **B-c（读取集成）** 于 2026-09-29 交付（未 commit，交总指挥）：`agentContext.ts` 按轮读取 + `tool_calls` 回读 + 空 content 放行 + `repairToolTurnPairing` + `toolCtx.history`；`agentMedia.ts` 透传；`QuestionCard.tsx` 加 `data-testid="question-card"`。门禁：typecheck 0 error、`tests/main/` 64 文件/1305 例、`tests/render/` 30 文件/276 例、lint 0 error/106 warning、覆盖率 agentContext 89.77% / agentMedia 89.28%。

**Why:** 下一任务（Gate B / E2E）要复用这批口径，且下面几条是读路径的结构性事实，不是从代码一眼能看出的。

**How to apply:**
- **`tool_calls` 不是「纯透传」**：DB `ai_messages.tool_calls` 列存的是 `IAgentToolCall[]`（`{toolCallId,name,args,status,...}`），而 provider 要的是 `assembleToolTurn` 的 `{id,type:'function',function:{name,arguments}}`。形状转换放在 `agentContext.ts` 的 DB→LLM map 里（`toLlmToolCalls`），此后整条回读链（injectImages / cleanup / repair / buildCompressed）统一为 LLM 形状；`repairToolTurnPairing` 用 `tc.id` 对 `tool_call_id` 配对。`tool_call_id` 列值是 `call_${round}_${index}`，与 `assembleToolTurn` 的 id 一致。
- **修复必须接在 `cleanupIncompleteMessages` 之后**：cleanup 按「最后一条 assistant」截断，崩溃中间轮的尾部 tool 行会先被切掉，再由 repair 补占位——顺序反了会把真实 tool 行留下当孤儿丢弃。
- **`vi.mock('@main/db/ai', () => dbMock)` 是整模块替换**：`agentContext` 换读取函数后，`agentLoop.test.ts`、`agent-perf-benchmark.test.ts` 等只要间接触发 `prepareAgentContext` 就会炸 "No X export is defined"，必须补 `getRecentMessagesByRounds` key。
- **`toolCtx.history` 取自修复/清理之后的 `llmMessages`**（含当前 user 消息，过滤 user/assistant + `contentToText`），零额外 DB 读；代价是 `queryPlanner.extractEntityFromHistory` 从末尾扫描时可能先命中当前句（如「关于它的…」自匹配）——该函数在 B-d 文件里，未改，留给下批评估。
- **anthropic 协议遗留**：`anthropicClient`/`anthropicCompat` 丢弃 `tool` 角色且忽略 assistant `tool_calls`，放行 `content:''` 行后重载历史可能给 anthropic 送空 content assistant（req P0-4 第 6 条已明确本批不动）。

关联：[[fullsuite-flaky-perf-tests]]、[[agent-memory-b-d-done]]
