---
name: ai-redesign-e2e-threeview
description: 三视图 E2E 改写要点 — 会话标题=首条消息的 strict 冲突、预览仅 session 渲染需自动切视图、E2E mock 须持久化 summary/setConfig
metadata:
  type: project
---

AI 面板三视图重构（M3，2026-08-16）后 E2E 改写的关键事实：

1. **会话标题 = 首条消息**（R20/R21）：`agentStore.sendMessage/sendAgentMessage` 建会话后把首条用户消息写入 summary。`agentStore.toggleMode` 只切 `activeMode`，**不 reload conversations 也不清消息**（消息跨 mode 共享）。E2E 断言首条消息字样时，`getByText(msg, {exact})` 会同时命中 `[data-testid="session-title"]`（标题）与消息气泡 → strict violation，须改用 `getByTestId('session-title')` + 唯一 assistant 回复文本。

2. **改写预览卡/状态条只在 session 视图渲染**（`AgentTab` 内）：FloatingToolbar「AI 改写」/ @ document scope / 整篇写触发时，面板若停在 home 视图则预览不可见。需 `AIAgentPanel` 监听 rewriteStore 自动切到 session：
   `rewriteActive = selectionContext!==null || pendingRewrite!==null || rewriting || rewriteError!==null || staleRejected` → `setView('session')`。
   **注意**：selector 须用单个组合回调（`useRewriteStore((s) => a || b || ...)`），勿用 `useRewriteStore(a) || useRewriteStore(b) || ...` 链式多订阅——后者会触发 React `areHookInputsEqual` 崩溃（`Cannot read properties of undefined (reading 'length')`）。

3. **E2E mock（installWeaveMDMock）须持久化才能测标题/RECENT/模型持久化**：`updateConversationSummary` 要写回内存 `conversations[].summary` 并更新 updatedAt；`setConfig` 要更新内存 `mockConfig.model`；另加 `listModels`（默认 `['qwen3.5:0.8b','deepseek-chat']`）。原始 mock 的 `updateConversationSummary` 是 no-op，标题断言会失败。

4. **改写失败条 × 关闭**用「无变化」路径测：`rewrite:{ selectionText: '与原相同' }` → `rewriteError='no-change'`、pendingRewrite=null → 渲染含 `aria-label="关闭"` 的 ✕（dismissRewriteBanner）。stale 拒绝时 pendingRewrite 仍非空，**不渲染** ✕ dismiss，只能测卡内文案。

相关：[[ai-redesign-m3-ui]]、[[rewrite-leaf-index-a4]]。
