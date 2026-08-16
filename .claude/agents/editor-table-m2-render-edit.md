# editor-table-m2-render-edit — 渲染层 TableBlock：单元格编辑 + 增删行列 + 导航（T2/T3，依赖 M1）

角色：fullstack-detail-dev | TDD strict | 分支 feat/ai-agent-ph3-ph4 | 需求 T2.1~T2.6 + T3.1~T3.4

## 前置依赖

- **M1 已完成**：`src/render/editor/kernel/tableCodec.ts` 提供 `parseTableText`/`serializeTable`/`TableMatrix`。
  先读 `docs/plan/editor-table-block.plan.md` §1.2~1.5 + `kernel/tableCodec.ts`。

## 范围

- `src/render/components/Editor/v2/blocks/TableBlock.tsx`（**新**）：可编辑 `<table>` 网格。
  - 渲染：`<div data-block-id>` 外壳 + `<table>`（thead 表头行 + tbody 数据行），分隔行不渲染；
    每格 `<td>`/`<th>` `contenteditable="plaintext-only"` + `data-cellkey="row:col"`（row -1=表头）。
  - 单元格输入：`onCellInput(td,pos)` 读 textContent → `|` 转义（未转义 `|`→`\|`，DOM 直改+同步模型）→
    更新矩阵 pos → `serializeTable` → `handlers.onTableEdit(blockId, newText)`。
    **幂等重渲染**：聚焦格用 `lastDomTextRef` 差分，重渲染后 textContent 与编辑值同源相等，光标不跳。
  - `|` 转义时序（T2.4）：`beforeinput` insertText/insertCompositionText/insertFromPaste 时取 data，
    含 `|` → preventDefault + 程序化写 `\|` + `setCursorAtOffset` 到 `\|` 后；粘贴先 `replace(/\n/g,' ')`。
  - IME 守卫（compositionstart/end `composingRef`），组合期间跳过导航与转义。
  - 跨格导航（T2.5/T2.6）：Enter=同列下一行（末行→增行聚焦）、Tab=下一格（末格→增行）、Shift+Tab=上一格；
    Enter 永远 preventDefault（格内无换行）；导航后 `setCursorAtOffset(cellEl, 0)`。
  - 增删行列（T3）：悬停手柄（列顶/行首 +/-，`contentEditable=false`，纯 CSS overlay）；
    列顶「+」列右侧插列、「−」删列；行首「+」行下插行、「−」删数据行；边界 1 列/删空禁用；
    增删后改矩阵 → `serializeTable` → `onTableEdit(newText, focus靶格)` → reconcile 重建 DOM。
  - 焦点恢复（T1.5）：局部 `pendingCellRef` + `useLayoutEffect` 按 cellkey `focus({preventScroll:true})` + `setCursorAtOffset(el,0)`。
- `src/render/components/Editor/v2/types.ts`：`BlockHandlers` 增 `onTableEdit(blockId, text, focus?: {row,col}|null)`（不改既有签名）。
- `src/render/hooks/useEditorActions.ts`：新增 `onTableEdit` 回调（`setBlockText` + `setTree` + `syncContent`），并入 `handlers` useMemo 依赖。
- `src/render/components/Editor/v2/blocks/LeafBlock.tsx`：`case 'table'` 改为渲染 `<TableBlock block handlers />`（保留 `data-block-id` 外壳）。
- `tests/components/TableBlock.test.tsx`（**新**，先写 RED）：渲染 thead+tbody 结构、onInput 回写 text、
  `\|` 转义、增删行列更新 text、Enter/Tab 导航焦点、边界 1 列/删空。

## 关键实现点

- **不改** markdownToState/stateToMarkdown/syntaxType/types(LEAF)/blockTree/selection/EditorV2/工具栏。
- 单元格编辑**不复用 ContentBlock**（矩阵非单块 text），但复用「DOM textContent=事实源、只同步模型」思想。
- 增删行列/编辑均经 `onTableEdit → syncContent → updateContent` 入撤销栈。
- Ctrl+Z/Y 在 cell onKeyDown 走 `handlers.onUndo()/onRedo()`。

## 门禁

- `npx vitest run tests/components/TableBlock.test.tsx` 全绿（含先 RED 证据）+ 既有 `EditorV2*` 测试不回归
- `npm run typecheck` 0 error | `npm run lint` 0 error（本模块文件）
- 只返回结构化摘要：{完成项, 测试证据, 未完成项, 风险}，附 TableBlock 关键 props、onTableEdit 签名、测试断言清单。