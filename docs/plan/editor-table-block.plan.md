# editor-table-block — 实施计划

> 分支 `feat/ai-agent-ph3-ph4` | devflow L 级 阶段 2 交付物 | 2026-08-16
> 唯一输入：`docs/requirements/editor-table-block.req.md`（T1~T6）
> 架构边界：**渲染层结构化**（table 保持叶子块，不改 markdownToState/stateToMarkdown/syntaxType 语义，
> 不引入外部编辑器库）

---

## 1. 技术方案

### 1.1 表格矩阵编解码（kernel 纯函数）

**新增 `src/render/editor/kernel/tableCodec.ts`**（纯 TS，无 React/DOM 依赖，纳入 `kernel/index.ts` 导出）。

```ts
/** 解析后的表格矩阵结构（T1.1） */
export interface TableMatrix {
  header: string[];        // 表头单元格（去格式、去转义后的纯文本）
  rows: string[][];        // 数据行各单元格纯文本；每行长度 = header.length
}

export function parseTableText(text: string): TableMatrix;
export function serializeTable(matrix: TableMatrix): string;
```

**parseTableText 行为规格**：
1. `text.split('\n')` 取行，空 text / <2 行 → 返回 `{ header: [], rows: [] }`（保守空结构，T1.1「空表/畸形表不抛错」）。
2. 第 0 行 = 表头行，第 1 行 = 对齐分隔行（识别决定列数，内容不进入矩阵）。分隔行判定：对**第 1 行**用宽松正则 `^ *\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$` 或至少含一个 `-{3}` 段；不匹配（畸形）→ 返回空结构（保守优先，避免静默丢数据）。实现时用独立 `isSeparatorRow(line)` 辅助函数，注释标明与 `markdownToState.TABLE_SEPARATOR_RE`（L46）独立（不改内核，仅渲染层复用语义一致）。
3. 后续行（index ≥ 2）逐行解析为数据行；每行按单元格切分。
4. **单元格切分**：去首尾 `|` → `split('|')` → 每格 trim → 把 `\|` 解义为 `|`。注意切分时必须**先按未转义的 `|` 切**：
   - 用 `/(?<!\\)\|/` 拆（负向后瞻防已转义），残缺 `\\` 按字面。
   - 行内 `\\|`（转义的反斜杠+竖线）场景按保守字面处理。
   - 每格再 `replace(/\\\|/g, '|')` 解义。
5. **补齐对齐**：每行单元格少于 header 长度 → 尾部补空串；多于 → 截断（matrix 恒矩形，`rows[i].length === header.length`）。这保证增删列后 serialize 稳定，且空格不丢。
6. `\\` 是否解义：首版不做通用反斜杠解义（单元格仅纯文本、无行内格式），仅处理 `\|`。其他反斜杠字面保留。

**serializeTable 行为规格**：
- `header` 行 → `| c1 | c2 |`（每格 `escapeCell` 转义内部 `|` → `\|`，T1.2）。
- 第 2 行固定 `| --- | --- |`（列数对齐，T1.3 不保留原对齐信息）。
- 数据行 `| ... |` 同上。
- 返回 `lines.join('\n')` 无尾部空行。
- 空矩阵（header/rows 均空）→ 返回 `''`（与 parse 空结构互逆）。
- `escapeCell(s) = s.replace(/\|/g, '\\|')`。

**互逆不变量（T1.2/T4.1）**：`parseTableText(serializeTable(m))`（对矩形 m）还原同一列数与各格内容（`|` 经转义/解义闭环）。对齐分隔行经 `serializeTable → serialize → markdownToState` 再解析仍为等价 table（列数一致）。

### 1.2 单元格编辑 DOM/事件模型（渲染层 TableBlock）

**新增 `src/render/components/Editor/v2/blocks/TableBlock.tsx`**（非 ContentBlock 管线，自建交互）。

架构继承：复用 ContentBlock 的「**DOM textContent 是已编辑事实，输入只同步模型、不触发全表 React 重渲染**」核心思想（`syncDomToModel` 的 `lastDomTextRef` 去重写法），但改为**每格一个 `contenteditable="plaintext-only"`**。Chromium 支持该属性，行为即"纯文本、不允许 `Enter` 产生块级换行"（若浏览器把 Enter 插入 `<br>`，在 onInput 层把它剥掉，见 1.4）。

关键数据结构（TableBlock 内部，仅决定**行列数与是否重渲染**）：
```ts
interface CellPos { row: number; col: number }   // row 用 -1 表示表头
const byIndex = (row: number, col: number) => `${row}:${col}`; // td data-cellkey 定位
```

**定位**：每 `<td>`（表头 `<th>`）挂 `data-cellkey={byIndex(row,col)}`；块根挂 `data-block-id`（供 domRegistry/焦点）。渲染由 `parseTableText(block.text)` 驱动，`React.memo` 以 `block.text` 变化触发。

**回写 block.text 管线**（不重渲染路径，T2.3）：
- `onCellInput(tdEl, pos)`：
  1. 读取 `rawText = tdEl.textContent ?? ''`。
  2. **`|` 转义**：若 `rawText` 含未转义 `|`，就地替换 DOM 文本为 `\|` 形式（用 `lastDomRawRef` 差分）——见 1.4「紧耦合 DOM 直改」。
  3. 以 `ref` 保存「最后序列化文本」做差分；若与 `block.text` 未变则跳过。
  4. `parseTableText(block.text)` → 把命中 pos 的单元格内容更新为 rawText（解义前）→ `serializeTable(matrix)` → 得 `newText`。
  5. 调用 **`handlers.onTableEdit(blockId, newText, focusCellPos)`**（新增 BlockHandlers 回调，见下）。
- `onTableEdit` 走**现有 commitTree 管线**（不改 EditorV2 依赖，新增 handler）：
  ```ts
  const onTableEdit = useCallback((blockId, newText, cellPos) => {
    const instance = instanceRef.current; if (!instance) return;
    instance.tree = setBlockText(instance.tree, blockId, newText); // 返回新树
    setTree(instance.tree);
    syncContent();          // ← 解除 updateContent → 入 undo 栈
    tableCellFocusRef.current = { blockId, cellPos }; // useLayoutEffect 消费（见 1.5）
    return;
  }, [commitTree, ...]);
  ```
  纯文本输入时 DOM 已由浏览器更新，React 不重渲染该 td（`setTree` 换了树引用，`TableBlock` 因 `block.text` 变化会重渲染——**需要避免**）。为使「只同步模型不重渲染」，`onTableEdit` 的 setTree 触发 `TableBlock` 重渲染是必要的（text 即 props），但重渲染会重写 td 打断编辑。
  → **解法**：`TableBlock` 内部对**聚焦中的单元格**做「受控不重写」：渲染时若某 cellkey 命中 `editingCellRef`，该 td 用 `suppressContentEditableWarning` + 只写 textContent 一次且**记录 lastDomTextRef 跳过后续注入**（复用 ContentBlock 的 `lastDomTextRef` 精确范式）；`block.text` 变化时，React 重渲染后 `td.textContent` 会被 React 重置为矩阵值 —— 因矩阵值 = 用户最后编辑值（同源串行化），**重写前后 textContent 相同，浏览器光标不受影响**（仅当 text 真变了才触发重渲染；重渲染后 textContent 相等 → 光标保留）。此为「幂等重渲染」策略，对行列不变的情况零跳变。
  - 边界：**增删列/行**改变 `td` 集合与 cellkey，原生 DOM 被 React reconcile 重建 → 光标必然丢，符合需求（T3.2 重建 DOM 后聚焦目标格）。

**新增 BlockHandlers 回调**（`types.ts`，不改既有 handler 签名）：
```ts
onTableEdit: (blockId: string, text: string, focus?: { row: number; col: number } | null) => void;
```
只新增一个 `onTableEdit(blockId, newText, focusCell?)`。增删行列 = 渲染层改矩阵 → serialize → 调用同一个 `onTableEdit`（focus 指定落焦点格）。这样只动 `types.ts` 的 `BlockHandlers` + `useEditorActions` 一处。

### 1.3 增删行列（悬停手柄，T3）

手柄为纯 CSS overlay，`contentEditable=false`（T3.4），不入表格文本：
- 列顶「+」：悬停表头 cell 时显示在列右侧 → 新增一列（header + 每数据行同 index 插空串）。
- 行首「+」：悬停某数据行左侧显示 → 该行下方 insertBlock 空数组行。
- 列顶/行首「−」：删除该列/该行（T3.1）。**表头行可编辑但删除手柄只作用于数据行**（marktext 语义）。表头行本身是 thead 第一行，不提供整行删除。
- 边界（T3.3）：`rows.length === 0` 或 `colCount === 1` 时对应「−」隐藏/禁用；新增格空串。
- 增删后 `serializeTable` → `onTableEdit(newText, focus靶格)` → 重建 DOM（reconcile）→ 焦点落 target（见 1.5）。

位置：`row===-1`（thead 格）col 悬停 → 列顶 +/−；`col===-1` 虚拟左列（thead 前 + 每数据行前）→ 行首 +/−。用 CSS `:hover` + 内联按钮（每个 th/td 左侧空列窄槽）。

### 1.4 跨格导航 Enter/Tab/Shift+Tab（T2.5/T2.6）

每个 cell `onKeyDown`：
- **IME 守卫**：`compositionstart` 置 `composingRef.current=true`，期间忽略导航键与 `|` 转义；`compositionend` 复位并手动 `onCellInput` 一次（复用 ContentBlock 范式）。
- **Enter（非 Shift）**：`preventDefault()`；同列下一行；若当前为末行 → **新增一行并聚焦新行同列首格**（T2.5），即调用 `onTableEdit(serialize(增行), focus:{row:rows.length, col})`。**单元格内不产生换行**：Enter 永远 preventDefault。
- **Shift+Enter**：需求未要求 → 也 preventDefault 统一（不产生 `<br>`），或忽略。保持 preventDefault。
- **Tab**：`preventDefault()`；下一格（行末→下一行首列）；末行末列 → 新增行聚焦新行首列。
- **Shift+Tab**：上一格（行首→上一行末列）。
- 导航后 `setCursorAtOffset(cellEl, 0)`（T2.6 offset 0）。导航**不触发 syncContent**（无文本变更），仅移动焦点；若导航伴随新增行列（Enter/Tab 末格）则走 `onTableEdit` 增行 + focus。

**`|` 转义时序（T2.4）**：在 `beforeinput`（`insertText`/`insertCompositionText`/`insertFromPaste`）与 compositionend 的 `onCellInput` 里，取 `data ?? current.textContent`，若含 `|`：`preventDefault()` 阻断原生插入，改为程序化在光标处写入 `\|`（走 DOM 直改 + 同步模型），并 `setCursorAtOffset` 到 `\|` 之后。粘贴含 `|` 同理（去换行为空格或逐段转义：首版粘贴文本先 `replace(/\n/g,' ')` 去除可能产生的格内换行，再逐 `|` 转义）。**紧耦合 DOM 直改**：转义在 DOM 与 model 同步完成，`lastDomTextRef` 更新，不触发 React 重渲染。

### 1.5 焦点/光标恢复（跨格编辑与增删行列）

新建模块化 ref：TableBlock 用 `pendingCellRef = useRef<{cellkey:string}|null>`，`useLayoutEffect`（paint 前）取 `querySelector('[data-cellkey=…]')` 后 `el.focus({preventScroll:true})` + `setCursorAtOffset(el, 0)`；消费即清空。若树变化触发 `TableBlock` 重渲染（增删行列），组件重挂/重 reconcile 后仍用同 cellkey 定位恢复。对**同 tree 引用**（无行列变化）由 `onTableEdit` 直接同步 `setCursorAtOffset`；对**新 tree**（增删行列）由 pendingCellRef + useLayoutEffect 兜底——完全对齐 `useEditorActions.applyBlockAction` 的「树同引用立即恢复 / 树变 setPendingFocus」双分支，但把 pending 下沉到 TableBlock 局部，避免改全局 useFocusRestore 契约。

### 1.6 撤销栈集成（T5.2/T4.2）

- **单元格编辑/增删行列均经 `updateContent` 入栈**：`onTableEdit → setTree + syncContent → onContentChange(updateContent)`，每次 syncContent 压一个 undo 条目 —— 现成管线，零新增。但**问题**：单元格连续输入（如输 5 个字符）会压 5 个 undo 条目，撤销粒度过碎。
- **决策（不阻塞，记录为已知限制）**：首版按「每次 onCellInput 一次 syncContent」实现简洁可测；细粒度合并（输入突持续 > 1s 才入栈）视为 polish，若门禁期时间允许再做，否则记录 `known-limitation`。
- Ctrl+Z/Y 在 cell `onKeyDown` 直接 `handlers.onUndo()/onRedo()`（对齐 ContentBlock 的 formatShortcut 分支）。**撤销后整树重建**，焦点回到文档首（沿 `content → setContent → 重建树`，现有的全局限制），对 table 编辑可接受（记录）。

### 1.7 T4 消费者兼容（不改内核）

- **markdownToState/stateToMarkdown/syntaxType 完全不改**：table 仍叶子块，`text` 存规范多行 markdown；`stateToMarkdown` 按行原样输出（T4.1/T4.3）。`resolveSyntaxType(table)` L67 保持。
- **selection/rewrite/outline**：table 无 `.block-content` span → 跨块选区 `getCrossBlockSelection`/重写高亮对 table 无法命中，行为保持现状（T4.2 要求）。`outline` 基于 `serializeBlock` 行数计行，table 多行计行不变。
- **AI 改写**：table 无 `.block-content` → `nearestContentSpan` 返回 null → 改写保守禁用，保持现状（T4.2）。

### 1.8 只读约束（T5.4）

- 对齐分隔行**不渲染**（解析后丢弃，T2.1）。
- thead 外壳、手柄、表格边框容器 `contentEditable=false`。
- 表格内不出现源码文本（渲染 `<table>` 网格，非 `<pre>`）。

---

## 2. 变更清单（文件级）

### 新增
| 文件 | 类型 | 职责 |
|---|---|---|
| `src/render/editor/kernel/tableCodec.ts` | 新增 | 纯函数 `parseTableText`/`serializeTable`/`TableMatrix`（T1） |
| `src/render/components/Editor/v2/blocks/TableBlock.tsx` | 新增 | 可编辑 `<table>` 网格 + 单元格编辑 + 增删行列手柄 + 跨格导航（T2/T3） |
| `tests/editor/kernel/tableCodec.test.ts` | 新增 | kernel 单测（T6.1） |
| `tests/components/TableBlock.test.tsx` | 新增 | 组件测试（T6.2） |
| `e2e/editor-table.spec.ts` | 新增 | Playwright E2E（T6.3） |

### 修改
| 文件 | 类型 | 改动 |
|---|---|---|
| `src/render/editor/kernel/index.ts` | 修改 | `export * from './tableCodec';` |
| `src/render/components/Editor/v2/types.ts` | 修改 | `BlockHandlers` 增 `onTableEdit(blockId,text,focus?:{row,col}|null)` |
| `src/render/hooks/useEditorActions.ts` | 修改 | 新增 `onTableEdit` 回调（setBlockText + setTree + syncContent），并入 `handlers` useMemo 依赖 |
| `src/render/components/Editor/v2/blocks/LeafBlock.tsx` | 修改 | `case 'table'` 由只读 `<pre>` 改为渲染 `<TableBlock block handlers blockWidthMap />`（保留 `data-block-id` 外壳） |

### 明确不改（T4 边界）
| 文件 | 原因 |
|---|---|
| `src/render/editor/kernel/markdownToState.ts` | table 解析语义保持（不改叶子块/切分） |
| `src/render/editor/kernel/stateToMarkdown.ts` | table 行输出保持 |
| `src/render/editor/kernel/syntaxType.ts` | table → `{type:'table'}` 保持 |
| `src/render/editor/kernel/types.ts` | `LEAF_BLOCK_TYPES` 含 table 保持，不容器化 |
| `src/render/editor/kernel/blockTree.ts` | `setBlockText` 已够用，不加 table 特化 API |
| `src/render/editor/kernel/selection.ts` | 现有光标 API 复用 |
| `src/render/components/Editor/v2/EditorV2.tsx` | 不经 EditorV2 改，`onTableEdit` 由 useEditorActions 注入 handlers 即可 |
| `FloatingToolbar` / `toolbarState.ts` / `canConvertBlock` | T5.3：不新增 paragraph→table 转入；table→paragraph 保持 |

---

## 3. 模块拆分（可并行子任务）

| 模块 | 职责 | 关键文件 | 依赖 | 验收断言 |
|---|---|---|---|---|
| **M1 kernel 编解码** | `parseTableText`/`serializeTable` 纯函数 + 互逆不变量 | `kernel/tableCodec.ts`、`kernel/index.ts`、`tests/editor/kernel/tableCodec.test.ts` | 无 | `parse(serialize(m))===m`；`\|` 转义/解义；畸形空结构保守不抛错；对齐分隔容错；与 `markdownToState/stateToMarkdown` 端到端往返（T6.1） |
| **M2 渲染 + 单元格编辑** | TableBlock 网格渲染、细胞输入回写 text、`\|` 转义、`onTableEdit` handler 贯通 | `blocks/TableBlock.tsx`、`LeafBlock.tsx`、`types.ts`、`useEditorActions.ts`、`tests/components/TableBlock.test.tsx` | M1 | 渲染 thead+tbody 结构；onInput 回写 `block.text` 为规范 md；`\|` 自动转义；不触发整表非必要重渲染（幂等重渲染） |
| **M3 增删行列 + 导航** | 悬停 +/- 手柄、Enter/Tab/Shift+Tab 跨格、增删后重建 DOM 与焦点恢复、边界（1列/删空） | `blocks/TableBlock.tsx`（回调沿用 M2 的 `onTableEdit`）、组件测试扩充、E2E | M2 | 增删行列更新 text；边界正确；导航焦点落 offset 0；末格 Enter/Tab 增行聚焦 |
| **M4 集成 + 全量测试** | useEditorActions 接线回归、撤销链路、往返重解析 E2E、门禁 | 全部 + `e2e/editor-table.spec.ts` | M1+M2+M3 | 撤销回退单元格编辑/增删行列；`stateToMarkdown(markdownToState(编辑后text))` 等价；tsc0/vitest/lint/vite/Playwright 全绿 |

并行：M1 先行（纯函数无依赖）；M2/M3 可部分并行（M3 依赖 M2 的 `onTableEdit` 通道，但手柄布局 UI 可并行开发）；M4 收口。**TDD strict**：每个模块先写测试再实现。

---

## 4. 验收标准（映射 T1~T6）

| 需求 | 可测断言 |
|---|---|
| T1 | `parse/serialize` 互逆、对齐容错、保守空结构（单测）；与内核往返（T6.1） |
| T2 | 单元格点击可编辑；onInput → text 为规范 md；`\|` 转义；Enter/Tab/Shift+Tab 导航；格内无换行（组件测试 + E2E） |
| T3 | 悬停手柄增删行列、边界 1 列/删空、新增格空串（组件测试 + E2E） |
| T4 | 编辑后 text 经 stateToMarkdown/markdownToState 重解析等价；table 仍叶子块；selection/rewrite/outline 无回归（E2E 往返 + 既有测试绿） |
| T5 | 块聚焦编辑；撤销可回退编辑与增删行列；工具栏不新增转入、table→paragraph 保持；只读行/外壳不可编辑 |
| T6 | tableCodec.test / TableBlock.test / editor-table.spec 全绿 |

**门禁**：`tsc --noEmit` 0 error；`vitest run` 全绿（新增约 M1~M3 20-30 例）；ESLint 0 error（容忍既有 warning）；`vite build` 成功；`npx playwright test` 全绿（新增 editor-table 用例）。

---

## 5. 风险与决策

| 风险 | 影响 | 应对 |
|---|---|---|
| contenteditable 内 IME 输入 | 中文组合被打断/`\|`误转义 | 复用 `composingRef` + compositionstart/end 守卫；组合期间跳过导航与转义 |
| `\|` 转义时序 | 输入 `|` 瞬间进入 model 造成二次重写跳位 | beforeinput preventDefault + 程序化写 `\|` + lastDomTextRef 差分，DOM与模型同步、禁止重渲染 |
| 「只同步模型不重渲染」被 text 变化触发重渲染 | 打断编辑 | 幂等重渲染：重渲染后 textContent 与编辑值同源相等，光标不跳；聚焦格 lastDomTextRef 兜底 |
| 撤销粒度过碎（每字符一步） | Ctrl+Z 需连按多下 | 首版每次 onInput 一步 syncContent（简洁可测）；突持续合并 polish 记录 known-limitation |
| 光标恢复（增删行列后） | 重建 DOM 丢焦点 | TableBlock 局部 pendingCellRef + useLayoutEffect 按 cellkey 恢复（对齐 applyBlockAction 双分支模式，不改全局 focusRestore） |
| Enter 导致 `<br>` | 破坏了「格内无换行」 | Chromium `plaintext-only` + keydown Enter preventDefault 双重保障 |
| 粘贴多行/`|` | 产出多列或格内换行 | 粘贴先 `replace(/\n/g,' ')` 去换行 + 逐 `|` 转义 |
| Chromium/jsdom 差异 | jsdom 无 contenteditable 行为 | kernel 纯函数单测 + Playwright 真实 Chromium 兜真实行为；组件测试用 fireEvent 模拟 |
| 对齐分隔行信息丢失（T1.3 T4.1） | 原 `:---:` 变 `---` | 需求明示首版固定 `---`，属允许归一化；往返按「列数/内容等价」断言 |

---

## 附：关键数据流（执行子智能体照做）

```
T2 单元格输入:  td.onInput → onCellInput(td,pos)
               → 读 textContent → lastDomTextRef 差分 → | 转义(紧耦合DOM直改)
               → parseTableText(text) → 更新 matrix[pos] → serializeTable
               → handlers.onTableEdit(blockId, newText)
               → useEditorActions.onTableEdit: instance.tree = setBlockText(...) → setTree + syncContent
               → updateContent 入 undo 栈
               → TableBlock re-render: 幂等重渲染(textContent 相等, 光标保留)

T3 增删行列:   TableBlock handler → 改 matrix → serializeTable → onTableEdit(newText, focus靶格)
               → setTree(新引用) → TableBlock reconcile 重建 DOM → pendingCellRef + useLayoutEffect 恢复焦点

T2.5 跨格导航: cell.onKeyDown(Enter/Tab/Shift+Tab) → preventDefault
               → 纯导航: setCursorAtOffset 目标格 offset 0, 不 syncContent
               → 末格 Enter/Tab: matrix 增行/列 → serialize → onTableEdit 增行 + 聚焦
```

### 实现顺序
1. M1 `tableCodec.ts` + `tableCodec.test.ts`（先行，纯函数无阻塞）。
2. M1 完成后 `types.ts` 加 `onTableEdit` → `useEditorActions` 接线（空实现占位）→ `LeafBlock` table 分支连 `TableBlock`。
3. M2 TableBlock 网格渲染 + 单元格编辑 + 转义。
4. M3 手柄 + 导航。
5. M4 E2E + 撤销回归 + 门禁。
