---
name: rewrite-leaf-index-a4
description: A4 选区改写叶序下标修复——readDocumentSelection 启用 _content 求叶序，但不可按 id 匹配（newBlockId 随机）
metadata:
  type: project
---

第 7 期批次① A4 bug（选区改写落错块）修复，提交 `6ef1f54`（2026-08-15）。

**需求（A4）**：`readDocumentSelection` 的叶子下标源是 DOM `[data-block-id]` 序（含容器 div：list-block/BlockRenderer.tsx:40、code-fence/CodeBlock.tsx:49、blockquote/BlockquoteBlock.tsx:23、list-item/ListItemBlock.tsx:33），而替换应用在 `markdownToState` 解析树 `documentOrderLeaves`（只取叶子）的叶序上。含容器文档下标偏大 → 落错块。

**关键坑（偏离计划文字）**：计划字面写「在该树 documentOrderLeaves 列表中 indexWhere(b => b.id === startBlockId)」按 id 匹配——**这是不可行的**：`blockTree.ts newBlockId` 含 `Math.random()`，每次 `markdownToState` 生成全新随机 id，DOM `.block-content` span 的 blockId 永远无法在重解析树中命中。若照实现会 100% 返回 null（改写完全失效）+ 破坏既有测试。

**实际落地**（`selectionExport.ts`）：
- 启用 `_content` 参数，用它 `markdownToState` 解析一次得权威叶序结构。
- 用 DOM `.block-content` span（每个文本叶恰一个，文档序=叶序）按「文档序位置」映射到解析树叶序下标，非按 id。
- 同步校验：解析内容叶数与 DOM `.block-content` 数一致 + 逐叶 `stripZeroWidth` 文本对齐；任一失同步 → 返回 null（保守禁用）。
- 内容叶判据 `rendersContentSpan`：paragraph/heading/code-block 才渲染 `.block-content`；thematic-break/image/table 无 `.block-content`，须在映射时跳过（否则计数错位）。
- SelectionRef 的 startBlockId/endBlockId 仅供 UX，叶序下标来自 `_content`。

**Why**：跨解析 id 漂移是既有设计约束（blockEdit.ts 头注释、ph7 plan §0.3 均强调「blockId 不跨解析作定位键，一律叶序下标」），但 plan 1.1.1 又自相矛盾地要求按 id 匹配。唯一稳健的跨 DOM↔解析 链接是文档序位置 + 文本对齐。

**How to apply**：后续批次（②A1、③A3 高亮、B1 @）凡在 readDocumentSelection/SelectionRef 之上做「叶序下标 → 当前 DOM 高亮定位」的，一律用「叶序下标 → markdownToState 当前树该位置叶子 → 其 DOM content span」瞬时映射，不要尝试把 DOM blockId 存为跨解析键。既有 selectionExport.test.ts 用例的 content 须为规整 markdown（相邻非空行会聚合为单叶，旧用例『first block\nsecond block』非规整，已改为空行分隔）。
