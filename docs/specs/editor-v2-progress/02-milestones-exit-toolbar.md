# 编辑主区 v2 实施记录 — 分册 2（13.7~13.13：渲染对齐、退出规则、工具栏）

> 拆分自 [editor-v2-progress.md](../editor-v2-progress.md)，原 §13.7~§13.13；2026-09-27 按渐进式披露拆分，正文未改动。
> 返回索引：[editor-v2-progress.md](../editor-v2-progress.md)

---

### 13.7 语法渲染对齐 marktext（2026-08-06）

用户对照 marktext 与 WeaveMD 截图，要求块语法渲染形式对齐 marktext 默认主题，且
渲染后的语法符号不可鼠标选中；代码块格式保持不变。经确认仅做**样式层 + 组件微调**
（不改 v2 块树 / 序列化 / 输入链路）：

| 语法          | 对齐方案                                                                                                   | 实现                                                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| n 级标题提示  | 光标在标题内时左侧显示灰色 `#`×n，失焦塌陷隐藏（对应 muya `MU_GRAY` / `MU_HIDE`）                          | `LeafBlock` 标题加 `data-level`；CSS `h1~h6.heading-block::before` + `:focus-within` 显隐（`font-size:0` 塌陷；伪元素不进入 textContent，不影响序列化/光标偏移，天然不可选中） |
| 无序/有序列表 | marker 深灰色（`--text-sub`，对照截图确认 marktext 为深灰而非浅灰）                                        | `.list-marker { color: var(--text-sub) }`（替代组件内 Tailwind 色值）                                                                                                          |
| 任务复选框    | 18×18 空心圆（深灰 2px 边框），勾选态 accent 背景 + 白色 ✓（对照截图确认 marktext 为圆形）                 | `ListItemBlock` 勾选时加 `task-checkbox--checked` 类；CSS `border-radius: 50%` + `::after` 绘制 ✓；保持 `user-select:none` + `contentEditable={false}`                         |
| 引用          | 3px 绿色竖线（`--quote-bar-color: #42d392`，可按主题覆盖）；文字非斜体（对照截图确认 marktext 引用非斜体） | `BlockquoteBlock` 移除 Tailwind 边框类与 `italic`；CSS `.blockquote-block { border-left: 3px solid var(--quote-bar-color) }`                                                   |
| 代码块        | 格式不变                                                                                                   | `CodeBlock.tsx` 未改动                                                                                                                                                         |

**关键发现/修复**：全局规则 `.editor-content-area [data-block-id] { border: none !important }`
会清除所有块边框（旧 `border-l-4` 引用边框实际从未显示）；改为
`[data-block-id]:not(blockquote)`，仅放行引用竖线，其余块（含代码块）保持原样。

**验证**：新增组件测试 1 例（标题 `data-level` 断言 + `- [x]` 复选框类断言）；
新增 E2E 1 例（标题 marker 聚焦显隐/颜色、复选框尺寸与 accent 背景、引用 3px 绿色竖线、
列表 marker 灰色与 `user-select:none`，真实 Chromium 计算样式断言）。
全量 `vitest run` 305 例通过；`tsc --noEmit` 与 ESLint（0 error，1 个既有 warning）通过；
`vite build` 成功；Playwright Chromium E2E 7/7 通过。

### 13.8 渲染缺陷修复：列表类名冲突 / 标题 marker 换行 / 空标题不可点击（2026-08-06）

用户截图反馈三个问题，逐一定位并修复（均通过真实 Chromium 测量验证）：

| #   | 问题                                                        | 根因                                                                                                                                                                                    | 修复                                                                                                                                                          |
| --- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 有序→任务列表区：语法符号与内容不并排，且符号后出现加粗圆点 | v2 列表项类名 `list-item` 与 Tailwind 工具类 `list-item`（`display: list-item`）冲突，覆盖了 `flex`；`display:list-item` 自带原生 marker 小圆点，子元素（marker span / 内容）被垂直堆叠 | 类名改为 `list-item-block`（globals.css 已有该自定义类）；测试与 E2E 选择器同步更新                                                                           |
| 2   | 删除二级标题全部内容后，点击空行无法选中                    | 标题聚焦后 `#` 提示伪元素占据左侧区域（`pointer-events:none`），点击该区域落到 h2 容器（非 contentEditable）导致失焦                                                                    | `LeafBlock` 标题增加点击处理：点击容器任意处（`e.target === currentTarget`）聚焦内容 span 并放置光标（marker 左侧→开头，其余→末尾），对齐 marktext 整行可编辑 |
| 3   | n 级标题 marker（`#`×n）与内容分两行                        | `.block-content` 为 `display:inline-block; width:100%`，前插行内 `::before` 后总宽超 100%，内容 span 被挤到下一行                                                                       | 标题改为 `display:flex; align-items:baseline`；`.block-content` 在标题内 `flex:1 1 auto; width:auto`，marker 与内容始终同排                                   |

**附带修复**：通用空块占位符规则（`[data-empty='true']::before`）会覆盖标题的 `#` 提示
（更高优先级），改为 `:not(.heading-block)` 排除标题，空标题聚焦时仍显示级别提示。

**验证**：新增 `e2e/marktext-rendering.spec.ts` 3 例（标题 marker 并排 / 空标题点击聚焦 /
列表项 flex 与任务项无多余圆点）。全量 `vitest run` 305 例、`tsc --noEmit`、ESLint
（0 error）、`vite build` 均通过；Playwright Chromium E2E 10/10 通过。

### 13.9 列表退出与代码块退出修复（2026-08-06）

用户反馈两类问题并附截图，经真实 Chromium 复现定位并修复：

| #   | 问题                                                                                                          | 根因                                                                            | 修复                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 有序列表 `1. a` + Enter 生成空 `2.`，退格删除 `2.` 后光标仍停留在列表缩进内；再回车导致 `1.` 被删除而内容保留 | `exitListItem` 对非首空项走"合并到前项"分支，空段落被并入上一项，光标留在列表内 | `exitListItem` 增加"空项"分支：末尾空项 → 删除该项并在列表后补空段落，光标移到列表外左边缘（列表保留）；中间空项 → 仅移除该项，光标移到下一项开头。同时修复唯一空项分支的 stale 引用判断（`childrenIds.length === 1`） |
| 2a  | 逐字符输入 ` ```java ` 时第 3 个反引号即触发转换，语言为空、内容变成 `` `java ``，源码模式显示异常            | `FENCE_CONV_RE` 不要求尾随空格，围栏被提前消费；反引号 autoPair 干扰围栏输入    | 围栏即时转换要求尾随空格（与其他前缀一致）；新增 `detectFenceLine` 供 ` ```lang ` + Enter 提交；输入反引号围栏时跳过 autoPair                                                                                          |
| 2b  | 代码块内回车只能增加代码块内空行，无法退出继续输入其他内容；代码块下方无空行                                  | 转换仅替换段落，无尾随空段落；Enter 在 code-block 内恒插入换行                  | 代码块转换后若无后续块，自动在其后插入空段落；代码块内容为空时 Enter 撤销代码块并把光标移到下一内容块                                                                                                                  |

**验证**：新增控制器测试 4 例（围栏尾随空格转换 + 自动补空段落、` ```lang ` 回车提交、
空代码块回车退出、末尾空列表项退出列表），`vitest run` 309 例通过；新增
`e2e/exit-behavior.spec.ts` 4 例（列表退出 / `java 空格提交 / 空代码块回车退出 / `java 回车提交），
Playwright Chromium E2E 14/14 通过；`tsc --noEmit`、ESLint（0 error）、`vite build` 均通过。

### 13.10 引用退出补齐与代码块退格语义修订（2026-08-06）

用户反馈：引用存在与列表相同的问题（无法从空行退出）；代码块后的空行 Backspace 删不掉，
且空代码块 Backspace 会误删整个代码块。真实 Chromium 复现定位并修复：

| #   | 问题                                                | 根因                                                                                          | 修复                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 引用空行无法退出（与列表同源）                      | `enterCtrl` 缺少 blockquote 分支，空引用行回车走通用拆分，新空行仍在引用内                    | `enterCtrl` 新增引用分支：空行回车 → 退出引用（`convertBlockToParagraph`）；非空回车保持引用内拆分。`exitBlockquote` 对末尾空行改为把空段落移到**引用之后**（对齐列表末尾空项行为）                                                                  |
| 2a  | 空代码块 Backspace 一键删除（用户澄清需求）         | 上一版误改为"保留代码块"                                                                      | 恢复 `removeCodeBlock`：空代码块 Backspace 一键删除（光标前块末尾 → 无前块则下一块开头 → 唯一块转空段落）；**Enter 仍为退出**（保留代码块，光标移到下一块）；`mergeParagraph` 增加保护：前块为代码块时禁止文本合并（空段落直接移除，非空段落不处理） |
| 2b  | 代码块后空段落 Backspace 行为（用户澄清：需受保护） | 误实现为"可删除/并入代码块"                                                                   | `mergeParagraph` 对前块为代码块的段落**整体保护**：Backspace 不删除、不并入（对齐 v1 `protectedAfterCodeFence` 语义）；删除代码块本身后，该空行恢复为普通段落可正常合并                                                                              |
| 2c  | 树未变化时焦点恢复失效                              | `applyAction` 中 `setTree` 传入同一引用 → React 跳过重渲染 → `useLayoutEffect` 焦点恢复不执行 | `applyAction` 检测 `instance.tree === prevTree` 时立即恢复焦点（`setCursorAtOffset`）                                                                                                                                                                |

**验证**：控制器测试覆盖空代码块退格删除、代码块后空段落受保护、删除代码块后空段落恢复
可删、引用空行回车退出、引用末尾空行退格移到引用后，`vitest run` 314 例通过；
`e2e/exit-behavior.spec.ts` 7 例（空代码块退格一键删除、代码块后空行 Backspace 受保护
且删除代码块后可删、引用空行回车退出），
Playwright Chromium E2E 17/17 通过；`tsc --noEmit`、
ESLint（0 error）、`vite build` 均通过。

### 13.11 退格链修复与 v2 浮动工具栏（2026-08-06）

**退格链修复**（真实 Chromium 复现定位）：

| 问题                                           | 根因                                                                                                                    | 修复                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 空标题降级为段落后焦点丢失，后续退格无效       | `convertBlockToParagraph` 的 heading/quote 分支用旧块 id 作为焦点目标，而 `replaceBlock` 已把旧 id 移除（注册表查不到） | 焦点改用 `paragraph.id`（新块 id）                                     |
| 列表项降级后光标落在内容末尾而非开头           | `exitListItem` 统一按 `text.length` 计算焦点偏移                                                                        | 提升类分支（唯一项/首项）焦点偏移为 0，对齐 SPEC"光标保持在开头"       |
| 段落前是列表项时退格无反应（无法跳回上一行）   | `mergeParagraph` 要求同父才合并，跨列表边界被跳过                                                                       | 允许跨容器合并到前一个内容块（列表项/引用内容），实现"退格跳回上一行"  |
| `setCursorAtOffset(span, 0)` 光标落在 offset 1 | 循环条件 `charCount >= 0` 在第一个字符后即触发                                                                          | `remaining > 0 && charCount >= remaining`，offset 0 时光标位于文本起点 |

**v2 浮动工具栏**（marktext 风格，新增 `src/render/components/Editor/v2/toolbar/FloatingToolbar.tsx`）：

- 触发规则与 marktext 一致：文本选区非折叠且位于编辑器内容块内时，出现在选区上方居中；
  收起/滚动/移出编辑器即隐藏（带延迟，允许点击工具栏）。
- 最左侧为**块类型下拉**：正文 / H1-H6（显示当前块类型；转换仅作用于根级 paragraph/heading，
  经 `convertParagraphToBlock` / `convertBlockToParagraph` / `updateMeta` 实现）。
- 其余为行内格式按钮：加粗 / 斜体 / 删除线 / 行内代码 / 链接（prompt URL）/ 高亮，
  复用 `formatCtrl.formatRange`，`onFormat` 增加可选 `url` 参数。
- 选区偏移用 `getCursorOffsets` 取自锚点内容 span；按钮 `onMouseDown` preventDefault 保持选区。

**验证**：`vitest run` 315 例通过（新增列表跨边界合并等）；`e2e/floating-toolbar.spec.ts` 3 例
（选区触发加粗 / 正文→H2 / 级别切换与转回正文）、`e2e/exit-behavior.spec.ts` 扩充至 9 例
（新增列表退格链、标题删除链），Playwright Chromium E2E 22/22 通过；`tsc --noEmit`、
ESLint（0 error，1 个既有 warning）、`vite build` 均通过。

### 13.12 编辑主区技术债清理（2026-08-06）

按代码审查清单（重复/长函数/命名/嵌套/公共逻辑）实施，行为不变（全量门禁通过）：

- **正则单一来源**：六种块前缀正则收进 `kernel/markdownSyntax.ts`（task/ul/ol/bq/fence），
  `blockTree.detectBlockConversion` 直接复用（捕获组统一为富结构），
  `markdownToState` 经 `indented()` 派生解析变体；消除三处漂移。
- **渲染助手**：内核新增 `renderBlock(tree, id, text?)`，统一 11 处
  `setInlineHtml + renderBlockHtml/renderInline` 模式。
- **焦点助手**：内核新增 `adjacentLeafFocus(tree, id, prefer)`，供
  `enterCtrl.moveCaretOutOfEmptyCodeBlock` 与 `backspaceCtrl.removeCodeBlock` 共用。
- **长函数拆分**：`convertParagraphToBlock` 93→64 行（抽出 `buildList`/`buildBlockquote`/
  `ensureTrailingParagraph`）；`exitListItem` 90→~70 行（抽出 `liftChildrenBefore`/
  `createEmptyParagraphAfter`/`exitEmptyListItem`）。
- **命名**：`exitListItem`/`exitBlockquote` 参数 `content` → `leaf`；
  `exitEmptyCodeBlock` → `moveCaretOutOfEmptyCodeBlock`。
- **EditorV2**：抽取 `applyMetaUpdate`（消除 `updateMeta + setTree + syncContent` 重复）。

**验证**：`vitest run` 315 例、Playwright E2E 22/22、`tsc --noEmit`、ESLint（0 error）、
`vite build` 全部通过。

### 13.13 v1 回退退役与跨块鼠标拖选（2026-08-06）

**v1 回退退役**：v2 成为唯一路径，删除 `__EDITOR_V2__` 开关及相关代码：

- 删除 v1 渲染组件（EditorScrollContainer 558 行、FloatingToolbarWYSIWYG 578 行、
  FloatingToolbar 426 行、blocks/、BlockRenderer、Minimap 死代码）与 v1 服务
  （blockTree/blockTreeBuilder/blockTreeSerializer/lineMarkdown/markdownBlockDetector）
  及对应测试；uiStore 移除 v1 块状态机。
- EditorView 由 1920 行重写为薄编排器（约 250 行）：保留 Monaco 主题、Source 模式、
  快捷键、查找替换、大纲导航；Normal 模式导航由 EditorV2 自行注册。

**跨块鼠标拖选**：

- 拖选：mousedown 记录锚点（caretRangeFromPoint），跨入不同 `.block-content` span 时用
  Range API 扩展选区，mouseup 延迟重放（浏览器原生拖选被编辑宿主边界截断并覆盖）。
- 删除：Backspace/Delete 检测跨块选区（`getCrossBlockSelection`）→ 内核
  `deleteLeafRange`（保留前后块区间文本、整块删除中间叶子、清理空容器）。
- 修复按需渲染下的 DOM 陈旧问题：React 状态可能陈旧 + memo 跳过重渲染时，
  `dangerouslySetInnerHTML` 虚拟去重会漏更新，删除后按模型强制同步受影响块 DOM。

**验证**：`vitest run` 226 例（新增 deleteLeafRange 4 例）、新增
`e2e/cross-block-selection.spec.ts`（拖选跨块 + Backspace 删除）、
Playwright Chromium E2E 23/23；`tsc --noEmit`、ESLint（0 error，0 warning）、
`vite build` 全部通过。
