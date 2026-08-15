---
name: ph5-batch4-d-preview-store
description: 第5期批次4（D 预览 UI + store）实现要点与契约缺口
metadata:
  type: project
---

第 5 期批次 4（D：rewriteDiff / rewriteStore / RewritePreviewCard + i18n + AgentTab 分流）已交付（2026-08-15）。

**关键契约缺口**：plan §5.4 假定 `uiStore` 有 `setAIPanelOpen(true)`，实际 uiStore 只有 `toggleAIPanel`。
本批新增了 `setAIPanelOpen(open)` action（src/render/stores/uiStore.ts）。后续批次若引用该 action 皆有定义。

**rewriteStore 语义要点**：
- 选区触发分两步：`startSelectionRewrite(md, sel)` 只记录 `selectionContext` + `uiStore.setAIPanelOpen(true)`，**不调 IPC**；真正请求在 `runSelectionRewrite(instruction)`（composer 确认后）。
- 错误码内部约定：`rewriteError` 用字符串 `'no-change'` / `'locate-failed'` / 其他 → 卡片映射到 i18n（noChange / locateFailed / failure）。未授权走 `agentStore.setPendingConsent(true)`，不发请求。
- `proposeSelectionRewrite`/`proposeDocumentRewrite` 返回 `unchanged?` / `locateFailed?` → 不弹卡，走错误提示路径。
- `applyRewrite` 是唯一写入点：校验 `editorStore.content === pendingRewrite.originalMd`，不等 → `staleRejected=true` 拒绝；一致 → `updateContent(rewrittenMd)` 入 undo 栈 + `clearRewrite()`。

**RewritePreviewCard**：行级 diff 用 `data-type={type}`（same/del/ins）供测试与样式挂钩（del 红 / ins 绿 / same 灰）；改写后整段 `renderAIMarkdownSafe`；无 dangerouslySetInnerHTML。测试正常化换行，断言用 regex。

**i18n**：`ai.rewrite.*` 三文件键集完全一致（trigger/previewTitle/previewConfirm/previewCancel/applied/noChange/staleRejected/failure/locateFailed/selectionHint/atHint/rewriting）。

**测试**：AgentTab.test 需在 afterEach `resetRewriteStore()`，并 mock `ai.rewrite.selectionHint` 键。
`window.weaveMD.ai.rewritePreview` 已加入 tests/setup.ts 全局 mock（批次2契约）。
