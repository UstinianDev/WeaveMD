# editor-table-refactor — 实施计划

## 变更清单

| # | 文件 | 动作 | 说明 |
|---|------|------|------|
| 1 | `src/render/components/Editor/v2/blocks/tableHelpers.ts` | **新建** | 纯函数 + 类型：`CellPos`、`TableCellEl`、`byIndex`、`TEXT_INPUT_TYPES`、`applyCellText`、`nextCell`/`prevCell` |
| 2 | `src/render/components/Editor/v2/blocks/useTableEvents.ts` | **新建** | 自定义 hook：封装 `composingRef`、`lastDomTextRef`、`pendingCellRef` + 事件处理器（`handleCellInput`、`handleNativeBeforeInput`、`handleCellKeyDown`、`cellEvents`、`commitCell`、`commitMatrix`、`appendRow`） |
| 3 | `src/render/components/Editor/v2/blocks/TableBlock.tsx` | **重写** | 精简为纯 JSX 编排（≤120 行）：调用 hook + 渲染 header/body cells |
| 4 | 测试文件（3 个） | **不动** | 全部保持原样 |
| 5 | `tableCodec.ts` 及内核集成点 | **不动** | 保持原样 |

## 拆分架构

```
tableHelpers.ts     纯函数 + 类型（无 React 依赖）
  ├── CellPos, TableCellEl（类型）
  ├── byIndex, TEXT_INPUT_TYPES（常量）
  ├── applyCellText（矩阵操作）
  └── nextCell, prevCell（导航计算）

useTableEvents.ts   自定义 hook（React 依赖）
  ├── refs: composingRef, lastDomTextRef, pendingCellRef
  ├── state: hover
  ├── commitCell, handleCellInput
  ├── handleNativeBeforeInput（beforeinput 拦截）
  ├── handleCellKeyDown（Enter/Tab/Ctrl+Z/Y）
  ├── cellEvents（公共事件绑定生成器）
  ├── commitMatrix, appendRow
  └── focusCell, cellByPos

TableBlock.tsx       薄编排器（≤120 行）
  ├── useTableEvents(block, handlers)
  ├── headerCells JSX（th + 列手柄）
  ├── bodyRows JSX（td + 行手柄）
  └── useLayoutEffect 焦点恢复
```

## 关键约束

1. `cellEvents` 返回的对象结构不变（`contentEditable`、`onInput`、`onCompositionStart`、`onCompositionEnd`、`onKeyDown`、`onMouseEnter`、`ref`）
2. `onTableEdit(blockId, text, focus?)` 调用方式不变
3. `data-cellkey` 格式 `"row:col"` 不变
4. 手柄按钮的 `data-action` 值不变
5. CSS 类名不变（`table-block`、`table-block-grid`、`table-cell`、`table-col-handles`、`table-row-handles`）

## 验收标准

1. 现有 40 个单测全部通过
2. E2E 测试全部通过
3. `TableBlock.tsx` ≤ 120 行
4. 无新增 `any` 类型
5. `npm run typecheck` 零错误
6. `npm run lint` 零错误
