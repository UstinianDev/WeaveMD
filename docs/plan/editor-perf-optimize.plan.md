# 编辑主区性能优化 — 实施计划

> 目标：性能、速度、质量。严格不改功能。
> 日期：2026-08-29

## 总览

| 阶段 | 优先级 | 风险 | 收益 | 改动文件 |
|------|--------|------|------|----------|
| 1. cloneTree 精准化 | P0 | 中 | 极高 | blockTree.ts |
| 2. tokenizeInline LRU | P1 | 低 | 高 | inlineLexer.ts |
| 3. outline 脏标记 | P1 | 低 | 中 | outline.ts, EditorV2.tsx |
| 4. React.memo + useCallback 补全 | P2 | 低 | 中 | ToolbarButton, LeafBlock, CodeBlock, ContentBlock |
| 5. 消除重复计算 | P3 | 低 | 低 | formatCtrl.ts, selection.ts, imageBlock.ts |
| 6. TableBlock 选区优化 | P2 | 中 | 中 | TableBlock.tsx, useTableEvents.ts |
| 7. Scroll 监听合并 | P2 | 低 | 低-中 | EditorScrollContainer, EditorV2, TableBlock |
| 8. Prism/KaTeX 懒加载 | P2 | 中 | 中 | inlineRenderer.ts, katex.ts, vite.config.ts |

执行顺序：1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

---

## 阶段 1：P0 — cloneTree 精准化

**问题**：`changeBlockType`/`updateMeta` 用 `cloneTree()` 全量拷贝 O(N)；`deleteLeafRange`/`removeEmptyContainers` 级联调用 `removeBlock` 每次 O(N)，总 O(k*N)。

**改动**：
- `changeBlockType` / `updateMeta`：改为 `{ ...tree, blocks: { ...tree.blocks, [id]: { ...block, ... } } }` 精准拷贝
- `deleteLeafRange`：新增 `batchRemoveBlocks(tree, ids)` 批量删除，一次 cloneTree
- `removeEmptyContainers`：批量模式，一次遍历收集空容器 ID，一次删除

**验收**：所有测试通过 + 新增引用稳定性测试

---

## 阶段 2：P1 — tokenizeInline LRU 缓存

**问题**：同一文本在一次编辑中被解析 3-5 次（渲染、选区、格式化）。

**改动**：
- `inlineLexer.ts`：模块级 LRU 缓存（256 条），key=`${text}\x00${start}\x00${end}`
- 导出 `clearInlineCache()`，供 `setBlockText` 调用

**验收**：缓存命中返回值与未缓存一致 + 所有测试通过

---

## 阶段 3：P1 — extractHeadingOutline 脏标记

**问题**：每次 tree 变化（含非标题编辑）都全量序列化所有块计算行号。

**改动**：
- `outline.ts`：新增 `computeOutlineWithCache(tree, cache, dirtyBlockIds)`，仅重算脏块行数
- `EditorV2.tsx`：`outlineCacheRef` + dirty 标记

**验收**：编辑非标题块时 outline 不重算 + 所有测试通过

---

## 阶段 4：P2 — React.memo + useCallback 补全

**改动**：
- `ToolbarButton`：`React.memo` 包裹
- `LeafBlock`：`handleHeadingClick` → `useCallback`
- `CodeBlock`：`handleCopy` 用 ref 缓存 text，依赖空数组
- `ContentBlock`：`useLayoutEffect` 加 `[inlineHtml, text]` 依赖

**验收**：所有测试通过 + 交互不变

---

## 阶段 5：P3 — 消除重复计算

**改动**：
- `formatCtrl.ts`：`formatRange` 入口 tokenize 一次，传参给内部函数
- `selection.ts`：`deleteSelectionContent` 入口 tokenize 一次
- `imageBlock.ts`：`wrapImageWidth` 先 parse 一次，判断 standalone

**验收**：所有测试通过 + 功能不变

---

## 阶段 6：P2 — TableBlock 选区优化

**改动**：`selVersion` 状态 → DOM 直接操作 `table-cell-selected` class

**验收**：拖选不卡顿 + 工具栏正常 + 所有测试通过

---

## 阶段 7：P2 — Scroll 监听合并

**改动**：统一 scroll 事件到 `EditorScrollContainer.onScroll`，分发给各订阅方

**验收**：滚动时大纲/工具栏/高亮均正常 + 所有测试通过

---

## 阶段 8：P2 — Prism/KaTeX 懒加载

**改动**：
- `vite.config.ts`：manual chunks 分割 prismjs / katex
- `inlineRenderer.ts`：语言组件按需动态导入 + fallback 纯文本
- `katex.ts`：懒加载

**验收**：代码块高亮 + 公式渲染正常 + 包体积减小
