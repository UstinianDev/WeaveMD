# ai-redesign-m2-stores — Store 调整 + 改写提示条关闭（渲染侧）

角色：fullstack-detail-dev | TDD standard | 分支 feat/ai-agent-ph3-ph4 | 需求 R16/R20/R21 + 面板加宽

## 范围（与 M1 文件不相交，可独立跑）

- `src/render/stores/agentStore.ts`：`sendMessage` / `sendAgentMessage` 的**建会话成功分支内**追加首条消息写 summary：
  ```ts
  const firstMsg = trimmed.slice(0, 50);
  await ai.updateConversationSummary(conversationId, userId, firstMsg);
  await get().loadConversations(activeMode);
  ```
  （`conversationId` 已定、`trimmed` 已定义；保留现有 createConversation→loadConversations 逻辑不变）
- `src/render/stores/uiStore.ts`：`aiPanelWidth` 默认改 `480`（初始值 + `loadSettings` 兜底两处），clamp 260~520 不变
- `src/render/stores/rewriteStore.ts`：新增 `dismissRewriteBanner()` —— 仅清 `staleRejected`/`rewriteError`，保留 `pendingRewrite`/`selectionContext`（与现有 `clearRewrite` 区分）
- `src/render/components/AIAgent/RewritePreviewCard.tsx`：无提案各提示条（stale/no-change/locate-failed/no-document/failure）末尾渲染 ✕ dismiss 按钮，`onClick={() => dismissRewriteBanner()}`；有提案卡内 stale 提示不加重叠按钮（头部已有取消）
- 测试：
  - `tests/stores/agentStore.test.ts`（改/扩）：建会话后 mock `updateConversationSummary` 断言调用参数 = 首条 trimmed（截断 50）
  - `tests/stores/uiStore.test.ts`（改）：默认 480、clamp 260~520
  - `tests/stores/rewriteStore.test.ts`（改/扩）：`dismissRewriteBanner` 只清 banner 不清 pendingRewrite
  - `tests/components/AIAgent/RewritePreviewCard.test.tsx`（改/扩）：提示条 × 点击清 error

## 关键实现点

- 不动 `sendMessage`/`sendAgentMessage` 的既有流转与返回；只在建会话分支后追加
- rewriteStore 的 `dismissRewriteBanner` 加到接口与实现，RESET 语义不变
- 测试走项目既有 store 测试模式（vi.mock ipc/preload）

## 铁律

- 铁律一：不新增写路径（summary 写复用现有 updateConversationSummary IPC，AI 仍无直接落盘）
- SECURITY：无 any、无 dangerouslySetInnerHTML、无 SQL

## 门禁

- `npm run typecheck` 0 error | 相关 vitest 全绿 | `npm run lint` 0 error（本模块文件）
- 只返回结构化摘要：{完成项, 测试证据, 未完成项, 风险}
