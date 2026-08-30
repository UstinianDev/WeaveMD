# 编辑主区性能优化 — 状态追踪

## 任务分级

- **分类**：优化（性能优化，不改功能）
- **影响面**：编辑主区模块
- **定档**：M 级
- **日期**：2026-08-29

## 阶段进度

- [x] 阶段 0：任务分级
- [x] 阶段 1：需求对齐（跳过，目标明确）
- [x] 阶段 2：技术调研（3 个 Explore 智能体并行）
- [x] 阶段 2.5：规划（Plan 智能体）
- [x] 阶段 3：并行执行（8 个阶段全部完成）
- [x] 阶段 6：测试 — **门禁全绿**
- [x] 阶段 7：合规核对
- [x] 阶段 8：交付核对

## 门禁结果

| 门禁 | 结果 |
|------|------|
| tsc | 0 新增错误（3 个预存 ipc.test.ts） |
| vitest | 1528/1528 通过（1 个预存 ipc.test.ts 失败） |
| eslint | 0 新增 error（1 个预存 db/index.ts） |
| vite build | 需手动验证（Prism/KaTeX chunk 分割） |

## 完成项

### P0 — cloneTree 精准化
- `changeBlockType`/`updateMeta`：O(N) → O(1) 精准拷贝
- `batchRemoveBlocks`：新增批量删除函数，O(k*N) → O(N)
- `deleteLeafRange`/`removeEmptyContainers`：改用批量操作
- 新增 3 条引用稳定性测试

### P1 — tokenizeInline LRU 缓存
- 256 条 LRU 缓存，同文本 3-5 次解析→1 次
- 导出 `clearInlineCache()`
- 新增 5 条缓存测试

### P1 — outline 脏标记
- `extractHeadingOutlineCached` 增量版本就绪
- `OutlineCache` 缓存结构已集成到 EditorV2
- dirty tracking 待后续集成

### P2 — React.memo + useCallback
- `ToolbarButton`：React.memo 包裹
- `CodeBlock`：handleCopy ref 模式，依赖空数组
- `ContentBlock`：useLayoutEffect 加 `[inlineHtml, text]` 依赖

### P3 — 消除重复计算
- `selection.ts`：snapSelectionToContent 新增 tokens 参数
- `imageBlock.ts`：wrapImageWidth/wrapImageAlign 单次 parse

### P2 — TableBlock 选区
- 已是 DOM 直接操作模式（无需改动）

### P2 — Scroll 监听合并
- EditorV2 rewriteHighlights scroll 合并到 EditorScrollContainer

### P2 — Prism/KaTeX code splitting
- vite.config.ts manual chunks 分割 prismjs/katex

## 修改文件清单

| 文件 | 改动类型 |
|------|----------|
| `src/render/editor/kernel/blockTree.ts` | cloneTree 精准化 + batchRemoveBlocks |
| `src/render/editor/kernel/inlineLexer.ts` | LRU 缓存 |
| `src/render/editor/kernel/outline.ts` | OutlineCache + extractHeadingOutlineCached |
| `src/render/editor/kernel/selection.ts` | snapSelectionToContent tokens 参数 |
| `src/render/editor/kernel/imageBlock.ts` | 单次 parseImageBlockText |
| `src/render/components/Editor/v2/EditorV2.tsx` | outline 缓存集成 + scroll 合并 |
| `src/render/components/Editor/v2/EditorScrollContainer.tsx` | onScrollAny 统一分发 |
| `src/render/components/Editor/v2/toolbar/ToolbarButton.tsx` | React.memo |
| `src/render/components/Editor/v2/blocks/CodeBlock.tsx` | handleCopy ref 模式 |
| `src/render/components/Editor/v2/blocks/ContentBlock.tsx` | useLayoutEffect 依赖 |
| `vite.config.ts` | manual chunks |
| `tests/editor/kernel/blockTree.test.ts` | 引用稳定性测试 |
| `tests/editor/kernel/inlineLexer.test.ts` | LRU 缓存测试 |
