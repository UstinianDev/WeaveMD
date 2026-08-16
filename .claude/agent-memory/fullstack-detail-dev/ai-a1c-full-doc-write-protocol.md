---
name: ai-a1c-full-doc-write-protocol
description: A1c 整篇写复用 document scope + 空 numberedBlocks，而非新增 RewriteScope；buildRewriteMessages 空数组分支语义
metadata:
  type: project
---

A1c 从 0 到 1 写整篇：**不新增 `RewriteScope` 值（保持 `'selection' | 'document'`）**。整篇写= `document` scope + `numberedBlocks: []`。

关键判定点：
- `buildRewriteMessages`（src/main/ai/rewrite.ts）：`numberedBlocks` 存在但为**空数组**时 → 走 `REWRITE_FULL_DOCUMENT_SYSTEM_INSTRUCTION`（生成完整 Markdown 正文）；`numberedBlocks` **undefined/非数组**时仍抛 `parse` 错误。原实现 `length===0` 直接 throw，A1c 需改为「数组存在即可，空数组走整篇分支」。
- 空文档时 `buildNumberedBlockList` 返回 `[]` → 编号块 JSON 协议失效（`proposeDocumentRewrite` 会 locateFailed）→ 用 `proposeFullDocumentRewrite(content, replyText.trim())`。不回用 proposeDocumentRewrite。
- two render-side entries 共享 `applyRewrite` 唯一写入点（→ updateContent 入 undo）：
  - `runFullDocumentRewrite(instruction)`：composer 整篇写（consent 'chat' 闸 → rewritePreview 空 numberedBlocks → preview）
  - `previewDocumentFromReply(md)`：Agent 回复路径，无需 IPC，当前 content + 回复文本直产 proposal

**Why:** 空文档的 numberedBlocks 天然为空，用 `document` scope 复用既有一条 IPC/preload 管线，无需扩类型或新增通道；主进程仍只产 `{text}`（铁律一，不落盘）。

**How to apply:** 后续若需"整篇写"与"定向块改写"区分 system 指令，判据统一用 `numberedBlocks.length` 而非新增 scope 值。相关 [[ai-main-process-layer]]、[[rewrite-leaf-index-a4]]。
