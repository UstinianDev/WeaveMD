# table-toolbar — 实施计划

## 变更清单

### 1. `src/render/editor/kernel/tableCodec.ts` — 对齐支持

- `TableMatrix` 新增 `alignments: ('left' | 'center' | 'right')[]`
- `parseTableText` 解析 `:---` / `:---:` / `---:` → 填充 alignments
- `serializeTable` 根据 alignments 输出对应 separator 行
- 向后兼容：旧代码不传 alignments 时默认 `'left'`

### 2. `src/render/components/Editor/v2/TablePicker.tsx` — 棋盘格组件（新建）

- 6×8 网格，鼠标悬停高亮矩形区域
- 底部：行/列数字输入 + `×` + 确认按钮
- Props: `visible`, `anchorRect`（锚定位置）, `onConfirm(rows, cols)`, `onClose`
- 定位：参考 `InsertUrlModal`，使用 fixed 定位 + anchorRect 偏移
- 点击外部关闭（useEffect document mousedown）

### 3. `src/render/components/Editor/v2/FloatingToolbar.tsx` — 表格按钮

- `OBJECT_BUTTONS` 新增 `{ style: 'table', label: '▦', title: '表格', group: 'object' }`
- 点击 → 设置 `tablePickerOpen` state + 记录按钮位置 `tablePickerRect`
- 渲染 `<TablePicker>` 弹层（类似 `InsertUrlModal` 模式）

### 4. `src/render/hooks/useEditorActions.ts` — 表格插入逻辑

- 新增 `onInsertTable(blockId, rows, cols)` 回调
  - 生成 markdown 表格文本（通过 `serializeTable` 构造空矩阵）
  - 在当前块后插入新 table 块（`insertBlockAfter` + `makeTable`）
  - 焦点恢复到第一个表头单元格
- 传递给 `FloatingToolbar` 新 prop `onInsertTable`

### 5. `src/render/components/Editor/v2/EditorV2.tsx` — 传递 onInsertTable

- 从 `handlers` 解构 `onInsertTable`，传给 `FloatingToolbar`

### 6. `src/render/components/Editor/v2/TableColumnToolbar.tsx` — 列工具栏（新建）

- 水平按钮行：左对齐 | 居中 | 右对齐 | 插入左列 | 插入右列 | 删除列
- Props: `visible`, `blockId`, `colIndex`, `alignment`, `anchorEl`, `onAction`, `onClose`
- `onAction(type: 'left'|'center'|'right'|'insert-left'|'insert-right'|'remove')`
- 定位：锚定到 `<th>` 元素上方（fixed 定位）
- 点击外部关闭

### 7. `src/render/components/Editor/v2/blocks/TableBlock.tsx` — 集成列工具栏

- 新增 state: `colToolbar`（`{ colIndex, anchorEl } | null`）
- 点击 `<th>` → 设置 `colToolbar`，阻止冒泡
- 渲染 `<TableColumnToolbar>`
- `onAction` 回调 → 通过 `commitMatrix` 执行对齐/插入/删除操作
- 传递当前列的对齐信息

### 8. `src/render/components/Editor/v2/blocks/useTableEvents.ts` — 对齐传递

- 从 `matrix.alignments` 读取对齐信息，传递给 `TableBlock`

## 实施顺序

1. R3: tableCodec（基础，其他都依赖它）
2. R1: TablePicker + FloatingToolbar 集成
3. R2: TableColumnToolbar + TableBlock 集成

## 验收标准

同需求文档 `docs/requirements/table-toolbar.req.md`
