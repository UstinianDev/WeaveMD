# editor-opt-drag-select — 跨块向上拖选闪烁卡顿优化（L 级）

> 2026-08-16 | 需求见 editor-optimization-batch.req.md §① | Plan 智能体产出

## 1. 现状分析（根因确认）

- **疑点 1 属实（主因）**：`toolbarState.ts:117` → `computeToolbarState` 每 rAF 帧调
  `selectionSyntaxTypesConsistent` → `resolveSyntaxTypesInRange`（`syntaxType.ts:95-117`），沿
  `getNextLeaf` 链遍历到 `endLeafId`，无缓存。真实热点是**大区间同构选区**（拖选数百段落/多个
  同行 heading）：每帧全链 O(N)，且 `getNextLeaf` 自身按 parentId 爬链（blockTree.ts:238-253），
  实际 O(N·depth)；`selectionSyntaxTypesConsistent` 在 null 时对反向端点再调一次，成本叠加。
- **疑点 2 属实（次要）**：`useCrossBlockDragSelection.ts:223-248` mouseup 后无条件
  `removeAllRanges + addRange(lastDragRange)` 连续重放 3 帧，每帧 `addRange` 触发
  selectionchange/重绘，光标末端抖动。

## 2. 技术方案

### resolveSyntaxTypesInRange 单槽 memo（主修复）
- 键 = `(tree, startLeafId, endLeafId)`；失效 = `tree` 引用变化（块树不可变，任何变更返回新 tree）。
- 模块级私有缓存 `lastRangeCache: {tree;a;b;result}|null`；导出 `clearSyntaxRangeCache()` 供测试隔离。
- 不引入 LRU/WeakMap（单槽内存有界最简）；惰性失效不埋 mutation 钩子，回归风险最小。
- 方向翻转语义保留：缓存对 (a,b) 与 (b,a) 是不同 key。

### mouseup replay 竞争最小修复
- 3 帧重放收敛为 **1 次「写入前校验」**：`trusted`（anchor/focus 均最近内容 span 且非同一 span
  且 toString().length>0）时零重写；仅宿主边界截断失败路径才 `removeAllRanges + addRange(lastRange)` 一次。
- 单测 `mouseup 末帧兜底与 3 帧重放保留` 断言计数 1+3 → 1+1 同步更新。

## 3. 变更清单

| 文件 | 改动 |
|---|---|
| `src/render/editor/kernel/syntaxType.ts` | `resolveSyntaxTypesInRange` 加单槽 memo + `clearSyntaxRangeCache()` 导出；纯函数语义不变 |
| `src/render/hooks/useCrossBlockDragSelection.ts` | mouseup 3 帧重放收敛为 1 帧写入前校验 |
| `tests/editor/kernel/syntaxType.test.ts` | 新增缓存命中/失效用例（RED）：同 tree+同端点不重扫、tree 变刷新、端点变失效、clear 重置 |
| `tests/components/useCrossBlockDragSelection.test.ts` | mouseup 断言更新 + trusted 时放弃重写用例 |
| `e2e/cross-block-selection.spec.ts` | 新增跨语法同构大选区拖选期间 selectionchange 计数收敛 + 光标静止不重建回归 |

注意：实际路径是 `src/render/hooks/useCrossBlockDragSelection.ts`（需求文档写 controllers/ 有误，以实际为准）。

## 4. 实施步骤（RED → GREEN）
1. 先写测试 RED（syntaxType 缓存 + mouseup 收敛），跑 vitest 确认红。
2. GREEN：改 syntaxType.ts 加缓存；改 hook 收敛重放。
3. 门禁：tsc 0 / vitest 全量 / lint 0。
4. E2E：cross-block-selection + drag-selection-move 全绿；新增同构大选区计数用例绿。
5. 人工验证（真实 Chromium 反向拖选 list+heading+paragraph 无闪烁）。

## 5. 验收标准与回归范围
- 向上跨块选不同语法类型段落：光标不持续闪烁、无明显卡顿。
- 同区间重复调用不重扫（缓存命中）。
- `drag-selection-markers` 5 个已知 RED 为任务外，**不动**。
- e2e/cross-block-selection.spec.ts、drag-selection-move.spec.ts 不回归。

## 6. 风险
- 模块级缓存跨测试共享：需 clearSyntaxRangeCache() afterEach 兜底。
- mouseup 3→1 帧：SPEC-EDIT-FT 失败兜底保留（写入前校验），需反向混合 e2e 覆盖。
- tree 引用恒定依赖 blockTree 不可变；若某些路径无变更重建 tree 引用则安全降级为缓存失效。
