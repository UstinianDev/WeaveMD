# 编辑主区 (Editor) 功能总结

> 模块编号：04 | 优先级：P0 | 版本：v2.8 | 最后更新：2026-08-13
> 设计规范：[specs/editor-v2-architecture.md](../specs/editor-v2-architecture.md)
> 退出规则：[specs/markdown-block-exit-rules.md](../specs/markdown-block-exit-rules.md)
> 浮动工具栏/跨块拖选：[specs/floating-toolbar-refactor.md](../specs/floating-toolbar-refactor.md)
> 拖选闪烁优化：[specs/drag-selection-flicker.md](../specs/drag-selection-flicker.md)
> 代码块/图片块尾随空行：[specs/code-block-trailing-paragraph.md](../specs/code-block-trailing-paragraph.md)
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
- 叶子块：paragraph / heading / code-block / thematic-break / table / image-block。
- 兄弟关系用 `prevId/nextId` 双向链表，父子用 `childrenIds`，支持列表嵌套、引用嵌套。
- 所有操作不可变（返回新树，结构共享）。

## 4. Markdown 双向转换

- `markdownToState(M)`：块级解析（围栏/表格/ATX/Setext/引用递归/列表嵌套/分割线/段落兜底）。
- `stateToMarkdown(tree)`：逐行序列化（列表标记归一化 `-`、围栏自动加长、Setext 保留）。
- **规范化往返不变量**：`stateToMarkdown(markdownToState(M)) === M`（规范输入）。
- **尾部代码块/图片块补偿**（SPEC-EDIT-CBTP，R2 扩展到 image-block）：解析期若整树最后
  叶子为 code-block **或 image-block**，自动在其同父容器末尾补空 paragraph（与编辑期
  `ensureTrailingParagraph` 镜像），代码块/图片块后的保护空行在重载/模式切换后不丢失；
  文本输出不变（`markdownToState.appendTrailingParagraphIfLast`）。
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
| formatCtrl | 文本层格式化（bold/italic/strike/highlight/code/link/underline/math/image），取代 execCommand；`formatRange` toggle（Step 0 选区归一化 + 双形态，含部分标记覆盖 → 解除、跨多 token 逐 token 拆分、跨风格三连 `***` 叠加，SPEC-EDIT-FT3）、`clearFormat` 橡皮擦清除选区全部行内标记，image/link 插入 `[label](url)` / `![alt](url)`（SPEC-EDIT-FT2）；**图片操作（K3~K7）**：`insertImageFromSelection` 直选插入（独立成块转 image-block、行内插入）、`alignImage`/`makeImageInline` 对齐包裹/解除（`<div align>`）、`removeImage`（image-block 整块删 / 行内图删区间）、`replaceImage`（修改图片按 token 区间替换，保留包裹） |
| imageBlock | `kernel/imageBlock.ts`：image-block 独立图文本解析（align/width）+ 对齐包裹/宽度包裹（`parseImageBlockText` / `wrapImageAlign` / `wrapImageWidth`）/内联判定 |
| imageWidthCtrl | `controllers/imageWidthCtrl.ts`：`setImageWidth` 独立图宽度写入（`wrapImageWidth` 重写 `block.text`，段落独立图转 image-block，round-trip 逐字保留） |
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

### 7.1 链接与图片渲染修复（2026-08-11，REQ-EDIT-LINK-IMAGE）

- **链接**：`safeUrl` 放行裸域名（无协议如 `www.baidu.com`）；`normalizeHref` 渲染时自动补
  `https://`（`href`/`data-href` 补全、`.md-syntax` 保留原始 → `textContent` 与源一致，往返
  不变量不破）；hover tooltip 改 `attr(data-href)`（原 `--link-tip` 未定义失效）；Ctrl+Click
  打开不变（走 IPC 白名单）。
- **图片**：本地绝对路径走自定义 `media://` 协议（主进程 `media-protocol.ts` 映射本地文件，
  dev/prod 一致显示），替代被 Chromium `webSecurity`/CSP 阻止的 `file://`；CSP `img-src`
  放行 `https: http: media:`；加载失败经 EditorV2 `onErrorCapture` 事件委托回退
  `.inline-image-fallback` 占位（无 broken 图标）。**2026-08-12 修复**：协议以**非 standard**
  scheme 注册（`MEDIA_SCHEME_PRIVILEGES` 不含 `standard`，回归单测锁定）——盘符编码进 host
  （`media://C%3A/Users/...`）不再被 Chromium 标准 scheme host 规范化拒绝，完整 app 本地图
  加载成功；`toImgSrc` 单层转义对称（K1 修复 `%20` 双重编码）。

### 7.2 图片插入直选与图片工具栏（K3~K7，2026-08-11）

- **直选插入**：浮动工具栏「图片」→ `window.weaveMD.dialog.pickImage` 系统文件框直选 →
  选中文本替换为 `![alt](src)`（alt=选中文本，空格→`%20`）；取消/失败纯 no-op；空选区 → `![](src)`。
- **image-block 原子块**（`kernel/imageBlock.ts`）：text 保存原始 markdown；独立成块（选区=整段/空段）
  插入经 `changeBlockType` 转 image-block，其后确保存在可编辑段落；对齐包裹严格单行
  `<div align="left|center|right">![alt](src)</div>`。
- **点击选中**：`handleContainerClick` 读渲染期 `img[data-start/data-end]`（绝对偏移）+ `getBoundingClientRect()`
  锚点 → `imageSelection`（align/standalone 由 `parseImageBlockText` 计算），点击非 img 清空。
- **图片工具栏**：`imageSelection` 非空时替换文本浮动工具栏，6 按钮：修改图片 / 内联图片 / 居左 /
  居中 / 居右 / 移除图片；**行内图**（非独立成块）对齐与内联按钮置灰、对齐按钮 active 态；外点/Escape 关闭；
  **滚动重锚定**（Bug B，2026-08-12）：工具栏/弹窗位置改用本地 `anchorRect`（scroll 时重查
  `img.getBoundingClientRect()` 更新），跟随图片而非停留点击时陈旧坐标。
- **修改图片**：ImageEditTool 弹层（双 Tab：本地选择/URL），预填 src/alt（`tokenizeInline` 按绝对偏移命中），
  确认经 `replaceImage` 替换并保留对齐包裹；弹窗同样随 `anchorRect` 滚动重锚定。
- **移除图片**：image-block 整块删除（`adjacentLeafFocus` next 优先，无 next 补空段落）；行内图删 token 区间；
  **CBTP 补偿**（Bug C，2026-08-12）：删除后整树最后叶子变为 code-block 时，按 SPEC-EDIT-CBTP 补回受保护
  空段（镜像 `appendTrailingParagraphIfCodeLast`）——修复"代码块后直接 image-block（解析产物/空段被图替换）
  移除图片后保护空行丢失"。

### 7.3 图片缩放 / 图片后空行保护 / 链接提示与工具栏定位（2026-08-12，R1~R5）

| # | 特性 | 实现要点 |
| - | ---- | -------- |
| R1 | 图片选中框 + 四角缩放 | 点击独立图或行内图显示 `.image-resize-box`（fixed 覆盖层 z-90 + 4 角 `.image-resize-handle`）；拖拽实时改 `<img style.width>`（DOM-only，height auto），钳制 `[32px, 容器宽]`；mouseup 提交——独立图经 `setImageWidth` 重写 `block.text` 为 `<div align="X" style="width:Npx">`（`parseImageBlockText` 解析 width 字段、`wrapImageWidth/wrapImageAlign` 保留 align），行内图写会话 `BlockWidthMap`（`inlineRenderer.applyRuntimeWidths` 注入）。新文件：`kernel/imageBlock.ts`（width 解析）、`controllers/imageWidthCtrl.ts`、`components/Editor/v2/ImageResizeBox.tsx` + `resizeMath.ts`；`FloatingToolbar` capture mousedown 放行 `.image-resize-box` |
| R2 | 图片后空行受保护 | 泛化 SPEC-EDIT-CBTP 到 image-block：`backspaceCtrl.mergeParagraph` 前块为 image-block 同样保护；`markdownToState.appendTrailingParagraphIfCodeLast` → `appendTrailingParagraphIfLast`（最后叶子 code-block 或 image-block 补空段）；`formatCtrl.removeImage` 删除后同补。代码块行为不变 |
| R3 | 链接 hover 提示 | `a.inline-link:hover::after` 内容改为 `'ctrl + 左键  打开网页'`（深蓝 `#1d4ed8`、加粗斜体、12px、letter-spacing 0.5px）；`data-href` 仍渲染 |
| R4 | 链接场景工具栏左置 | `toolbarState.computeToolbarState` 新增可选 `linkRect` 6 参：`selection.inLink` 且提供 linkRect 时工具栏定位到链接正左方（`left = clamp(linkRect.left - w - 8)`、垂直居中），非链接沿用上方居中；滚动时链接命中重锚定（非链接仍滚动隐藏） |
| R5 | 插入链接回车修复 | `InsertUrlModal` 输入 Enter → `preventDefault + stopPropagation + handleConfirm`，修复 selectionchange 竞态丢失选中内容；空 URL 分支不变 |

### 7.4 图片缩放落点修复与跨块替换输入（2026-08-13）

- **R3 宽度落点修复**（REQ-EDIT-IMAGE-RESIZE-FIX）：缩放宽度从外层对齐 wrapper 移到
  `<img>` 自身（`renderImageBlock` 经 `applyImgWidth` 注入 `style.width`），小图可放大、
  无 wrapper 溢出、居中/居右（含带宽度图）正确；等比例拖拽 = 主轴向符号 × `√(dx²+dy²)`
  （`resizeMath.computeResizeWidth`），斜向对角顺滑增长；松手提交后选中框重锚定
  （`useLayoutEffect` 每次渲染后重查 img rect）。详情：`docs/specs/editor-v2-architecture.md` 13.15。
- **跨块选区替换输入**（2026-08-13）：字符输入/IME 组合/粘贴跨块选区时，浏览器原生删除只改
  DOM、`onInput` 仅同步焦点块模型 → 其余块重渲染"复活"。ContentBlock 监听**原生 beforeinput**
  （React 合成 onBeforeInput 在 Chromium 不触发）+ `onPaste`，经 `replaceLeafRange`
  （blockTree.ts：`deleteLeafRange` 删除选区 → 后块剩余文本并入前块 → 焦点偏移插入 insertText）
  块树级收敛单块。e2e：`cross-block-replace-input.spec.ts` R1/R2。
- **编辑主区纯重构**（REQ-EDITOR-TOOLBAR-IMAGE-LINK）：`ImageToolbar.scheduleHide` 死代码删除
  （no-op timer）；`imageAnchor.ts`（`findImageEl`/`readImageRect` 纯函数）收敛 ImageToolbar 与
  ImageResizeBox 的滚动重锚定重复查询；`modalConstants.ts` 收敛双份 `EMPTY_URL_MESSAGE`。
  断言零修改、845 全绿。详情：`docs/refactor/editor-toolbar-image-link.refactor.md`。

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
  合并（U6）；lexer 另支持 **open 三连拆分**（`***12*3**` = strong 内嵌 em，渲染无字面残体）。
  e2e FT4-E1/E2 断言无字面 `*` 残体。
- 原生拖拽移动选区禁用（2026-08-09）：EditorV2 根容器 `onDragStart` preventDefault，阻止
  contentEditable 默认"选中含 `.md-syntax` 标记的选区被拖走/跨行移动"；跨块拖选走
  `useCrossBlockDragSelection`（mousedown/mousemove）不受影响。e2e `drag-selection-move.spec.ts`。
- 拖选/选区标记偏移安全（SPEC-EDIT-FT4 / G-②）：`selection.ts` 提供 `snapSelectionToContent` /
  `deleteSelectionContent` / `snapOffsetInText`（依赖 `tokenizeInline`），ContentBlock `handleKeyDown`
  对单块内含标记选区 Backspace/Delete 走程序化删除（选 `粗**` → `**加**`，无未闭合残体）、
  ArrowLeft/Right 光标落入标记内部时吸附到内容边界（键入不分裂标记）。e2e DSG-R1/R2/R3/P 5/5。

## 9. 验证与测试

- Vitest：内核/控制器/组件 **845 例**（含往返属性测试、六条退出规则矩阵、输入链路、
  marktext 语法外观断言、代码块提交/退出、列表与引用退出、尾部代码块补偿 SPEC-EDIT-CBTP、
  `resolveSyntaxType` 判定矩阵 26 例、浮动工具栏 G1/G3 节流与驻留（含 FT2 按钮分组/新功能、
  FT3 sticky/部分标记归一化/跨 token 拆分/三连 `***` 跨风格叠加）、`onConvertBlock` 转换矩阵 8 例、拖选端点变化检测 11 例、
  FT2：inlineLexer / inlineStrip / katex / formatCtrl toggle+clearFormat / roundTrip、
  FT3：Step 0 归一化矩阵（含 C10 跨 token）/ selection 恢复（selection.test + ContentBlockRestore）/
  EditorV2StickyFormat 集成 / CSS 静态断言（ft2Css 8 例）/ EditorV2 快捷键接线（EditorV2Format 6 例，含拖拽禁用事件断言）、
  FT4：formatCtrl 跨风格折叠 6 例 + inlineLexer 相邻混合强调 + inlineRenderer 两两组合渲染 +
  selection 标记吸附 11 例 + ContentBlock 删除/方向键吸附 4 例（PLAN-EDIT-FT4）+ open 三连拆分 3 例、
  图片：imageBlock 解析/对齐包裹/内联/独立判定 + formatCtrl 直选插入/对齐/内联/移除/replace +
  替换图像绝对偏移（imageBlock.test / imageReplace.test / formatCtrl.test）+
  mediaProtocol decode 与特权集不含 standard 断言（mediaProtocol.test）+ img fallback 组件 3 例 +
  图片工具栏滚动重锚定 2 例（Bug B，ImageToolbarV2.test）+ removeImage 代码块尾随空段补偿 3 布局
  + 往返 1 例（Bug C，formatCtrl.test / markdownRoundTrip.test）。
- Playwright 真实 Chromium E2E（`e2e/editor.spec.ts` + `e2e/marktext-rendering.spec.ts`
  + `e2e/exit-behavior.spec.ts` + `e2e/floating-toolbar.spec.ts`
   + `e2e/cross-block-selection.spec.ts` + `e2e/cross-block-replace-input.spec.ts`
   + `e2e/drag-selection-markers.spec.ts` + `e2e/drag-selection-move.spec.ts`）**76 例（71 通过 + 5 既有红）**：
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
  拖选含 close 标记 Backspace/斜体/下划线/光标恢复无残体移位（DSG-R1/R2/R3/P，SPEC-EDIT-FT4）、
  含标记选区拖拽移动被阻止（drag-selection-move，DSM-R1）、
  图片直选插入替换选区/取消 no-op、图片工具栏全链路（修改/对齐/内联/移除）、行内图对齐置灰
  （LINK-IMAGE-E3/E4/E5/E6、FT2-E6/E9）、图片工具栏滚动跟随（LINK-IMAGE-E7，Bug B 重锚定）、
  代码块+图片打开→移除→保护空行恢复（Bug C，exit-behavior.spec.ts）、
  跨块选区输入替换收敛单块（R1/R2，cross-block-replace-input.spec.ts）；
  **5 个既有红**为 drag-selection-markers.spec.ts 跨任务缺陷（勿动）。
- 运行：`npm run test` / `npx playwright test`。

## 10. v1 基线（历史实现，已退役删除）

v1 采用容器级 contentEditable + `renderedHtml` 缓存，存在输入打断、IME 失效、
标记丢失等结构性问题（详见规范文档 13.5 的 R1-R4）。已由 v2 完全替代，
`__EDITOR_V2__` 开关与 v1 组件/服务/测试均已删除（v2 唯一路径，2026-08-06）。
