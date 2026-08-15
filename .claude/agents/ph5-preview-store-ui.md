# ph5-preview-store-ui

> 第 5 期批次 4（D 预览 UI + store）：rewriteDiff / rewriteStore / RewritePreviewCard + i18n。依赖批次 2 proposal 契约与批次 3 触发签名。

- 职责：新建 `src/render/filters/rewriteDiff.ts`（行级 LCS diff，纯函数）+ `src/render/stores/rewriteStore.ts`（状态机：pendingRewrite/rewriting/rewriteError/staleRejected + startSelectionRewrite/startDocumentRewrite/applyRewrite/clearRewrite）+ `src/render/components/AIAgent/RewritePreviewCard.tsx`（红删绿增 + renderAIMarkdownSafe + 确认/取消）+ i18n 三文件 `ai.rewrite.*`；测试 rewriteDiff/rewriteStore/RewritePreviewCard（新）。
- **applyRewrite 铁律**：校验 `editorStore.content === proposal.originalMd`，不等 → staleRejected 提示不写入；一致 → `updateContent(proposal.rewrittenMd)`（入 undo 栈一次可撤销）+ clear。consent 闸复用 `needsConsent(config,consent,'chat')` + agentStore pendingConsent。选区触发开 AI 面板 `uiStore.setAIPanelOpen(true)`。
- 无 dangerouslySetInnerHTML（复用 renderAIMarkdownSafe 白名单）。
- TDD strict：rewriteDiff 纯函数与 rewriteStore 状态机测试先行；卡片组件测试。
- 完成后自检：typecheck + 本批 vitest 全绿。
- 返回结构化摘要 `{完成项, 测试证据, 未完成项, 风险}`。
