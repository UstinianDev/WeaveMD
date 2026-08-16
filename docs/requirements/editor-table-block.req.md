# editor-table-block — 需求文档

> 2026-08-16 | grill-me 已对齐（AskUserQuestion 一次确认）
> 任务 = 编辑主区 v2 可编辑表格块（单元格编辑、增删行列、markdown 往返不变式）

## 目标

将 v2 现有「整块只读 `<pre>` 源码展示」的 table 叶子块升级为**可编辑表格块**：

1. 单元格点击即可编辑（纯文本）；
2. 悬停手柄增删行/列；
3. markdown 双向转换守住文本输出不变式（往返不变量）；
4. 编辑器/工具栏集成不回归。

## 已对齐决策（grill-me，一次确认）

| 决策点 | 结论 |
| --- | --- |
| 架构路径 | **渲染层结构化**：table 保持叶子块，`block.text` 存规范化 markdown；渲染层解析为 `<table>` 网格，单元格编辑 → 矩阵 → 回写 text。不改内核块结构（table 不容器化），对 selection/AI 改写/outline 零破坏。 |
| 单元格能力 | **仅纯文本**：单元格只存纯文本，不支持加粗/斜体/代码等行内格式；往返无歧义。 |
| 增删行列交互 | **悬停手柄**（marktext 风格）：鼠标悬停时行首/列顶显示 +/- 手柄，点击增删。 |
| 任务外阻塞 | **仅报告，不处理**：electron-builder MSI 缺图标（`public/icons/icon.png` 从未提交）、Playwright `drag-selection-markers` 5 个已知 RED，均另开任务。 |
| 返回不变式 | text 存规范 markdown → serialize 原样输出，天然成立；编辑会话内「解析→编辑→序列化→再解析」矩阵不变。 |

## 现有实现基线（复用点）

- **table 叶子块现状**：`src/render/editor/kernel/types.ts` 的 `LEAF_BLOCK_TYPES` 含 `'table'`（L129），
  `BlockNodeV2.text` 存整表多行原始 markdown。
- **解析**：`markdownToState.ts` L46 `TABLE_SEPARATOR_RE`（支持 `:---:` 对齐分隔行）、L238/L331
  `parseTable`（表头+分隔行固定前 2 行，正文行持续收集至空行/不含 `|`）。`parseTable` 不切分单元格，
  `block.text` = rows.join('\n')。
- **序列化**：`stateToMarkdown.ts` L28 `case 'table'` 原样按行输出 `block.text`。
- **渲染**：`LeafBlock.tsx` L73-82 `case 'table'` 渲染只读 `<pre>`（无 `.block-content` span）。
- **syntaxType**：L24/L67 对 table 直接返回 `{ type: 'table' }`。
- **工具栏**：`toolbarState.ts` L63-66 `syntaxTypeToOption` 对 table 回落 paragraph；
  `types.ts` `canConvertBlock` 仅允许 table→paragraph（`default` 分支），无 paragraph→table 转入。
- **块编辑管线**：`ContentBlock.tsx` `syncDomToModel`（L107-121）「DOM textContent ↔ block.text 单一事实源，
  纯文本输入只同步模型不重渲染」——表格单元格编辑应复用此「只同步不回写重渲染」思想。
- **撤销**：`editorStore.undo/redo` 基于 content 快照栈，块级修改经 `useEditorActions.commitTree`。

## 需求清单

### T1 单元格矩阵编解码（纯函数，kernel 新增）

- **T1.1** `parseTableText(text)` → `{ header: string[]; rows: string[][] }`：
  解析规范 markdown 表格文本。处理 `\|` 转义解义、去首尾 `|`、单元格 trim、对齐分隔行识别
  （决定列数；分隔行内容不进入 header/rows）。空表/畸形表保守返回空结构，不抛错。
- **T1.2** `serializeTable(struct)` → string：矩阵 → 规范 markdown 文本（`| a | b |` 每行、
  表头行 + 统一对齐分隔行 `| --- | --- |`、单元格内 `|` 转义为 `\|`）。与 `parseTableText` 互逆
  （`parse(serialize(s)) === s`，编辑会话内往返不变式）。
- **T1.3** 对齐标记：解析时容忍任意对齐分隔行；序列化时固定输出 `| --- | --- |`（首版不保留原对齐信息）。
- **T1.4** 放置位置：kernel 新增 `tableCodec.ts`（纯函数，无 React/DOM 依赖），导出 `parseTableText`/`serializeTable`。

### T2 单元格编辑（渲染层）

- **T2.1** `LeafBlock.tsx` table 分支替换为可编辑 `<table>` 渲染：`<div data-block-id>` 外壳 +
  `<table>` 网格（thead 表头行 + tbody 数据行），对齐分隔行不渲染。
- **T2.2** 每单元格一个 `<td>` 内 contentEditable（纯文本 `contenteditable="plaintext-only"` 或等价），
  `data-row`/`data-col` 定位；点击单元格聚焦编辑。
- **T2.3** 单元格输入：`onInput` 读 `textContent` → 更新矩阵 → `serializeTable` → 回写 `block.text`
  （经现有块文本更新管线并入撤销栈）；**不触发全表重渲染**（复用 ContentBlock「只同步模型」思想，
  仅当行列结构变化时才重建 DOM）。
- **T2.4** `|` 输入：单元格内键入 `|` 立即转义为 `\|`（或输入时直接转换）；粘贴含 `|` 的文本同理。
- **T2.5** 单元格内 Enter/Tab 跨格导航：Enter=同列下一行（末行末列→新增行聚焦新行首列）；Tab=下一格
  （行尾→下一行首列，末行末列→新增行）；Shift+Tab=上一格。单元格内不产生换行。
- **T2.6** 导航后焦点/光标恢复：跨格后光标落在目标单元格起点（offset 0）。

### T3 增删行列（悬停手柄）

- **T3.1** 悬停交互：鼠标悬停表格时，表头列顶显示「+」（在列右侧加列）；行首显示「+」（在该行下方加行）。
  「−」删除手柄：列顶/行首显示，删除该列/该行（表头+分隔行后的数据行可删；至少保留 1 列；表头行可编辑但不可删行手柄作用于数据行）。
- **T3.2** 增删后：矩阵更新 → `serializeTable` → 回写 `block.text` → 重建 DOM（行列结构变化需重渲染）。
- **T3.3** 边界：行数=0 或列数=1 时对应删除手柄隐藏/禁用；新增单元格内容为空字符串。
- **T3.4** 手柄为纯 CSS overlay（`contentEditable=false` 区域），不入表格文本。

### T4 往返不变式与消费者兼容

- **T4.1** 往返不变式：`serializeTable(parseTableText(md))` 产出的规范文本，经 `markdownToState` 再解析
  仍是等价 table（列数、单元格内容一致；对齐分隔符规范化允许）。`stateToMarkdown` 原样输出不回归。
- **T4.2** 消费者零破坏：table 保持叶子块，`selection.ts`/`selectionExport.ts`/`highlight.ts`/`blockEdit.ts`/
  `outline.ts` 对 table 的既有排除/计行行为不变（table 无 `.block-content` span，AI 改写对其保守禁用——保持现状）。
- **T4.3** 大纲计行：`outline.blockLineCount` 基于 `serializeBlock` 行数，table 多行计行行为不回归。

### T5 编辑器/工具栏集成

- **T5.1** 聚焦/选中：点击表格块聚焦编辑；表格块在文档流中正常换行/前后段落编辑不回归。
- **T5.2** 撤销：单元格编辑/增删行列均入 undo 栈（`editorStore.undo` 可撤销）。
- **T5.3** 工具栏：不新增 paragraph→table 转入（首版不做「转表格」按钮，避免变更清单扩散）；
  table→paragraph 既有转换保持。悬停手柄不占用 FloatingToolbar。
- **T5.4** 只读约束：对齐分隔行、表格外壳不可编辑；表格内不出现源码文本。

### T6 测试

- **T6.1** kernel 单测：`tableCodec.test.ts` 覆盖 parse/serialize 往返（含 `\|` 转义、对齐分隔行、
  畸形输入保守空）、对齐标记容错、与 `markdownToState`/`stateToMarkdown` 端到端往返。
- **T6.2** 组件测试：`LeafBlock`/`TableBlock` 渲染（表头/数据行结构）、单元格输入回写 text、
  增删行列矩阵与 text 变化、Enter/Tab 导航、`|` 转义。
- **T6.3** Playwright E2E：真实 Chromium 编辑单元格→序列化文本正确；增行列/删行列→DOM 与文本更新；
  往返（编辑后导出 text → markdownToState 重解析等价）。

## 验收标准

- 表格块由只读 `<pre>` 升级为可编辑 `<table>`；单元格点击可编辑纯文本。
- 单元格输入/增删行列后 `block.text` 为规范 markdown；「编辑→序列化→再解析」矩阵不变（往返不变式）。
- `\|` 输入自动转义；Enter/Tab/Shift+Tab 跨格导航正确；单元格内无换行。
- 悬停手柄增删行列生效，边界（1 列/删空）正确。
- 内核块结构不变（table 仍叶子块），`markdownToState`/`stateToMarkdown`/selection/rewrite/outline 无回归
  （table 的既有只读/排除行为保持）。
- 撤销可回退单元格编辑与增删行列。
- **门禁**：`tsc 0` + `vitest 全绿` + `lint 0` + `vite build` + `Playwright 全绿`
  （新增：单元格编辑回写、增删行列、往返重解析、`|` 转义）。

## 范围外 / 另开任务

- 单元格内行内格式（加粗/斜体/代码）——首版仅纯文本。
- 单元格合并/跨行、行跨单元格。
- 对齐标记（`:---:`）在 UI 上的编辑与保留（首版序列化固定 `---`）。
- paragraph→table 转换按钮 / 表格样式自定义 / 列宽拖拽。
- 任务外既有阻塞：electron-builder MSI 图标、drag-selection 5 RED（另开任务）。
