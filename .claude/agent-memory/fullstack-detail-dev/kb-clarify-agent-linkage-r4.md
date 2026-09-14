---
name: kb-clarify-agent-linkage-r4
description: R4 知识库澄清与 Agent ask_question_card 联动：buildClarificationContext + searchKBHandler 注入 + 分轮策略
metadata:
  type: project
---

R4 将 `knowledgeClarify.ts` 的程序化歧义检测与 Agent 的 `ask_question_card` 工具打通。

**核心链路**：
searchKBHandler 搜索结果被拒/为空 → `buildMinimalUnderstanding(query, res)`（基于 `detectAmbiguities`/`classifyIntent`，confidence 从搜索得分推断）→ `buildClarificationContext(understanding, searchRefused)`（调用 `needsClarification` + `generateClarifyQuestions`）→ 格式化分轮问题列表注入工具结果 JSON `{ clarificationNeeded, clarificationContext }` → LLM 看到后调用 `ask_question_card` 分轮提问

**分轮策略**：text 问题（pronoun_reference/missing_subject）→ 第1轮核心歧义消解；choice 问题（broad_scope）→ 第2轮范围细化；每轮最多2个问题。

**向后兼容**：无澄清需求时 `searchKBHandler` 仍返回原始数组格式 `JSON.stringify(res.results)`；仅需澄清时包装为 `{ results, clarificationNeeded, clarificationContext }`。

**How to apply**：后续若需扩展歧义类型，修改 `detectAmbiguities` 和 `questionsForAmbiguity` 即可，无需改动 Agent 侧；分轮显示逻辑由 `buildClarificationContext` 统一控制。