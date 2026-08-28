# table-toolbar — 状态

## 任务分级

| 维度 | 判断 |
|------|------|
| 请求类型 | 功能开发 |
| 影响面 | 编辑器浮动工具栏 + 新增表格工具栏组件 |
| 预估工时 | M（1~2 模块，半天内） |
| 跨模块 | 否（UI 层为主） |

## 进度

- [x] R3: tableCodec 对齐支持 — `TableMatrix.alignments` + parse/serialize
- [x] R1: 棋盘格表格选择器 — `TablePicker.tsx` + FloatingToolbar 集成
- [x] R2: 表格列工具栏 — `TableColumnToolbar.tsx` + TableBlock 集成
- [x] 门禁：tsc 0 新增 | vitest 1499/1499 | lint 0 新增 error

## 变更文件

| 文件 | 变更 |
|------|------|
| `src/render/editor/kernel/tableCodec.ts` | 新增 `ColumnAlign` 类型 + `TableMatrix.alignments` + `parseAlign` + `serializeAlign` |
| `src/render/components/Editor/v2/TablePicker.tsx` | **新建** — 棋盘格表格尺寸选择器 |
| `src/render/components/Editor/v2/TableColumnToolbar.tsx` | **新建** — 列操作工具栏 |
| `src/render/components/Editor/v2/FloatingToolbar.tsx` | OBJECT_BUTTONS 新增 table + TablePicker 弹层 + onInsertTable prop |
| `src/render/components/Editor/v2/ToolbarButton.tsx` | onClick 传递 event 参数 |
| `src/render/components/Editor/v2/blocks/TableBlock.tsx` | 集成列工具栏 + 对齐样式 + commitMatrix 处理 alignments |
| `src/render/components/Editor/v2/blocks/useTableEvents.ts` | 空矩阵 fallback 补齐 alignments |
| `src/render/components/Editor/v2/blocks/tableHelpers.ts` | applyCellText 复制 alignments |
| `src/render/components/Editor/v2/types.ts` | BlockHandlers 新增 onInsertTable |
| `src/render/hooks/useEditorActions.ts` | 新增 onInsertTable 回调 |
| `src/render/components/Editor/v2/EditorV2.tsx` | 传递 onInsertTable 给 FloatingToolbar |
| `src/render/styles/globals.css` | TablePicker + TableColumnToolbar 样式 |
| `tests/editor/kernel/tableCodec.test.ts` | 更新为含 alignments 的矩阵 + 对齐解析测试 |
| `tests/components/TableBlock.test.tsx` | 新增 onInsertTable mock |

## 门禁结果

- typecheck: 0 新增错误（3 pre-existing in ipc.test.ts）
- vitest: 1499/1499 passed（1 pre-existing suite failure in ipc.test.ts）
- lint: 0 新增 error
