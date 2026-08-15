---
name: renderer-batch5-closing
description: AI 面板第3+4期批次5收尾现状 — SettingsModal KB 参数/cagentStore.kbSettings/e2e Agent 流程（渲染层）
metadata:
  type: project
---

第3+4期「批次5 收尾」（渲染层）已交付，相关接线落点（后续改这里不必重新勘测）：

- **KB 参数内存态**：`IKbSettings`（shared/ai.ts，默认 topK5/fuse0.5/threshold0.6/pinnedWeight1.5 + embeddingHost http://localhost:11434 + embeddingModel nomic-embed-text）。渲染唯一持有地 = `agentStore.kbSettings` + `setKbSettings`（zustand，内存态，**持久化留后续**）。`sendAgentMessage` 的 `runAgent` 载荷已透传 `kbSettings`（主进程 agentLoop 消费）。
- **SettingsModal 'ai' Tab**：新增 KB 参数区，草稿 state 打开时从 `agentStore.kbSettings` 同步、Save 时经 `clampNum` 收敛写回 store（仅当 activeTab==='ai'）。i18n 键 `ai.settings.kb.*` 三文件一致。
- **出处 line 滚动（尽力而为）**：`AIMessageBubble.parseRefsJson` 增取 `sourceRef.line`；`handleOpenSource` openFile 成功后按 `content.split('\n').length` 比例滚 `tryScrollEditorToLine(line,total)`（`.editor-scroll-container` DOM-only，60ms 延迟，非阻塞，失败静默仅 openFile）。**不含行号→DOM 映射**，是比例近似，超范围只 openFile。
- **e2e `ai-agent-panel.spec.ts`**：mock 增量 = `ai.runAgent`（可配 `agentResult.withTool/intentCard/backendHint`）+ `kb.{status,list,...}`（`seedKbDocuments`）。原「第 4 期上线占位」用例已替换为 Agent 功能冒烟（批次3 后占位文案不再渲染）。新增 4 用例：Agent 全流程 tool 轨迹、KB 设置区、意图卡片、后端降级。总计 10 条全绿。
- **tab↔mode 联动**：`agentStore.toggleTab(tab)` 一并 set `activeMode: tab`，AIAgentPanel 头部按钮已复用，无需新增联动。

**实证门禁**：`tsc --noEmit` 0 error；`vitest run` 82 文件 1155 全绿；eslint 本批次文件 0 error；`playwright test e2e/ai-agent-panel.spec.ts` 10/10 通过（环境可跑 Chromium）。
