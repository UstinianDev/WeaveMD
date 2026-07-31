# 编辑主区 (Editor) 功能总结

> 模块编号：04 | 优先级：P0 | 版本：v4.4 | 最后更新：2026-07-31

---

## 1. 功能概述

核心编辑区域，采用**双模式架构**：

- **Normal Mode**：Block Tree → 容器级 `contentEditable` 可编辑富文本，支持直接编辑段落/标题、回车创建段落、Backspace 删除空段落、Ctrl+Z/Y 撤销重做。空块以零宽空格（`\u200B`）+ CSS 伪元素显示"Type something..."占位符。右侧 Canvas Minimap（文档缩影）、浮动工具栏（选中文本时显示）、跨块文本选择、代码块双击编辑
- **Source Code Mode**：全屏 Monaco 编辑器，编辑原始 markdown（`Ctrl+\`` 或 View 菜单切换）
- **Find & Replace**：Typora 风格 inline bar，两种模式均可用（`Ctrl+F`）

## 2. 核心数据模型：Block Tree

```
BlockTree = { rootBlockIds: BlockId[], blocks: Record<BlockId, BlockNode>, version: number }
BlockNode = {
  id: BlockId, type: BlockType, sourceLines: string[],
  headingLevel?, fenceLanguage?, parentId, childrenIds,
  startLine: number,        // 1-based 起始行号，用于 lineNumber 导航映射
  renderedHtml: string | null  // 缓存 DOM innerHTML，React 重渲染时恢复富文本格式
}
```

所有操作是**纯函数**（不可变），返回新树。

## 3. 文件结构

### 数据模型层 (`services/`)

- `blockTree.ts` — 核心数据结构和不可变操作
- `blockTreeBuilder.ts` — Markdown → BlockTree 解析器（7 种块检测优先级）
- `blockTreeSerializer.ts` — BlockTree → Markdown 序列化
- `searchEngine.ts` — 查找替换引擎（findAllMatches, replaceAll, validateRegex）
- `markdown.ts` — unified/remark/rehype 渲染管线 + Prism 高亮

### 组件层 (`components/Editor/`)

- `EditorView.tsx` — 主容器：双模式切换、Monaco 主题、全局快捷键、scroll 追踪、光标定位；lineNumber 导航回调、`handleSourceActiveHeadingChange` Source Code Mode 高亮包装
- `EditorScrollContainer.tsx` — 可滚动视口（单一 `contentEditable` 表面），渲染只读块组件；`forwardRef` 暴露 `scrollToBlock`（clamp 到 `scrollHeight - clientHeight`）；`detectActiveHeading` 取视口顶部 + 10px 检测线上方最后一个标题；padding 移至内层 `editor-content-area`（`40px 40px 100vh 40px`），外层无 padding → 滚动条正确反映内容大小
- `BlockRenderer.tsx` — 块类型分发器（只读渲染）
- `SourceCodeEditor.tsx` — 全屏 Monaco 编辑器（150ms debounce 写 store）；`scrollToLine(lineNumber)` 导航、`getNearestHeadingLineNumber` 动态高亮
- `FindReplaceBar.tsx` — Typora 风格 inline 查找替换栏
- `Minimap.tsx` — Canvas 文档缩影（viewport 指示器 + 点击导航）
- `blocks/` — 块组件：Heading、Paragraph、ListItem、CodeFence、Table、Blockquote、Empty（均为只读渲染，contentEditable 在容器层）
- `OutlinePanel.tsx` — 文档大纲（H1-H3 标题树），lineNumber 索引导航 + 动态高亮当前标题；字体 H1=text-lg/H2=text-base/H3=text-sm
- `FloatingToolbarWYSIWYG.tsx` — WYSIWYG 浮动工具栏：使用 `document.execCommand` + `Range API` 直接操作 DOM；支持 Toggle 格式化（Bold/Italic/Underline/Strikethrough/Highlight/InlineCode/Link/Comment）；MD Source 功能（显示/隐藏当前段落 Markdown 源码）
- `ActiveBlockEditor.tsx` —（已废弃）Monaco 迷你编辑器
- `FindReplaceModal.tsx` —（已废弃）旧居中模态框

## 4. 数据流

### Normal Mode

```
editorStore.content → buildBlockTree → renderMarkdownToHtml(per block)
  → BlockRenderer → 只读 block 组件 → DOM
  → 用户编辑 → onInput → debounce(30ms) → handleBlockInput
  → [code-fence 块跳过：独立 textarea 编辑路径，不运行 detectMarkdownLine]
  → Markdown 类型检测（标题/列表/引用等） → 必要时类型转换
  → Enter/Backspace → handleBlockEnter/handleBlockDelete
  → pushUndo → syncTreeToStore → editorStore.updateContent()
  → 工具栏操作 → afterFormat → handleSyncToStore
  → [code-fence 块跳过：仅更新 renderedHtml，不重建 sourceLines]

目录导航：OutlinePanel.onNavigate(lineNumber, headingIndex) → EditorView.navigateToHeading()
  → find block by startLine → scrollContainerRef.scrollToBlock(blockId)
  → 标题滚到视口顶部（无偏移）

目录高亮：EditorScrollContainer scroll → detectActiveHeading()
  → detectLine = containerTop + 10px → 最后一个 rect.top ≤ detectLine 的标题
  → onActiveHeadingChange(headingIndex) → OutlinePanel highlight
```

### 模式切换

```
Normal → Source: syncContentBeforeToggle() 同步 DOM 变更到 blockTree
  → serializeBlockTree() → setContent() → Monaco 加载

Source → Normal: buildBlockTree(latestContent) → 重建 blockTree → 渲染块
```

### Source Code Mode (独立数据流)

```
SourceCodeEditor (Monaco) → 150ms debounce → editorStore.updateContent()

目录导航：OutlinePanel.onNavigate(headingIndex) → EditorView.getLineNumberForHeadingIndex()
  → extractOutline DFS 遍历 → lineNumber → scrollToLine(lineNumber)
  → setPosition + revealPositionInCenterIfOutsideViewport

目录高亮：Monaco onDidChangeCursorPosition → getNearestHeadingLineNumber(cursorLine)
  → onActiveHeadingChange(lineNumber) → EditorView.getHeadingIndexForLineNumber()
  → convert to headingIndex → OutlinePanel highlight
```

### Find & Replace

```
FindReplaceBar → searchEngine.findAllMatches(content) → 匹配高亮
  → replaceAll → editorStore.updateContent() → content useEffect → rebuild blockTree
```

## 5. 关键特性

| 特性           | 详情                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **双模式**     | Normal（容器级 contentEditable WYSIWYG + Minimap）/ Source Code（全屏 Monaco）                                                                                                                    |
| **Minimap**    | 64px Canvas，块类型颜色编码，viewport 指示器，点击导航                                                                                                                                            |
| **标题字号**   | H1=26/700、H2=22/600、H3=18/600、H4=16/500、P=14/400                                                                                                                                              |
| **代码块语言** | `<select>` 下拉选择；语言别名归一化（`sh`→`shell`、`Plain Text`→`plaintext`）                                                                                                                     |
| **代码块编辑** | 双击进入 textarea 编辑模式，失焦保存；独立编辑路径，不经过 contentEditable/detectMarkdownLine，避免代码中的 `#` 被误检测为标题                                                                    |
| **浮动工具栏** | 选中文本时显示；Toggle 格式化（Bold/Italic/Underline/Strikethrough/Highlight/InlineCode/Link/Comment），使用 `document.execCommand` + DOM 直接操作实现实时渲染；MD Source 显示/隐藏 Markdown 源码 |
| **实时渲染**   | `dangerouslySetInnerHTML` + `BlockNode.renderedHtml` 存储 DOM HTML，React 重渲染时恢复富文本格式，支持多属性叠加                                                                                  |
| **跨块选择**   | 容器级 contentEditable，支持跨段落/标题选择                                                                                                                                                       |
| **空块占位**   | 零宽空格 `\u200B` + CSS `::before` 显示 "Type something..."                                                                                                                                       |
| **自动保存**   | 1200ms debounce；关闭/切换文件前 flush                                                                                                                                                            |
| **撤销/重做**  | 自定义栈，50 条上限，跨会话保留；段落增删手动 pushUndo                                                                                                                                            |
| **光标管理**   | TreeWalker 遍历 DOM 文本节点，支持零宽空格偏移计算                                                                                                                                                |
| **IME 兼容**   | isComposing 守卫；inline bar 无 DOM 挂载/卸载                                                                                                                                                     |
| **快捷键**     | Ctrl+S 保存、Ctrl+Z/Y 撤销/重做、Ctrl+F 查找、Ctrl+` 源码模式                                                                                                                                     |
| **目录导航**   | Normal Mode: lineNumber → `startLine` 匹配 → `scrollToBlock`（无偏移）；Source Code Mode: lineNumber → `scrollToLine`                                                                             |
| **目录高亮**   | Normal Mode: viewport top + 10px detectLine → last heading above；Source Code Mode: cursor → nearest heading → headingIndex                                                                       |
| **目录宽度**   | `uiStore.outlineWidth`（默认 280px，范围 200-500px）；右侧拖拽手柄，持久化到 localStorage                                                                                                         |
| **滚动条**     | 编辑器 + 目录：10px 宽 webkit scrollbar，圆角 thumb，悬停加粗；全局：6px；padding 在内层容器 → 滚动条正确反映内容大小                                                                             |
| **MD Source**  | 工具栏 "Src" 按钮；显示当前段落原始 Markdown 源码；切换前 `handleSyncToStore` 同步 DOM → React state，确保格式不丢失；再次点击或点击其他内容恢复富文本                                            |     |

## 6. 块检测优先级

```
空白行(跳过) > 代码围栏 > 表格 > 标题 > 引用 > 列表项 > 段落(兜底)
```

## 7. 与其他模块交互

| 模块       | 交互方式                                            |
| ---------- | --------------------------------------------------- |
| 导航栏     | editorStore 文件/撤销/重做；uiStore 切换模式/查找栏 |
| 认证系统   | 切换账号时 closeFile() 清空编辑器                   |
| 数据持久化 | saveFile() 通过 IPC 保存到 SQLite                   |
| 设置       | 主题变化切换 Monaco 主题                            |
| 导出       | 导出当前 content 为 MD/Word/PDF                     |
