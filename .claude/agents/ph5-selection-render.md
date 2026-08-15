# ph5-selection-render

> 第 5 期批次 3（C 渲染侧）：选区读取 + 片段导出 + proposal 计算 + 触发入口。依赖批次 1 类型（RewriteRequestPayload/RewriteProposal/RewriteReply）与渲染内核（selection.ts/blockTree/markdownToState/stateToMarkdown）。

- 职责：新建 `src/render/editor/rewrite/selectionExport.ts`（`readDocumentSelection(content)`：DOM 选区→SelectionRef，跨块 getCrossBlockSelection / 同块 nearestContentSpan+getCursorOffsets / 折叠 null；`[data-block-id]` DOM 序枚举得文档序叶子下标；`exportSelectionMarkdown(content,sel)` 首尾 offset 截取+中间 serializeBlock）；新建 `src/render/editor/rewrite/blockEdit.ts`（`buildNumberedBlockList(content)`；`proposeSelectionRewrite(content,sel,replyText)` 仅替换选区叶子区间、区间外字节不变；`proposeDocumentRewrite(content,numberedBlocks,replyText)` JSON 映射校验、越界→locateFailed；改写==原文→unchanged）；`src/render/components/Editor/v2/FloatingToolbar.tsx` 选区态「AI 改写」按钮→`rewriteStore.startSelectionRewrite`；`src/render/components/AIAgent/AgentTab.tsx` composer `@`+描述→`rewriteStore.startDocumentRewrite`；测试 selectionExport.test + blockEdit.test（新）。
- **注意**：`rewriteStore` 属批次 4 尚未存在——本批先按计划 §5.4 API 签名调 `rewriteStore.startSelectionRewrite(md,sel)` / `startDocumentRewrite(md,instruction)`；为过 typecheck，在 `src/render/stores/rewriteStore.ts` 建**最小占位**（导出类型化 actions，body 抛「批次4实现」或最小状态），批次 4 落地完整实现。
- 铁律：proposal 计算用内核**只算不写**（绝不 updateContent / 写盘）；DOM 读仅 readDocumentSelection 分离；纯函数可单测。
- 关键：SelectionRef 用文档序叶子下标（DOM 序枚举）；同块选区 getCrossBlockSelection 返回 null 需补同块分支；首尾 offset 对 block.text（与渲染文本一致）。
- TDD strict：纯逻辑测试先行；FloatingToolbar/AgentTab 交互组件测试或批次 4 e2e 覆盖。
- 完成后自检：typecheck + 本批 vitest 全绿。
- 返回结构化摘要 `{完成项, 测试证据, 未完成项, 风险}`。
