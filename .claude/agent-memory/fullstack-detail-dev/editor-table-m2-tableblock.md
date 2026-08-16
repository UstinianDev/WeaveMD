---
name: editor-table-m2-tableblock
description: 可编辑表格块 M2 TableBlock 渲染层的实现坑与边界（转义双重转义、Enter/Tab 语义、jsdom 折叠选区测量）
metadata:
  type: project
---

# 表格块 M2：TableBlock（渲染层）实现要点

## 关键事实
- `onTableEdit(blockId, text, focus?)` 已加入 `BlockHandlers`（types.ts L163-170），useEditorActions 只消费前两参（setBlockText + commitTree 入撤销栈），focus 只用于增删行列后重建 DOM 的恢复，由 TableBlock 局部 `pendingCellRef` + useLayoutEffect 按 `data-cellkey` 恢复。
- `cellkey = "row:col"`，表头 row=-1（`byIndex(-1, col)`）。
- **矩阵域 = 解义文本**（`\|`→`|`）：`parseTableText` 解义、`serializeTable` 转义。所以 commitCell / beforeinput 落到模型前必须 `rawDom.replace(/\\\|/g,'|')`，否则双重转义（`x\|y` 变 `x\\|y`）。DOM 显示保留转义形态 `x\|y`。
- beforeinput 需 `e.preventDefault()` + 程序化写 `\|`（粘贴先 `replace(/\n/g,' ')`）。
- Enter=同列下行（NOT nextCell!）；Tab/Shift+Tab=nextCell/prevCell（列优先）；末格增行走 appendRow。
- 行删除边界 = `rowCount > 0`（删至 0）；列删除边界 = `colCount > 1`。

## 关键坑（含 why）
1. **jsdom 折叠选区测量**：`sel.getRangeAt(0).cloneRange().setEnd(anchorNode, anchorOffset)` 对折叠选区（collapse，start===end）`.toString()` 返回空字符串 → caret=0 错误。必须 `createRange(); selectNodeContents(el); setEnd(pt.startContainer, pt.startOffset).toString()`（对齐 selection.ts `offsetBeforeRange`）。见 [[rewrite-highlight-leaf-index-a3]] 的 DOM 选区测量亲缘。
2. **`el.textContent` 未转义 `|` 应在模型前规范化**：readAndEscape 若先改写 lastDomTextRef 会造成 false-skip（diff 恒等式恒真 → 永不 commit）。正确顺序：读 rawDom → 与 lastDomTextRef diff → 转义只写回 DOM → lastDomTextRef=转义 → commit 解义值。
3. **README/测试 helper 用 `makeTable` 需真实 blocks map**：`makeTable(tree)` 调 `generateBlockId(tree)` 访问 `tree.blocks`，传 `{}` 会崩。构造 `{ root, blocks: {} }`。

## How to apply
- 改表格渲染层时优先查本文件；转义/双击转义、导航语义、焦点恢复是三类易错点。
- 组件测试用 `makeTable(makeDummyTree(), text)` 建块；交互用 fireEvent/原生 dispatch + 显式构造折叠 Range（不依赖 jsdom focus 重置）。
