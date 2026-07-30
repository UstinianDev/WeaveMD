# 浮动工具栏实时渲染 + 格式化叠加 - Product Requirement Document

## Overview

- **Summary**: 修复 Normal Mode 浮动工具栏的两处问题：1) 块转换下拉菜单（正文→标题→列表→引用→代码块等）实时渲染；2) 内联格式化按钮（加粗、斜体、下划线、高亮、行内代码、链接、Comment）支持实时 HTML 渲染和多属性叠加。
- **Purpose**: 当前工具栏仅修改 Markdown 源文本，块组件仍以纯文本显示（无类型转换效果），内联格式仅插入 `**text**` 字面量而不转为 `<strong>`；加粗后再加下划线会互相覆盖，因为操作的是源字符串而非 DOM 范围。
- **Target Users**: Normal Mode 用户，依赖浮动工具栏快速排版。

## Goals

- G1: 块结构下拉（12 种类型）选中段落实时转换对应块类型并重新渲染
- G2: Bold/Italic/Underline/Highlight/InlineCode 5 个按钮使用 DOM `execCommand` 或 Range 包装实现即时视觉效果，支持多属性叠加
- G3: Link/Comment 同样实时渲染可见效果（链接样式 + hover，Comment 注释标记）
- G4: 视觉效果变更后通过 onInput 写回 BlockTree.sourceLines + 持久化 store
- G5: Ctrl+Z/Y 对工具栏操作可撤销重做

## Non-Goals (Out of Scope)

- Source Code Mode 的工具栏（无，Source Code Mode 隐藏工具栏）
- 跨块选择（工具栏只在单块选中时显示，已由 isSelectionWithinSingleBlock 守卫）
- 表格/代码块内部的局部格式化
- 评论内容编辑对话框（Comment 按钮仅插入占位标记）

## Background & Context

当前实现：

- **块转换**：`handleStructureChange` 调用 `onBlockTypeChange` → `EditorView.handleBlockTypeChange`，后者错误地调用 `updateBlockSource(tree, id, [])` 清空 sourceLines 而非转换类型；对 heading 类型通过字符串替换写 content 但其他 8 种类型（list/blockquote/code-fence/task）未处理。
- **内联格式化**：`handleFormat(wrapper)` 仅操作第一行 sourceLines，用 `**text**`/`*text*` 字符串替换，不重建 BlockTree.renderedHtml，HeadingBlock/ParagraphBlock 仍输出纯文本（它们读取 `sourceLines.join(' ')` 直接写入 `<h1>/<p>` textContent）。
- **叠加问题**：每次操作都对 `selectedText` 做一次替换，如已加粗文本 `**abc**` 再加下划线会用 `<u>abc</u>` 替换 `abc` 把 `****` 去掉，导致属性丢失。正确做法：用 Range.surroundContents 或 document.execCommand('bold') 直接操作 DOM，然后通过 onInput 用 `getBlockTextContent` 读回 HTML → Markdown 转换。
- `renderMarkdownToHtml` + `setBlockRenderedHtml` 管线已存在，可直接复用。
- `updateBlockSource` 已实现：根据 sourceLines 自动推断 type/headingLevel。

## Functional Requirements

- **FR-1**: STRUCTURE 下拉菜单的 12 个选项全部生效：
  - paragraph → 清除标题 # 前缀、列表 `- `/`1. `、`> `、`[] `、` ``` ` 前缀
  - heading-1..6 → 行首加 `# ` ~ `###### `
  - unordered-list-item → 行首 `- `
  - ordered-list-item → 行首 `1. `
  - task-list-item → 行首 `- [ ] `
  - code-fence → 外包 `\n...\n`
  - blockquote → 每行 `> ` 前缀
- **FR-2**: DOM 即时视觉刷新：结构变更后 Block 组件立即以新类型渲染（heading 字号变化、blockquote 左侧紫色竖条、列表 bullet/编号、代码块灰色背景）
- **FR-3**: Bold/Italic/Underline/Highlight/Code 按钮用 Range API 直接作用选中 DOM，支持叠加（如粗斜 + 下划线 + 高亮同时存在）
- **FR-4**: Link 包裹选中文本为 `<a href="url">text</a>`，显示下划线 + accent 色
- **FR-5**: Comment 在选中文本后追加 `[comment]` 标记，用 `<span class="comment-marker">` 渲染可见角标
- **FR-6**: DOM 变更后 30ms debounce 走现有 onInput 路径，写回 BlockTree.sourceLines + 同步 store
- **FR-7**: 每次工具栏操作前 pushUndo(serializeBlockTree(prev))，Ctrl+Z 可回退

## Non-Functional Requirements

- **NFR-1**: 操作后 1 帧（≤16ms）内 DOM 显示新样式，持久化写回在 1200ms 内完成
- **NFR-2**: 在 H1-H6、Paragraph、ListItem、Blockquote 内部格式化均正确叠加
- **NFR-3**: 零宽空格 `\u200B` 被正确排除在格式化范围之外
- **NFR-4**: 不引入新依赖；用浏览器原生 `document.execCommand` / `Range.surroundContents`

## Constraints

- **Technical**: React 18 + TypeScript strict；Tailwind 样式优先；仅允许用 DOM API（contentEditable 容器已支持）
- **Business**: Heading 字号规格不得改动（H1 26/700 等 Doubao-aligned 规范）
- **Dependencies**: 复用 `src/render/services/blockTree.ts` 的 `updateBlockSource`，不得引入新格式化库

## Assumptions

- [A1] `window.getSelection()` + `Range.surroundContents` 在 H1/p/blockquote/li 等 block 内部文本节点对加粗 <strong>/斜体 <em>/下划线 <u>/高亮 <mark>/代码 <code> 的嵌套正确生效
- [A2] `document.execCommand('bold', 'italic', 'underline')` 在 contentEditable=true 容器内可叠加，不互相覆盖
- [A3] 高亮 `==text==` 对应 `<mark>`；行内代码 `` `code` `` 对应 `<code>`；链接 `[text](url)` 对应 `<a>`，这些语义 HTML 样式可在 globals.css 补充

## Acceptance Criteria

### AC-1: 结构下拉 12 项全部即时转换

- **Given**: Normal Mode 打开文档，光标在一个 paragraph 块中选中文本
- **When**: 点击 STRUCTURE 下拉并选择 "一级标题"（或 "引用"/"无序列表"/"代码块"）
- **Then**: 该块立即渲染为对应类型的视觉样式（H1 大字号粗体 / 引用左侧紫竖条 / 列表项目符号 / 代码块灰底 monospace），且切换后光标位置不丢失
- **Verification**: `human-judgment`

### AC-2: 粗体 + 斜体 + 下划线三叠加

- **Given**: 段落中存在普通文本 "Hello world"，选中 "world"
- **When**: 先点击 Bold 再点击 Italic 再点击 Underline
- **Then**: "world" 同时显示为 加粗 + 斜体 + 下划线（视觉三属性同时存在）；切换 Source Code Mode 后查看源码包含 `***<u>world</u>***` 或等价 MD 语法
- **Verification**: `human-judgment` + 切 Source 模式源码检查

### AC-3: 高亮 + 行内代码不冲突

- **Given**: 选中一段非代码普通文本
- **When**: 先点 Highlight（黄底）再点 Code（monospace 灰底）
- **Then**: 视觉上底色高亮 + 等宽字体同时生效；Markdown 源码为 ``==`code`==`` 或顺序可接受
- **Verification**: `human-judgment`

### AC-4: Link/Comment 即时可见

- **Given**: 选中 "WeaveMD官网" 点击 Link；选中另一处文本点击 Comment
- **When**: 工具栏操作完成后
- **Then**: "WeaveMD官网" 显示链接样式（accent 色 + 下划线，鼠标 hover 显示 url 光标）；Comment 文本后出现淡色注释图标或括号
- **Verification**: `human-judgment`

### AC-5: 撤销重做链完整

- **Given**: 未修改文档初始状态
- **When**: 依次执行 STRUCTURE 转 H2 → Bold 选中 → 转 Blockquote → 撤销 ×3 → 重做 ×3
- **Then**: 每个步骤均能正确回退/恢复，DOM 与 Source Mode 源码保持一致
- **Verification**: `human-judgment`

### AC-6: 持久化保存

- **Given**: 执行若干格式化和结构转换操作
- **When**: 切换 Source Code Mode 再切回 Normal Mode；或关闭窗口后重新打开
- **Then**: 所有格式化和结构保持不变（Markdown 源被正确写入 content 字段，通过 SQLite 持久化）
- **Verification**: `programmatic`：`npm run test` + `npm run typecheck` 全通过；`human-judgment`：手动验证切模式往返不丢失

### AC-7: 现有测试不回退

- **Given**: 主分支状态
- **When**: 本 PR 合并后
- **Then**: `npm run test` 通过率 100%；`npm run typecheck` 无错误；`npm run lint` 无错误
- **Verification**: `programmatic`

## Open Questions

- [ ] Highlight 样式底色色值：复用现有设计 token 还是用默认 `mark` 浏览器黄？→ 默认用 `mark` 并在 globals.css 覆盖成 Doubao 风格中性色
- [ ] Link 插入 URL 是否需要 prompt 弹窗？→ 先用占位 `url`，后续可迭代 prompt
