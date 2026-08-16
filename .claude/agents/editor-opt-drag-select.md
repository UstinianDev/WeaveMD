# editor-opt-drag-select — 跨块拖选闪烁卡顿优化（性能，L 级/TDD strict）

角色：fullstack-detail-dev | TDD strict | 分支 feat/ai-agent-ph3-ph4 | 需求 req.md §① | 计划 editor-opt-drag-select.plan.md

## 范围

- `src/render/editor/kernel/syntaxType.ts`：`resolveSyntaxTypesInRange`（95-117）加**单槽 memo**（键 = (tree,startLeafId,endLeafId)，失效 = tree 引用变化）+ 导出 `clearSyntaxRangeCache()`。纯函数语义不变。
- `src/render/hooks/useCrossBlockDragSelection.ts`（**实际路径在 hooks/ 非 controllers/**）：mouseup 3 帧重放（223-248）收敛为 **1 次写入前校验**（trusted 零重写；宿主截断失败路径才重写一次 lastRange）。
- 测试（先 RED）：`tests/editor/kernel/syntaxType.test.ts` 加缓存命中/失效/clear 用例；`tests/components/useCrossBlockDragSelection.test.ts` 更新 mouseup 断言（1+3→1+1）+ trusted 放弃重写用例；`e2e/cross-block-selection.spec.ts` 加同构大选区 selectionchange 计数收敛回归。
- **不改** blockTree/markdownToState/FloatingToolbar 结构；`drag-selection-markers` 5 个已知 RED 为任务外**不动**。

## 关键实现点

- 缓存用模块级私有变量 + afterEach 显式 clear；不引入 LRU/WeakMap。
- mouseup 保留失败兜底语义（SPEC-EDIT-FT），仅去重复覆盖。

## 门禁（本模块）

- `npx vitest run tests/editor/kernel/syntaxType tests/components/useCrossBlockDragSelection` 全绿（含先 RED 证据）
- `npm run typecheck` 0 | `npm run lint` 0（本模块文件）| `npx playwright test cross-block-selection drag-selection-move` 全绿
- 只返回结构化摘要：{完成项, 测试证据, 未完成项, 风险}
