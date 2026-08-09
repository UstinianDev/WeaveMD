# 编辑主区 (Editor) 功能总结

> 模块编号：04 | 优先级：P0 | 版本：v2.3 | 最后更新：2026-08-08
> 设计规范：[specs/editor-v2-architecture.md](../specs/editor-v2-architecture.md)
> 退出规则：[specs/markdown-block-exit-rules.md](../specs/markdown-block-exit-rules.md)
> 浮动工具栏/跨块拖选：[specs/floating-toolbar-refactor.md](../specs/floating-toolbar-refactor.md)
> 拖选闪烁优化：[specs/drag-selection-flicker.md](../specs/drag-selection-flicker.md)
> 参考实现：marktext/muya（架构照搬）

---

## 1. 功能概述

核心编辑区域，**双模式架构**：

- **Normal Mode（v2）**：自研块树内核 → 块内 `contentEditable` WYSIWYG。支持直接编辑、
  Enter 拆块/列表续行、Backspace 六条退出规则、实时富文本渲染（语法标记保留）、
  autoPair、IME 兼容、任务复选框、Tab 缩进/凸出、格式化快捷键。
- **浮动工具栏（marktext 风格，v2，SPEC-EDIT-FT v1.0）**：文本选区非折叠时出现在选区上方；
  **仅单一语法类型选区显示**（跨类型如 h1+h2 隐藏，`selectionSyntaxTypesConsistent` 判定）；
  最左侧为自定义块类型下拉（正文 / H1-H6 / 代码块 / 引用 / 三类列表，`syntaxTypeToOption`
  一一对应，不可转目标置灰），其余为加粗 / 斜体 / 删除线 / 行内代码 / 链接 / 高亮。
  块转换经 `canConvertBlock` 矩阵分发（kernel/syntaxType.ts 提供 `resolveSyntaxType`）。
- **Source Code Mode**：全屏 Monaco 编辑原始 markdown（`Ctrl+\`` 或 View 菜单）。
- **Find & Replace**：Typora 风格 inline bar，双模式可用（v2 Normal 无高亮，见限制）。
- **拖选闪烁优化（SPEC-EDIT-DSF）**：端点级变化检测（`lastAppliedRangeRef`，静止不重建
  selection）+ selectionchange rAF 合并（工具栏渲染 ≤ 每帧一次）+ 一致性判定短路/上限，
  消除反向跨块拖选的光标闪烁与渲染风暴。

## 2. 总体架构

```
┌─────────────────────────────────────────────────────────┐
│ 渲染层（React，纯投影）                                   │
│  EditorV2 → EditorScrollContainer → BlockRenderer       │
│    → 容器块（list/blockquote 递归）/ 叶子块（ContentBlock）│
├─────────────────────────────────────────────────────────┤
│ 控制器层（纯逻辑，可独立测试）                             │
│  inputCtrl · enterCtrl · backspaceCtrl · convertCtrl     │
│  clickCtrl · listCtrl · formatCtrl                       │
├─────────────────────────────────────────────────────────┤
│ 内核层（与 React 解耦）                                   │
│  kernel/blockTree · markdownToState · stateToMarkdown   │
│  kernel/inlineRenderer · outline · selection             │
│  editorInstance（宿主）                                   │
└─────────────────────────────────────────────────────────┘
```

## 3. 核心数据模型：BlockTree v2

```ts
BlockNodeV2 = {
  id, type, parentId, prevId, nextId, childrenIds,
  text: string | null,   // 叶子块唯一文本事实源
  meta?: { headingLevel, fenceLanguage, listMarker, orderedStart,
           orderedDelimiter, taskChecked, loose, setext },
  inlineHtml: string | null  // 行内渲染缓存
}
```

- 容器块：document / blockquote / bullet-list / ordered-list / task-list / list-item。
- 叶子块：paragraph / heading / code-block / thematic-break / table。
- 兄弟关系用 `prevId/nextId` 双向链表，父子用 `childrenIds`，支持列表嵌套、引用嵌套。
- 所有操作不可变（返回新树，结构共享）。

## 4. Markdown 双向转换

- `markdownToState(M)`：块级解析（围栏/表格/ATX/Setext/引用递归/列表嵌套/分割线/段落兜底）。
- `stateToMarkdown(tree)`：逐行序列化（列表标记归一化 `-`、围栏自动加长、Setext 保留）。
- **规范化往返不变量**：`stateToMarkdown(markdownToState(M)) === M`（规范输入）。
- **尾部代码块补偿**（SPEC-EDIT-CBTP）：解析期若整树最后叶子为 code-block，自动在其
  同父容器末尾补空 paragraph（与编辑期 `ensureTrailingParagraph` 镜像），代码块后的
  保护空行在重载/模式切换后不丢失；文本输出不变。
- 行内渲染：`inlineRenderer` 保留语法标记（`<span class="md-syntax">`），DOM
  `textContent` 与源文本一致——编辑/序列化不丢标记。
- 语法类型解析：`kernel/syntaxType.ts` 提供 `resolveSyntaxType(tree, blockId)`（纯函数）——
  沿父链聚合"用户感知语法类型"（heading 优先自身；paragraph 聚合到最近列表/引用容器），
  供工具栏 G1 一致性判定与 G3② 类型映射复用。

## 5. 实时渲染与输入保障（关键机制）

| 机制 | 说明 |
| ---- | ---- |
| 按需重渲染 | 纯文本输入不触发 React 重渲染（DOM 已由浏览器更新）；仅 autoPair 补全或文本含格式语法标记时才重渲染并恢复光标（marktext `checkNeedRender` 思路） |
| IME 守卫 | compositionstart/end 期间跳过 input 事件，结束后统一同步，中文输入不被打断 |
| 语法标记保留 | `**bold**` 渲染为 `<strong><span class="md-syntax">**</span>bold…`，灰显不可选；已渲染格式中继续编辑不丢标记 |
| 前缀即时转换 | `# `/`- `/`1. `/`- [ ] `/`> `/` ``` ` 输入即转块（无 v1 pending 双路径）；删除前缀即时降级 |
| 焦点恢复 | 块转换/重渲染替换 DOM 后，`useLayoutEffect` + 同步 DOM 注册在 paint 前恢复 focus/selection |
| 空文档可编辑 | 文档始终至少一个空段落（marktext scrollPage 语义） |
| 空块占位 | 空内容块 `data-empty="true"` + CSS `::before` 显示占位符；`.block-content` 占满块宽 |
| marktext 语法外观 | 标题光标提示（`#`×n，`:focus-within` 显隐）、无序/有序/任务列表（深灰 marker、圆形任务复选框）、引用（绿色竖线、非斜体）对齐 marktext 默认主题；`.md-syntax` / `.list-marker` / `.task-checkbox` / 标题 `::before` 均不可选中（详见 spec 13.7） |

## 6. 交互控制器

| 控制器 | 职责 |
| ------ | ---- |
| inputCtrl | autoPair（`(` `[` `{` `` ` `` `'` `"`）、文本更新、前缀转换触发 |
| enterCtrl | 代码块换行、列表续行新项、空列表项回车退出、标题右半转段落、引用内拆分 |
| backspaceCtrl | 光标在内容起点即触发：标题转正文、列表项退出、引用降级、空代码块移除、段落合并前块（SPEC-EDIT-EXIT 六条规则） |
| convertCtrl | 升格（paragraph → 六种结构块）/ 降格；浮动工具栏转换经 `canConvertBlock` 矩阵（heading 仅 h1-h6/paragraph 互切，quote/list 仅退位 paragraph，code-block 只读） |
| clickCtrl | 任务复选框切换 |
| listCtrl | Tab 缩进为前项子列表、Shift+Tab 凸出 |
| formatCtrl | 文本层格式化（bold/italic/strike/highlight/code/link/underline/math/image），取代 execCommand；`formatRange` toggle（Step 0 选区归一化 + 双形态，含部分标记覆盖 → 解除、跨多 token 逐 token 拆分、跨风格三连 `***` 叠加，SPEC-EDIT-FT3）、`clearFormat` 橡皮擦清除选区全部行内标记，image/link 插入 `[label](url)` / `![alt](url)`（SPEC-EDIT-FT2） |
| inlineLexer | `kernel/inlineLexer.ts`：行内 token 结构化识别（strong/em/underline/strike/mark/code/link/image/autolink/escape/math），`inlineRenderer` 消费它渲染富文本；`isBoundedWrap` 共享 activeTest 与 toggle-off 边界 |
| katex | `kernel/katex.ts`：`renderMath(expr)` → `.math-inline` + `.katex` HTML，失败回退字面量 |

快捷键：Enter / Backspace / Tab / Shift+Tab / Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z /
Ctrl+B / Ctrl+I / Ctrl+E / Ctrl+Shift+S / Ctrl+Shift+H /
**Ctrl+U（下划线）/ Ctrl+Shift+M（数学公式，SPEC-EDIT-FT2）**。

## 7. 与周边模块集成

| 模块 | 集成方式 |
| ---- | -------- |
| editorStore | 每次编辑经 `stateToMarkdown` 同步 content；撤销/重做走 content 快照栈 |
| uiStore | `isSourceCodeMode` 切换（Normal→Source 先 flush）；查找栏、大纲宽度不变 |
| OutlinePanel | `extractHeadingOutline`（块树 DFS + 序列化行号）→ 导航滚动；滚动高亮（视口顶部 +10px） |
| Find & Replace | 复用 inline bar（content 文本层），替换后重建块树 |
| 代码块 | 语言下拉（别名归一化）+ 复制按钮 |
| 链接 | Ctrl/Cmd+Click → `window.weaveMD.link.openExternal`（IPC 白名单） |

## 8. 已知限制

- v2 Normal 模式暂无查找高亮（替换功能正常；Source 模式由 Monaco 高亮）。
- 撤销/重做后光标回到重建树首块。
- 段落级 MD Source 视图（工具栏入口）未迁移。
- v1 回退路径已退役（v2 唯一路径，见 spec 13.13）。
- 行内标记（SPEC-EDIT-FT2）：`.md-syntax` 默认隐藏、块聚焦灰显；编辑依赖聚焦灰显边界 +
  橡皮擦（⌫）显式清除；选区切开标记时残体保留为字面量；display math 与图片粘贴上传在范围外。
- 格式应用（SPEC-EDIT-FT3）：Step 0 选区归一化杜绝同语法叠加（选中部分标记再点 → 解除，
  跨多个同风格 token 的选区逐 token 拆解除，C10）；跨风格叠加（C12：加粗后再斜体生成三连
  `***`，lexer 解析 em 内嵌 strong，渲染无字面残留，解除逐层剥离）；格式应用后驻留（点击
  工具栏外 / 滚动 / Escape / 键入退出，块转换仍退出）；键盘快捷键仍折叠光标不触发驻留。
- 跨风格叠加（SPEC-EDIT-FT4 / G-①）：选区含**异风格**边界标记（如 `**123**` 选 `3**` 点斜体）
  先折叠到纯内容再叠加（formatCtrl `foldCrossStyleMarkers`，U1 叠加语义）；lexer 支持相邻混合
  强调（`**12*3***` → strong 内嵌 em，close run 拆分）；`**abc**` 选 `ab` 纯内容选区同样归一化
  合并（U6）。e2e FT4-E1/E2 断言无字面 `*` 残体。
- 拖选/选区标记偏移安全（SPEC-EDIT-FT4 / G-②）：`selection.ts` 提供 `snapSelectionToContent` /
  `deleteSelectionContent` / `snapOffsetInText`（依赖 `tokenizeInline`），ContentBlock `handleKeyDown`
  对单块内含标记选区 Backspace/Delete 走程序化删除（选 `粗**` → `**加**`，无未闭合残体）、
  ArrowLeft/Right 光标落入标记内部时吸附到内容边界（键入不分裂标记）。e2e DSG-R1/R2/R3/P 5/5。

## 9. 验证与测试

- Vitest：内核/控制器/组件 **487 例**（含往返属性测试、六条退出规则矩阵、输入链路、
  marktext 语法外观断言、代码块提交/退出、列表与引用退出、尾部代码块补偿 SPEC-EDIT-CBTP、
  `resolveSyntaxType` 判定矩阵 26 例、浮动工具栏 G1/G3 节流与驻留（含 FT2 按钮分组/新功能、
  FT3 sticky/部分标记归一化/跨 token 拆分/三连 `***` 跨风格叠加）、`onConvertBlock` 转换矩阵 8 例、拖选端点变化检测 11 例、
  FT2：inlineLexer / inlineStrip / katex / formatCtrl toggle+clearFormat / roundTrip、
  FT3：Step 0 归一化矩阵（含 C10 跨 token）/ selection 恢复（selection.test + contentBlockRestore）/
  editorV2StickyFormat 集成 / CSS 静态断言（ft2Css 8 例）/ EditorV2 快捷键接线（editorV2Format 5 例）、
  FT4：formatCtrl 跨风格折叠 6 例 + inlineLexer 相邻混合强调 + inlineRenderer 两两组合渲染 +
  selection 标记吸附 11 例 + ContentBlock 删除/方向键吸附 4 例（PLAN-EDIT-FT4））。
- Playwright 真实 Chromium E2E（`e2e/editor.spec.ts` + `e2e/marktext-rendering.spec.ts`
  + `e2e/exit-behavior.spec.ts` + `e2e/floating-toolbar.spec.ts`
   + `e2e/cross-block-selection.spec.ts` + `e2e/drag-selection-markers.spec.ts`）**51 例**：
  空文档输入、`# ` 标题转换、`**` 加粗渲染、标记保留、列表转换、中文输入、marktext 语法符号
  渲染与不可选中（标题 marker 聚焦显隐、任务复选框、引用竖线、列表 marker 计算样式断言）、
  标题 marker 并排、空标题行点击聚焦、列表项 marker 与内容并排且任务项无多余圆点、
  列表末尾空项退格退出、代码块语言提交与空代码块回车退出（保留）/退格一键删除、
  代码块后空行 Backspace 受保护（删除代码块后可删）、引用空行回车退出、列表/标题退格链、
  浮动工具栏（选区加粗、块类型下拉展开/选择、h1+h2 不显示、代码块只读）、
  跨块鼠标拖选正反双向删除、反向跨多类型拖选 + selectionchange 计数收敛（SPEC-EDIT-DSF）、
  代码块尾随保护空行重载后恢复且 Backspace 受保护（SPEC-EDIT-CBTP）、
  FT2：工具栏计算样式（字号/间距/行距/总高）、加粗 toggle 无双层、`.md-syntax` 隐藏/聚焦灰显、
  `==高亮==` 黄色 mark、下划线/图片/数学/橡皮擦全流程（SPEC-EDIT-FT2）、
  FT3：部分标记选区加粗/高亮不叠加（无 `****`/`====`）、跨多 token 选区逐 token 解除、
  加粗后再斜体三连 `***` 渲染 em 内嵌 strong（无字面 `*` 污染）、
  工具栏驻留 + 点击外/Escape 退出（SPEC-EDIT-FT3）、
  FT4：`**123**` 选 `3**` 点斜体 → strong 内嵌 em 无字面 `*` 残体（FT4-E1）、
  `**12*3***` 选 `*3*` 点下划线 → `<u>` 剥离标记后纯内容（FT4-E2）、
  拖选含 close 标记 Backspace/斜体/下划线/光标恢复无残体移位（DSG-R1/R2/R3/P，SPEC-EDIT-FT4）。
- 运行：`npm run test` / `npx playwright test`。

## 10. v1 基线（历史实现，已退役删除）

v1 采用容器级 contentEditable + `renderedHtml` 缓存，存在输入打断、IME 失效、
标记丢失等结构性问题（详见规范文档 13.5 的 R1-R4）。已由 v2 完全替代，
`__EDITOR_V2__` 开关与 v1 组件/服务/测试均已删除（v2 唯一路径，2026-08-06）。
