# Agent 优化任务状态

## 任务分级

- **类型**：优化（UI + 功能修复 + Bug 修复）
- **影响面**：跨模块（前端 UI + 后端 AI 逻辑 + IPC）
- **档位**：L 级（5 个子任务，跨模块）
- **裁剪**：UI 子任务按 S 级执行，功能/修复子任务按 M~L 级执行

## 子任务状态

| 子任务 | 风险 | 状态 | 备注 |
|--------|------|------|------|
| 一.1 执行过程折叠重构 | L2 | ✅ 完成 | S 级，跳过拷问 |
| 一.2 Hover 颜色调淡 | L2 | ✅ 完成 | S 级，跳过拷问 |
| 三.1 消息内联编辑 | L3 | ✅ 完成 | M 级，涉及 IPC+DB |
| 二.2 流式缓冲竞态修复 | L2 | ✅ 完成 | S 级，防御性修复 |
| 二.1 上下文延续修复 | L3 | ✅ 完成（四次修复，根因定位） | M~L 级，修复 cleanupIncompleteMessages 时序问题 |

## 执行记录

### 2026-09-11

- [x] 任务分级完成
- [x] 子任务一.1 执行过程折叠重构
- [x] 子任务一.2 Hover 颜色调淡
- [x] 子任务三.1 消息内联编辑
- [x] 子任务二.2 流式缓冲竞态修复
- [x] 子任务二.1 上下文延续修复
- [x] 质量门禁验证（typecheck ✓, lint ✓, test ✓, build ✓）

## 修改文件清单

| 文件 | 修改内容 |
|------|----------|
| `src/render/components/AIAgent/cards/AgentWorkflowCard.tsx` | 新增 isStreaming prop，折叠逻辑优化，颜色调淡 |
| `src/render/components/AIAgent/AgentTab.tsx` | 传递 isStreaming prop，新增编辑状态管理 |
| `src/render/components/AIAgent/message/AIMessageBubble.tsx` | 新增编辑模式（textarea + 键盘事件） |
| `src/main/ai/contextManager.ts` | 优化摘要前缀和 prompt |
| `src/main/ai/agent/agentPromptBuilder.ts` | 强化 system prompt，应用 Attention Anchoring 技术 |
| `src/main/ai/agent/agentLoop.ts` | **根因修复**：修复 cleanupIncompleteMessages 时序问题 + 应用 Attention Anchoring 技术 |
| `tests/main/ai/contextManager.test.ts` | 更新测试期望值 |

## 根因分析（第四次修复）

### 问题现象
所有场景都有共同模式：**第二条消息延续第一条消息的回答**，只有第三条消息才能得到正确回答。

### 根因
`cleanupIncompleteMessages` 函数会移除末尾无 assistant 跟随的 user 消息。但 `appendMessage` 在 `getMessagesByConversation` **之前**调用，当前 user 消息已保存到 DB，会被当作"孤立消息"移除。

### 时序分析（修复前）
1. 用户发送 "1+100" → `appendMessage` 保存到 DB
2. 从 DB 加载：`[user: "1+1", assistant: "2", user: "1+100"]`
3. `cleanupIncompleteMessages` 移除 "1+100"（无 assistant 跟随）
4. 返回 `[user: "1+1", assistant: "2"]`
5. chat 意图 `slice(-1)` 取最后一条 user → **空数组！**

### 修复方案
1. 先提取当前 user 消息
2. 对历史消息调用 `cleanupIncompleteMessages`
3. 清理后重新添加当前 user 消息
4. chat 意图直接使用当前 user 消息，不依赖 `slice(-1)`

### 技术调研记录
- OpenAI Chat Completions API 最佳实践
- LangChain Conversation Memory 管理实现
- "Lost in the Middle" 问题研究
- 应用 Attention Anchoring 技术
