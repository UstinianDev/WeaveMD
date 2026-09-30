# 触发优化与提示词规则（§9-§10）

> 拆分自 [11-AI代理面板-Agent.md](../11-AI代理面板-Agent.md)，原 §9 触发优化、§10 Emoji 禁令；2026-10-01 按渐进式披露拆分，正文未改动。
> 返回索引：[11-AI代理面板-Agent.md](../11-AI代理面板-Agent.md)

---

## 9. 触发优化

### 9.1 ask_question_card 去重

DeepSeek 等模型在流式输出中可能先输出不完整的 tool call（空 questions 数组），
然后再输出完整调用。`agentLoop.ts` `executeToolCalls()` 在每轮执行前进行**跨轮去重**：

```ts
const dedupedToolCalls = accumulatedToolCalls.filter((tc, idx, arr) => {
  if (tc.name !== 'ask_question_card') return true;
  // 空 questions → 丢弃（除非是最后一个）
  // JSON 解析失败 → 如果后面还有同名调用则丢弃
});
```

两层防护：
1. **跨轮去重**（同一次 tool_calls 数组内多个 ask_question_card 调用的合并）
2. **同轮兜底**（空参数调用被过滤，只保留最后一个有效调用）

### 9.2 editLocalFile diff 预览

`editLocalFile` 工具在写盘前先读取旧内容，生成 diff 提案供用户预览：

- 读取目标文件的当前内容作为 `originalContent`
- 将 LLM 生成的新内容作为 `newContent`
- 构建 `EditBlocksProposal` 推送 UI 端，通过 `DiffSummaryCard` 展示红删绿增
- 确认后才执行实际写盘

### 9.3 chat 意图 ask_question_card 支持

`agentToolSelector.ts` 的 `toolsForIntent()` 中，chat 意图也提供了 `ask_question_card`
工具（当 `hasInteractionSupport` 为 true 时）：

```ts
case 'chat':
  if (hasInteractionSupport) {
    names.add('ask_question_card');
  }
  return all.filter((t) => names.has(t.function.name));
```

结合 `needsClarification` 标志，确保模糊/简短的 chat 输入能被 Agent 追问澄清，
而非 LLM 直接猜测意图后输出可能不准确的回答。

---

## 10. Emoji 禁令

Agent 系统提示词（`agentPromptBuilder.ts`）明确禁止 LLM 在回复中使用 emoji：

```
- 禁止在回复中使用 emoji 表情符号（如 ⚠️ ❌ ✅ 🎉 等）。使用纯文本标记代替。
```

此规则同时影响：
- **Chat 系统提示词**（`CHAT_SYSTEM_PROMPT`）：闲聊模式同样禁止 emoji
- **Agent 系统提示词**：所有意图的 Agent 回复均受约束
- **格式规则**：LLM 被要求使用 `**粗体**`、`- 列表` 和标题代替 emoji 标记

此规则在系统提示中的位置靠前（格式规范区块），确保 LLM 优先遵守。
