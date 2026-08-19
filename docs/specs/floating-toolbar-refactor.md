# 浮动工具栏与跨块选择重构规范（Floating Toolbar & Cross-block Selection）

> 规范编号：SPEC-EDIT-FT | 版本：v1.0（已实施）| 更新：2026-08-08
> 关联需求：REQUIREMENTS.md EDIT-11（结构转换）、EDIT-13（语法渲染对齐）
> 关联模块：[docs/modules/04-编辑主区-Editor.md](../modules/04-编辑主区-Editor.md)
> 关联规范：[SPEC-EDITOR-V2](./editor-v2-architecture.md)、[实施记录](./editor-v2-progress.md)（13.11 浮动工具栏、13.13 跨块拖选）、
> [SPEC-EDIT-EXIT](./markdown-block-exit-rules.md)
> 实施证据：[docs/testing/spec-edit-ft.tdd.md](../testing/spec-edit-ft.tdd.md)

---

## 0. 实施记录（v1.0，2026-08-08）

本规范按 TDD 完成实施（G1/G2/G3①/G3② 验收全部通过；全量回归绿：
Vitest 289 / E2E 28 / tsc / eslint / vite build）。实施中的偏差回到本规范更新如下：

| # | 规范约定（v0.1） | 实际实现 | 说明 |
| - | ---------------- | -------- | ---- |
| 1 | G1 判定在 `computeToolbarState` 内联校验 | 新增导出纯函数 `selectionSyntaxTypesConsistent` + `syntaxTypeToOption`；`computeToolbarState` 增 `tree` 参数 | 便于组件测试直接覆盖（tests/components/FloatingToolbarV2.test.tsx） |
| 2 | G3① 原生 select 或自定义下拉二选一 | **采用自定义下拉**（`.block-type-trigger` / `.block-type-menu` / `[data-value=…]`） | 统一暗色主题与后续图标扩展；e2e 选择器同步更新 |
| 3 | G3③ 转换矩阵 | `types.ts` 新增 `canConvertBlock` 纯矩阵；`EditorV2.onConvertBlock` 重写为 `canConvertBlock + resolveSyntaxType` 前置校验分发 | 放开"仅根级"限制（支持引用/列表内容退位）；升格（→列表/引用/代码块）仍仅根级 paragraph |
| 4 | D3「浏览器 Range 自带方向归一化」 | **方向归一化不成立**：Chromium 中 `setStart(下方块)+setEnd(上方块)` 反向时 range 塌陷到 end 点，须显式检测 `collapsed` 并交换端点 | 关键发现，见 4.4.3 修订 |
| 5 | D1「帧间相同则跳过」 | 按 focus 块去重会丢同块内 offset 精度（拖到块末尾选区不完整）→ 仅保留 rAF 坐标合并，不再按块跳过 | 实测回归修正 |
| 6 | D4「重放前校验跨块即信任」 | 收紧为「跨块**且文本非空**」才信任；纯跨块空文本（Chromium 裁剪产物）仍重放 | 见 4.4.4 修订 |
| 7 | mouseup 仅重放一次 | 末帧坐标可能被 rAF 帧消费且事件坐标在 headless 不可靠 → `lastMovePointRef` 兜底 + **连续 3 帧重放**对抗原生收尾时序 | 新增，见 4.4.6 |

**Chromium 限制（重要）**：Selection 跨多个独立 contentEditable 宿主时，`toString()`
只返回 **anchor 宿主内文本**，但 Range 边界保留跨块。因此反向拖选 anchor 停在块末尾时
`sel.toString()` 为空（选区本身正确）。G2 用例据此改为与正向对称的验证方式：
`startId ≠ endId` + Backspace 块树级删除锚点块内容。

---

## 1. 背景与目标

v2 编辑主区（块树 WYSIWYG）已具备 marktext 风格浮动工具栏与跨块鼠标拖选能力，
但用户实测反馈三组交互缺陷（均为 Normal Mode、非源码状态）：

| 问题域 | 缺陷                                                                                 |
| ------ | ------------------------------------------------------------------------------------ |
| 工具栏显示 | 选中**不同语法类型**的内容（如 h1 + h2、标题 + 正文）也会弹出浮动工具栏             |
| 跨块拖选   | 从上至下跨块拖选可用但不丝滑（易卡顿）；从下至**上**跨块拖选选不中不同语法类型内容 |
| 工具栏块类型 | ① 最左侧块类型下拉框打不开；② 块类型仅对 n 级标题正确，其它内容一律显示"正文"      |

**本次规范只做行为修正，不改变**：块树数据模型、Markdown 双向转换、七类交互控制器、
撤销/重做、自动保存、查找替换、大纲导航等既有能力（回归约束见第 6 节）。

---

## 2. 现状与根因分析

### 2.1 问题 1：跨语法类型选中也弹工具栏

**根因**：`FloatingToolbar.tsx` 的 `computeToolbarState` 只检查"选区非折叠 + anchor/focus
位于编辑器 `span.block-content` 内"（FloatingToolbar.tsx:118-147），**从未校验选区横跨的
块类型是否一致**。因此任何块内/跨块选区都会显示工具栏。

### 2.2 问题 2：跨块拖选卡顿 + 反向选不中

**根因**（`useCrossBlockDragSelection.ts`）：

| # | 缺陷点 | 位置 | 影响 |
| - | ------ | ---- | ---- |
| D1 | `mousemove` 每次事件同步执行 `caretRangeFromPoint → nearestContentSpan → createRange → removeAllRanges/addRange → cloneRange`，无任何节流 | useCrossBlockDragSelection.ts:42-60 | 高频 mousemove 每帧重复 DOM 遍历 + selection 重建，触发大量 `selectionchange`（进而驱动 FloatingToolbar 计算/渲染），是"卡顿"主因 |
| D2 | 跨块方向仅以"锚点 + 当前点"构造 Range（`setStart(anchor)` + `setEnd(current)`），依赖 `caretRangeFromPoint` 命中内容文本节点 | :47-59 | 鼠标从下往上拖时经过的命中点常落在**非内容区**（列表 marker、标题 `#` 提示伪元素、块容器 padding、代码块 header），`nearestContentSpan` 返回 null 即提前 return，`lastDragRange` 不更新，反向拖选失效 |
| D3 | `lastDragRangeRef` 只记录"最后一次跨块成功"的 Range；若中途拖回锚点块（同块由浏览器原生选择），mouseup 重放的可能是过期 Range | :59, :62-76 | 拖选收尾选区错误 |
| D4 | `mouseup` 仅重放 `lastDragRange`，从不校验当前浏览器选区已是跨块选区 | :62-76 | 偶发选中失败/选区被浏览器收尾覆盖 |

### 2.3 问题 3①：块类型下拉打不开

**根因**：块类型下拉是原生 `<select>`，但其 `onMouseDown={(e) => e.preventDefault()}`
（FloatingToolbar.tsx:285）阻止了 mousedown 的默认行为——原生 select 弹出下拉列表
正是 mousedown 的默认行为，故点不开。对比：代码块语言下拉仅 `stopPropagation`
（CodeBlock.tsx:86）不 `preventDefault`，因此正常。

> 注：`onMouseDown={preventDefault}` 的原意是"点击工具栏不改变编辑选区"，但应改由
> `stopPropagation` 实现，而非拦截 select 自身的展开行为。

### 2.4 问题 3②：块类型显示不对应

**根因**：`FloatingToolbar.tsx:215-224` 的 `currentType` 仅对 `block.type === 'heading'`
返回 `h{level}`，其余类型一律返回 `'paragraph'`；且 `BlockTypeOption`（:17）与
`BLOCK_OPTIONS`（:40-48）只定义了 `paragraph | h1~h6`，模型层未提供"块 → 语法类型"的解析。

---

## 3. 目标

| 编号 | 目标                                                       | 验收要点                                             |
| ---- | ---------------------------------------------------------- | ---------------------------------------------------- |
| G1   | 仅当选中内容为**单一语法类型**时显示浮动工具栏             | 选中 h1 + h2 不显示；选中同类型两段（两个段落）显示 |
| G2   | 跨块拖选正反双向丝滑、均可选中不同语法类型内容             | 上下两向均可跨块选中；拖选期间无卡顿                 |
| G3① | 块类型下拉可展开并选择                                     | 点击下拉可打开、选择后触发块转换                     |
| G3② | 块类型下拉与当前块语法类型一一正确对应                     | 正文/标题/代码块/引用/有序/无序/任务列表均显示正确   |

---

## 4. 方案设计

### 4.1 语法类型定义与解析（新增内核纯函数）

新增 `kernel/syntaxType.ts`（纯函数，不依赖 DOM/React，可独立测试）：

```ts
// src/render/editor/kernel/syntaxType.ts
export type SyntaxType =
  | { type: 'paragraph' }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: 'code-block' }
  | { type: 'blockquote' }
  | { type: 'bullet-list' }
  | { type: 'ordered-list' }
  | { type: 'task-list' }
  | { type: 'thematic-break' }
  | { type: 'table' };

/** 由任意块 ID 解析"用户感知语法类型"（沿父链聚合，heading 优先自身） */
export function resolveSyntaxType(tree: BlockTreeV2, blockId: string): SyntaxType;
```

解析规则（自内向外）：

| 块类型                       | 解析结果                                                             |
| ---------------------------- | -------------------------------------------------------------------- |
| `heading`                    | `{ type: 'heading', level }`（优先级最高，无论是否嵌套于引用/列表内） |
| `code-block`                 | `code-block`                                                         |
| `thematic-break` / `table`   | 自身类型                                                             |
| `paragraph`（或其他叶子）    | 父为 `list-item` → 父列表类型（bullet/ordered/task）；父为 `blockquote` → `blockquote`；否则 `paragraph` |
| 容器块本身（list/quote 等）  | 自身类型                                                             |

**设计说明**：`heading` 优先自身语义（与 marktext 一致，引用内的标题下拉仍显示标题级别）；
`paragraph` 需向上聚合成"最近的结构容器"，因为列表/引用的文本事实源在叶子块上。

### 4.2 浮动工具栏显示条件（G1）

`computeToolbarState` 增加"选区语法类型一致性"校验：

1. 由 `nearestContentSpan(sel.anchorNode)` / `(sel.focusNode)` 取起止块 id；
2. 若起止块为同一块（块内选区，现状行为）→ 直接放行（保持现有单块体验）；
3. 若为跨块选区：以文档序枚举 `startBlockId → endBlockId` 区间内**全部叶子块**
   （复用 `getNextLeaf` / `getAllBlocksInOrder`），逐个 `resolveSyntaxType`；
4. 区间内所有叶子块的语法类型**全部相等**才 `show`，否则 `hide`。

示例行为矩阵：

| 选区内容                              | 判定 | 是否显示 |
| ------------------------------------- | ---- | -------- |
| 同一段落内选区                         | 单块 | ✅       |
| 两个连续 `paragraph` 块                | 一致 | ✅       |
| 两个 `h1` 块                           | 一致 | ✅       |
| `h1` + `h2`（不同 level）              | 不一致 | ❌      |
| `heading` + `paragraph`                | 不一致 | ❌      |
| 同一 `blockquote` 内两段               | 均解析为 blockquote | ✅ |
| `blockquote` 内一段 + 列表项一段       | 不一致 | ❌      |
| 同一 `bullet-list` 内两个 list-item    | 均解析为 bullet-list | ✅ |
| `paragraph` + `code-block`             | 不一致 | ❌      |

> 跨块工具栏作用于"锚点块"（现状语义保留）；由于已保证类型一致，锚点块类型即选区类型。

### 4.3 块类型下拉修复（G3① + G3②）

#### 4.3.1 下拉可打开（G3①）

- 移除 `<select>` 上的 `onMouseDown={preventDefault}`，改 `stopPropagation`（保持选区不被
  编辑器 mousedown 逻辑干扰，同时放行 select 默认展开行为）。
- 若采用原生 `<select>`：无需其它改动，现有 `e2e/floating-toolbar.spec.ts` 的
  `locator('select').selectOption(...)` 可继续通过。
- 若采用自定义下拉（`div` + 弹出面板，推荐用于暗色主题样式统一与后续扩展块类型图标）：
  面板以 `position: fixed` 挂载，`onMouseDown={stopPropagation}`，点击项后触发 `onChange`
  等价回调；需同步更新 e2e 选择器（`select` → 自定义面板选择器）。

#### 4.3.2 块类型一一对应（G3②）

- 扩展 `BlockTypeOption` 与 `BLOCK_OPTIONS`：

```ts
export type BlockTypeOption =
  | 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  | 'code-block' | 'blockquote'
  | 'bullet-list' | 'ordered-list' | 'task-list';
```

- `currentType` 由 `resolveSyntaxType(tree, selection.blockId)` 计算并映射为
  `BlockTypeOption`（heading 映射到 `h{level}`，其余按类型映射）。
- `onConvertBlock` 透传目标类型给 `EditorV2`，转换能力按下表启用/禁用。

#### 4.3.3 块转换矩阵（能力边界，避免影响其它功能）

| 当前类型          | 下拉可切换目标                                                               | 说明                                                         |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `paragraph`       | h1-h6 / 三种列表 / blockquote / code-block；`paragraph` 为当前项              | 复用 `convertCtrl.convertParagraphToBlock`（现成能力）        |
| `heading`         | h1-h6 级别互切（`updateMeta`）；`paragraph`（`convertBlockToParagraph`）       | 转列表/引用/代码块暂**禁用**（无现成转换路径，列为后续任务） |
| `blockquote`      | `paragraph`（退出引用）                                                       | 其余目标禁用                                                 |
| 三种列表          | `paragraph`（退出列表，作用于锚点 list-item 内容）                            | 其余目标禁用；列表间互转（如 bullet→task）暂不支持            |
| `code-block`      | 仅显示 `code-block`（下拉只读标识）                                           | 代码块不参与经下拉的块转换（维持既有独立编辑路径语义）       |

> 约束：下拉"显示全部语法类型，但仅对当前块可安全转换的目标可交互（disabled 置灰）"，
> 杜绝为满足 G3② 而临时扩张转换能力、引入未验证的交互回归。

### 4.4 跨块拖选重构（G2）

`useCrossBlockDragSelection` 保持"程序化扩展选区"总体思路，修复 D1~D4：

#### 4.4.1 节流（D1）

- `mousemove` 只记录**最新坐标**到 ref，用 `requestAnimationFrame` 合并：同一帧内
  多次 move 只执行一次定位 + 选区更新。
- 每帧若选区未变化（与上一帧起止文本节点相同）则跳过，避免重复
  `removeAllRanges/addRange`。

#### 4.4.2 非内容区回退定位（D2）

- 当前点 `caretRangeFromPoint` 命中非内容区（`nearestContentSpan` 为 null）时：
  - 若上一帧有有效 focus，**保持选区不变**（不缩小、不提前 return 覆盖已有跨块选区）；
  - 连续命中非内容区 N 帧（如拖出编辑器底部）时停止更新，回到编辑器内自动恢复。
- 备选（更稳）：`caretRangeFromPoint` 未命中时，从命中元素向上取最近的
  `data-block-id` 容器，把 focus 收敛到该块内容 span 的末尾（`selectNodeContents` +
  `collapse(false)`），保证反向拖选经过标题/列表 marker 区域也能持续推进。

#### 4.4.3 方向无关（D2/D3，实施修订）

- Range 一律 `setStart(锚点)` + `setEnd(当前点)`；**修订**：Chromium 中从下往上拖时
  `setEnd` 到 start 之前的块会**塌陷到 end 点**（`collapsed === true`，非自动归一化），
  必须显式交换端点再写入。故每次构造后检查 `next.collapsed`，为真则交换 start/end。
- 每次有效更新都同步 `lastDragRangeRef`（含拖回锚点块时）。

#### 4.4.4 收尾校验（D4，实施修订）

- `mouseup`：先 `cancelAnimationFrame` 清理待处理帧；rAF 重放前校验——
  **修订**：仅当当前 `window.getSelection()` 已是"跨块 **且文本非空**"的完整选区才信任
  （避免重放覆盖浏览器正确结果）；跨块但文本为空（Chromium 裁剪产物，见第 0 节）仍重放
  `lastDragRangeRef` 修正。
- 重放采用**连续 3 帧**（原生拖选在 mouseup 同步收尾且时序不可控，单帧可能被覆盖）。

#### 4.4.5 工具栏与拖选联动

- 拖选期间的 `selectionchange` 仍由 FloatingToolbar 消费；因已加 rAF 节流，事件频率
  被压到每帧一次，配合 G1 类型一致性判定，跨不同类型拖选时工具栏不会弹出，卡顿面收窄。

#### 4.4.6 末帧兜底（实施新增）

- `mousemove` 仅更新 ref，rAF 帧消费后 `pendingPoint` 清空；若 `mouseup` 前最后坐标已被
  消费，且本次确为拖选（新增 `dragMovedRef` 标记，区分"纯点击"与"拖选"），用
  `lastMovePointRef`（最后一次 mousemove 坐标）补一帧——headless 下 mouseup 事件坐标不可靠。

---

## 5. 改动文件清单（预估）

| 文件                                                           | 改动                                                     | 风险 |
| -------------------------------------------------------------- | -------------------------------------------------------- | ---- |
| `src/render/editor/kernel/syntaxType.ts`（新增）               | `SyntaxType` + `resolveSyntaxType` 纯函数                | 低   |
| `src/render/editor/kernel/index.ts`                            | 导出 syntaxType                                          | 低   |
| `src/render/components/Editor/v2/FloatingToolbar.tsx`          | 显示条件（类型一致性）、下拉展开、`currentType` 映射、转换矩阵 | 中   |
| `src/render/components/Editor/v2/types.ts`                     | `BlockTypeOption` 类型扩展                               | 低   |
| `src/render/components/Editor/v2/EditorV2.tsx`                 | `onConvertBlock` 按矩阵分发（含 code-block 只读分支）     | 中   |
| `src/render/hooks/useCrossBlockDragSelection.ts` | rAF 节流 + 非内容区回退 + 方向无关 + 收尾校验            | 中   |
| `tests/editor/kernel/`（新增）                                 | `resolveSyntaxType` 判定矩阵单测                          | —    |
| `tests/components/`（新增）                                    | 工具栏显示条件（单块/多块/混合类型）组件测试             | —    |
| `e2e/floating-toolbar.spec.ts`、`e2e/cross-block-selection.spec.ts` | 新增用例（见 6.2）；若改自定义下拉需同步选择器           | —    |
| `docs/modules/04-编辑主区-Editor.md`、`docs/specs/editor-v2-architecture.md` | 实现记录回写                                             | —    |

---

## 6. 测试策略与回归约束

### 6.1 内核/组件单元测试（Vitest）

1. `resolveSyntaxType`：heading（含引用内/列表内 heading）→ heading+level；paragraph 在
   list-item → 父列表类型；paragraph 在 blockquote → blockquote；根 paragraph →
   paragraph；code-block/thematic-break/table → 自身类型；容器块自身 → 自身类型。
2. 工具栏显示条件（jsdom 模拟选区）：单块选区显示；同类型两段显示；h1+h2 / heading+paragraph
   / paragraph+code-block 不显示；同 blockquote 内两段显示。
3. 转换矩阵：paragraph 可转全部；heading 仅可转 h1-h6/paragraph；quote/list 仅可转
   paragraph；code-block 只读。

### 6.2 Playwright E2E（真实 Chromium）

| 用例 | 覆盖 |
| ---- | ---- |
| 选中 h1 + h2 → 工具栏不出现 | G1 |
| 选中同类型两段（如引用内两段）→ 工具栏出现且类型为 blockquote | G1 + G3② |
| 从下往上跨块拖选 → 选区覆盖两不同块（反向成立） | G2 |
| 从上往下跨块拖选 → 选区覆盖两不同块（正向不回归，兼容现有用例） | G2 |
| 点击块类型下拉 → 面板/原生下拉打开并可选择 | G3① |
| 代码块 / 引用 / 有序 / 无序 / 任务列表选中 → 下拉显示对应类型 | G3② |
| 现有 `e2e/floating-toolbar.spec.ts`（3 例）+ `cross-block-selection.spec.ts`（1 例）不回归 | 回归 |

### 6.3 回归门禁（已通过）

- `vitest run` 全量 **289/289** 通过（含存量往返/退出规则/内核用例 + 新增
  FloatingToolbarV2 22 例、EditorV2Convert 8 例、syntaxType 21 例）；
- `tsc --noEmit`、ESLint（0 error）、`vite build` 通过；
- `npx playwright test` **28/28** 通过（存量 21 例 + 新增 floating-toolbar 2 例、
  cross-block-selection 2 例等）；
- 块树序列化/往返不变量、SPEC-EDIT-EXIT 六条退出规则、SPEC-EDIT-CBTP 行为零变化。

---

## 7. 风险与回退

| 风险                                             | 缓解                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 类型一致性判定误伤合法单选区（如引用内多块）     | 判定规则以 `resolveSyntaxType` 聚合语义为准并配套 E2E；单块选区恒放行                       |
| 自定义下拉改动 DOM 破坏现有 e2e 选择器           | 方案 A 原生 select 可零改动通过；方案 B 需同步更新 `floating-toolbar.spec.ts` 选择器          |
| 拖选重构引入选择回归                             | 方向无关 Range 构造 + 收尾校验；正向拖选由存量 E2E 守护                                   |
| 转换矩阵禁用项超出预期                           | 下拉对不可转目标置灰（disabled），不改变既有 `convertCtrl` 行为；扩张列为后续任务 |
| 回退                                           | 改动集中于 FloatingToolbar / useCrossBlockDragSelection 两组件与新增纯函数，可整体还原      |

---

## 8. 验收标准（已达成）

- G1：选中 h1 + h2 无工具栏；选中同类型跨块选区工具栏正常出现。
- G2：从下往上、从上往下均可跨块选中不同语法类型内容，拖选过程无卡顿（rAF 节流）。
- G3①：点击块类型下拉可展开并选择（自定义下拉面板）。
- G3②：段落/标题（各级）/代码块/引用/有序/无序/任务列表选中后，下拉均显示正确类型；
  标题级别互切、段落↔结构块转换与既有行为一致，禁用项置灰不可点。
- 全量回归门禁（6.3）通过；存量 E2E 与 Vitest 不回归。

---

> 本规范为浮动工具栏与跨块选择的修复基线。评审确认后实施；实施中的偏差回到本规范
> 更新后执行（文档优先，避免编码错误）。实施风险等级：**L3**（编辑器核心交互修改），
> 需人工确认后开工。
