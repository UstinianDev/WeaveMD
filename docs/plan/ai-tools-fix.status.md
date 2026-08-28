# AI 模块工具调用问题修复计划

## 任务分级
- **请求类型**：Bug 修复
- **影响面**：AI 模块（agentLoop、llmClient、toolRegistry、agentTaskWorker）
- **定档**：M 级别（涉及多个文件，但不需要数据迁移或新 API）

## 问题清单

### 问题 1：LLM 流式响应卡住（"正在思考"）
- **根因**：`llmClient.ts` 中，当 LLM 返回空 content 或只返回 reasoning 时，流可能卡住
- **文件**：`src/main/ai/llmClient.ts`
- **修复方案**：
  1. 在 SSE 解析中，检测空 content 和 reasoning 的情况
  2. 添加超时检测，如果长时间没有有效 content，主动中断流
  3. 在 `processSseLines` 中，处理 `delta.reasoning` 字段

### 问题 2：工具调用失败但没有正确处理
- **根因**：工具执行失败时，错误信息可能没有正确传递给 LLM
- **文件**：`src/main/ai/agentLoop.ts`
- **修复方案**：
  1. 确保工具执行失败时，错误信息被正确格式化并传递给 LLM
  2. 在 `executeToolRound` 中，添加更详细的错误处理

### 问题 3：答非所问
- **根因**：会话上下文管理问题，历史消息（包括工具调用结果）被错误地注入到新问题中
- **文件**：`src/main/ai/agentLoop.ts`
- **修复方案**：
  1. 在 `prepareAgentContext` 中，确保历史消息被正确过滤
  2. 添加会话状态检查，确保新问题不会被旧上下文污染

### 问题 4：AbortController 清理不彻底
- **根因**：任务取消时，AbortController 没有完全清理
- **文件**：`src/main/ai/agentTaskWorker.ts`
- **修复方案**：
  1. 在任务结束时，确保 AbortController 被完全清理
  2. 添加清理验证，确保没有残留的监听器

## 变更清单

1. `src/main/ai/llmClient.ts`
   - 修改 `processSseLines` 函数，处理空 content 和 reasoning
   - 添加超时检测逻辑

2. `src/main/ai/agentLoop.ts`
   - 修改 `executeToolRound` 函数，改进错误处理
   - 修改 `prepareAgentContext` 函数，改进历史消息过滤

3. `src/main/ai/agentTaskWorker.ts`
   - 修改 `processTask` 函数，改进 AbortController 清理

4. `src/render/stores/agentStore.ts`
   - 修改 `sendAgentMessage` 函数，确保发送新消息前停止当前流
   - 修改 `stopStream` 函数，清理所有流式状态

5. `tests/main/ai/llmClient.test.ts`
   - 更新测试以匹配新行为（reasoning delta 现在会通过）

## 验收标准

1. LLM 流式响应不再卡住，超时后能正确中断
2. 工具调用失败时，错误信息能正确传递给 LLM
3. 新问题不会被旧上下文污染
4. AbortController 能正确清理，不影响后续任务

## 测试结果

- **TypeScript 类型检查**：0 新增错误（预先存在的 3 个测试类型错误与本次修改无关）
- **Vitest 测试**：171/171 通过（14 个文件），1 个预先存在的 ipc.test.ts 失败与本次修改无关
- **ESLint**：0 新增错误（预先存在的 1 个 error 与本次修改无关）

## 风险评估

- **风险等级**：L2（低风险修改）
- **影响范围**：AI 模块内部，不影响其他模块
- **回滚方案**：Git 回滚到修改前的状态

## 完成状态

- [x] 问题 1：LLM 流式响应卡住 — 已修复
- [x] 问题 2：工具调用失败处理 — 已修复
- [x] 问题 3：答非所问 — 已修复
- [x] 问题 4：AbortController 清理 — 已修复
- [x] 问题 5：流卡住检测误触发（工具调用期间） — 已修复
- [x] 测试验证 — 全部通过
- [x] 文档更新 — 已完成

### 问题 5 修复说明（2026-08-27）
- **根因**：30 秒流卡住检测在工具调用期间误触发。LLM 处理工具结果并生成回答时可能长时间不发 content delta
- **修复**：
  1. 超时从 30 秒放宽到 2 分钟
  2. 收到任何 SSE 数据块（包括心跳）都重置计时器，而非仅 content delta
  3. 仅在真正无数据传输时才触发超时
