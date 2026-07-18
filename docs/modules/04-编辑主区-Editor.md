# 编辑主区 (Editor) 功能总结

> 模块编号：04 | 优先级：P0 | 版本：v3.0 | 最后更新：2026-07-18

---

## 1. 功能概述

应用的核心编辑区域，包含目录面板、Monaco 编辑器、浮动工具栏和历史面板。支持 Markdown 编辑、Typora 式富文本排版、目录导航、按需 MD 原文查看、撤销/重做、自动保存等功能。

**v3.0 深度重做：True WYSIWYG 块编辑器（2026-07-18）：**
- 学习 MarkText/Muya 架构，全面替换 ContentWidget 叠加层系统
- 采用 Block Tree 数据模型 + React 块组件 + 按需 Monaco 迷你编辑器
- 彻底解决了 v2.x 所有已知问题（横向溢出、Widget 消失、红色 artifacts 等）
- FloatingToolbar 需要重写以适配新架构

**v2.2 编辑区优化（2026-07-17）：**
- 修复标题渲染 widget 与正文重叠问题
- 修复渲染块中出现红色方框 artifacts
- 修复代码块首行滚出视口后整个 widget 消失的问题
- 修复代码块 pure-text 样式丑陋问题（Catppuccin Mocha 暗色主题）
- 尝试修复正文横向溢出不换行问题（CSS !important + JS 即时宽度设置，**已由 v3.0 解决**）

**v2.1 编辑区优化（2026-07-08）：**
- 移除编辑器行号，扩大内容可视宽度
- 富文本块横向铺满可视区域后再换行，减少短句无故拆行
- 默认点击/编辑均保持富文本排版；仅通过浮动工具栏「MD原文」按钮查看整段 Markdown 源文
- 点击编辑区其他位置自动恢复富文本显示

## v3.0 深度重做：True WYSIWYG 块编辑器（2026-07-18）

### 背景
v2.x 使用的 Monaco ContentWidget 叠加层系统存在根本性架构限制：
- 文本横向溢出无法彻底解决（尝试了 10+ 种 CSS/JS 方案均失败）
- Widget 是只读叠加层，无法在渲染视图中编辑
- 基于位置的 BlockID 在行插入/删除时会断裂
- 滚动性能问题复杂

### 架构决策
学习 MarkText/Muya 项目后，采用**混合方案**：
- **Monaco 保留**：仅用于当前编辑块（active block）的迷你编辑器
- **React 组件**：非活动块改用 React 组件，在正常 DOM 流中渲染
- **Block Tree**：稳定的 JSON 状态模型（非基于位置的 ID）

### 核心改进
| 旧架构 (v2.x) | 新架构 (v3.0) |
|--------------|--------------|
| Monaco 全文档编辑器 | React Block 组件 + 按需 Monaco 迷你编辑器 |
| ContentWidget 叠加层 | 普通 DOM 流中的 React 组件 |
| 位置型 BlockID (`heading:3-5`) | 稳定 BlockID (`42_a3f2`) |
| 全局 decorations 隐藏语法标记 | 内联 Monaco decorations 仅作用于活动块 |
| 滚动 translateY 偏移 | 原生浏览器滚动 |
| `allowEditorOverflow: true` | 无需此项 |

### 新增文件 (16 个)
| 文件 | 作用 |
|------|------|
| `services/blockTree.ts` | Block Tree 数据结构和不可变工具函数 |
| `services/blockTreeBuilder.ts` | Markdown 字符串 → BlockTree 解析器 |
| `services/blockTreeSerializer.ts` | BlockTree → Markdown 字符串序列化 |
| `services/blockController.ts` | 块级操作：分割、合并、导航、变换 |
| `services/inlineDecorator.ts` | 内联 WYSIWYG 装饰：隐藏语法标记、应用格式 |
| `components/Editor/ActiveBlockEditor.tsx` | Monaco 迷你编辑器包装器 |
| `components/Editor/EditorScrollContainer.tsx` | 可滚动文档视口 |
| `components/Editor/BlockRenderer.tsx` | 块类型分发器 |
| `components/Editor/blocks/HeadingBlock.tsx` | H1-H6 标题块 |
| `components/Editor/blocks/ParagraphBlock.tsx` | 段落块 |
| `components/Editor/blocks/ListItemBlock.tsx` | 无序/有序/任务列表块 |
| `components/Editor/blocks/CodeFenceBlock.tsx` | 围栏代码块 |
| `components/Editor/blocks/TableBlock.tsx` | 表格块 |
| `components/Editor/blocks/BlockquoteBlock.tsx` | 引用块 |
| `components/Editor/blocks/EmptyBlock.tsx` | 点击添加占位符 |

## 2. 架构位置

```
src/render/pages/MainPage.tsx                          # 主页面布局
src/render/components/Editor/
├── EditorView.tsx                                     # 主编辑器编排器 (重写)
├── BlockRenderer.tsx                                  # 块类型分发器 (新增 v3.0)
├── ActiveBlockEditor.tsx                              # Monaco 迷你编辑器包装器 (新增 v3.0)
├── EditorScrollContainer.tsx                          # 可滚动文档视口 (新增 v3.0)
├── blocks/                                            # 各块类型的 React 组件 (新增 v3.0)
│   ├── HeadingBlock.tsx
│   ├── ParagraphBlock.tsx
│   ├── ListItemBlock.tsx
│   ├── CodeFenceBlock.tsx
│   ├── TableBlock.tsx
│   ├── BlockquoteBlock.tsx
│   └── EmptyBlock.tsx
├── OutlinePanel.tsx                                   # 目录面板
├── FloatingToolbar.tsx                                # 浮动工具栏 (stub — 需要重写 v3.0)
├── HistoryPanel.tsx                                   # 历史面板
├── editorBlockDecorations.ts                          # 编辑器块装饰 (v2.x 遗留)
├── markdownBlockWidgets.ts                            # Markdown 块小部件 (v2.x 遗留)
└── markdownBlockRenderer.ts                           # Markdown 块渲染器 (v2.x 遗留)
src/render/services/
├── blockTree.ts                                       # Block Tree 数据结构 (新增 v3.0)
├── blockTreeBuilder.ts                                # Markdown → BlockTree 解析 (新增 v3.0)
├── blockTreeSerializer.ts                             # BlockTree → Markdown 序列化 (新增 v3.0)
├── blockController.ts                                 # 块级操作控制器 (新增 v3.0)
├── inlineDecorator.ts                                 # 内联 WYSIWYG 装饰 (新增 v3.0)
├── markdown.ts                                        # Markdown 处理服务 (439行)
└── markdownBlockDetector.ts                           # Markdown 块检测器
src/render/stores/
├── editorStore.ts                                     # 编辑器状态管理 (124行)
├── uiStore.ts                                         # UI 状态（块状态、草稿刷新器）
└── historyStore.ts                                    # 历史文件列表
```

## 3. 实现逻辑流程

### 3.1 主页面布局

```
┌──────────────────────────────────────────────────────────────┐
│                         TopBar                                │
├────────────────┬─────────────────────────────────────────────┤
│                │                                             │
│  OutlinePanel  │            EditorView                       │
│  (左侧 1/4)    │     (Monaco Editor)                         │
│                │                                             │
│  目录树        │    Markdown 编辑 + 块级富文本渲染              │
│  H1/H2/H3      │    无行号 / 代码高亮 / 自动缩进               │
│  可展开/关闭   │    300ms 防抖更新 / 1200ms 自动保存          │
│                │                                             │
├────────────────┴─────────────────────────────────────────────┤
│                        StatusBar                              │
├─────────────────────────────────────────────────────────────┤
│             浮动工具栏 (选中文本时显示)                        │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Markdown 处理管道

```
输入 (Markdown 文本)
  ↓
prepareMarkdownForRendering() — 去除文档行号前缀
  ↓
remark-parse — 解析为 MDAST (Markdown AST)
  ↓
remark-gfm — GFM 支持（表格、删除线、任务列表）
  ↓
remarkEnhanceTypography — 自定义转换
  ├── ==高亮文本== → <mark class="markdown-highlight">
  └── <!-- 注释 --> → <span class="markdown-comment">
  ↓
remark-rehype — MDAST → HAST (HTML AST)
  ↓
rehypeEnhanceMarkdown — 自定义增强
  ├── 表格包裹 div.markdown-table-wrap
  └── 代码块 Prism.js 高亮
  ↓
rehype-stringify — HAST → HTML
  ↓
输出 (HTML)
```

### 3.3 目录生成流程

```
Markdown 内容
  ↓
parseMarkdownToAST(content) → MDAST Root
  ↓
遍历 AST 节点，提取 heading (depth 1-3)
  ↓
构建 OutlineItem[] 树形结构（栈算法）
  ↓
渲染为可点击的树形列表
  ↓
用户点击 → editor.revealLineInCenter(lineNumber) → 跳转
```

**树构建算法：**

```typescript
function extractOutline(content: string): OutlineItem[] {
  const ast = parseMarkdownToAST(content);
  const headings: { text; level; lineNumber }[] = [];

  // 遍历 AST 找到所有 H1/H2/H3
  function walk(node) {
    if (node.type === 'heading' && node.depth >= 1 && node.depth <= 3) {
      headings.push({
        text: extractText(node),
        level: node.depth,
        lineNumber: node.position.start.line,
      });
    }
    node.children?.forEach(walk);
  }
  walk(ast);

  // 使用栈构建层级树
  const root: OutlineItem[] = [];
  const stack: OutlineItem[] = [];
  for (const h of headings) {
    const item = {
      id: `heading-${h.lineNumber}`,
      text: h.text,
      level: h.level,
      lineNumber: h.lineNumber,
      children: [],
    };
    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) stack.pop();
    if (stack.length === 0) root.push(item);
    else stack[stack.length - 1].children.push(item);
    stack.push(item);
  }
  return root;
}
```

### 3.4 编辑器内容更新流程

```
用户输入/粘贴
  ↓
Monaco Editor onChange 事件
  ↓
300ms 防抖 (useDebouncedCallback)
  ↓
editorStore.updateContent(value)
  ├── 旧内容推入 undoStack（最多 50 条）
  ├── 清空 redoStack
  ├── 标记 isDirty = true
  └── 更新 content
  ↓
MainPage useEffect 检测 isDirty
  ↓
1200ms 无变化后触发保存
  ↓
editorStore.saveFile()
  ├── IPC: file:save(fileId, content, userId)
  │   ├── 读取当前文件内容 → 保存为历史版本 (saveVersion)
  │   └── 更新文件内容 (updateFileContent)
  └── 标记 isDirty = false, 更新 modifiedAt
```

### 3.5 撤销/重做流程

```
撤销 (Ctrl+Z):
  editorStore.undo()
  ├── undoStack 弹出最后一项 → 恢复为当前内容
  ├── 当前内容推入 redoStack
  └── 触发 EditorView useEffect → editor.setValue(恢复的内容)

重做 (Ctrl+Y / Ctrl+Shift+Z):
  editorStore.redo()
  ├── redoStack 弹出最后一项 → 恢复为当前内容
  ├── 当前内容推入 undoStack
  └── 触发 EditorView useEffect → editor.setValue(恢复的内容)
```

### 3.6 块级渲染与 MD 原文切换流程（v2.x 历史）

```
编辑器内容变化 / 光标移动
  ↓
markdownBlockDetector.detectAllBlocks(model)
  ↓
transitionBlockState(blocks, event) — 状态机转换（追踪 activeBlockId）
  ↓
mdSourceBlockId 控制源文/富文本切换（与 activeBlockId 解耦）
  ├── 默认：所有块均渲染富文本（含当前光标所在块）
  ├── 浮动工具栏「MD原文」→ 选中块整段切换为 MD 源文
  └── 光标移至其他块 / 失焦 → 清除 mdSourceBlockId，恢复富文本
  ↓
applyDecorations(editor, blocks, mdSourceBlockId)
  ↓
markdownBlockWidgets.sync(content, blocks, mdSourceBlockId)
  ├── 非 mdSourceBlockId 的块：创建渲染小部件视觉叠加（allowEditorOverflow，不插入 view zone）
  └── mdSourceBlockId 对应块：移除小部件，显示完整 Markdown 源文
```

**MD 原文范围规则：** 用户即使只选中段落中的部分内容，「MD原文」也会展示该内容所属**整段块**（paragraph / heading / list-item 等）的完整 Markdown 源文。

### 3.7 块级渲染流程（历史参考，已由 3.6 取代 activeBlockId 控制逻辑）

```
编辑器内容变化 / 光标移动
  ↓
markdownBlockDetector.detectAllBlocks(model)
  ├── 解析内容识别 Markdown 块（代码围栏、表格、列表等）
  └── 返回 BlockInfo[]（包含块类型、范围、行号）
  ↓
transitionBlockState(blocks, event) — 状态机转换
  ├── cursorMove → 更新 activeBlockId
  ├── contentChange → 检测块边界变化
  └── blur → 收起所有块
  ↓
applyDecorations(editor, blocks, activeBlockId)
  ├── 为块添加边框/背景装饰
  └── 源码块隐藏 (opacity: 0)
  ↓
markdownBlockWidgets.sync(content, blocks, activeBlockId)
  ├── 创建渲染后的小部件（代码高亮、表格渲染）
  └── 覆盖在源码块上方
```

## 4. 实现细节

### 4.1 Monaco 编辑器配置

```typescript
{
  fontSize: 16,
  fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace, ...',
  lineNumbers: 'off',
  glyphMargin: false,
  lineDecorationsWidth: 0,
  lineNumbersMinChars: 0,
  minimap: { enabled: false },
  wordWrap: 'on',
  wordWrapColumn: 120,
  wrappingStrategy: 'advanced',
  automaticLayout: true,
  ...
}
```

### 4.2 自定义 Monaco 主题

#### weaveMD-dark（深色主题）

```typescript
monaco.editor.defineTheme('weaveMD-dark', {
  base: 'vs-dark',
  colors: {
    'editor.background': '#0F0F0F',
    'editor.foreground': '#FFFFFF',
    'editor.lineHighlightBackground': '#1A1A1A',
    'editor.selectionBackground': '#7C3AED40',
    'editorCursor.foreground': '#7C3AED',
    'editorLineNumber.foreground': '#999999',
    'editorLineNumber.activeForeground': '#FFFFFF',
    'editorGutter.background': '#0F0F0F',
    'editorWidget.background': '#1A1A1A',
    'editorWidget.border': '#2D2D2D',
    'input.background': '#0F0F0F',
    'input.border': '#2D2D2D',
    'input.foreground': '#FFFFFF',
  },
  rules: [
    { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: '569CD6' },
    { token: 'string', foreground: 'CE9178' },
    { token: 'number', foreground: 'B5CEA8' },
    { token: 'type', foreground: '4EC9B0' },
    { token: 'function', foreground: '#DCDCAA' },
    { token: 'variable', foreground: '#9CDCFE' },
    { token: 'heading', foreground: '#7C3AED', fontStyle: 'bold' },
  ],
});
```

#### weaveMD-light（浅色主题）

```typescript
monaco.editor.defineTheme('weaveMD-light', {
  base: 'vs',
  colors: {
    'editor.background': '#FFFFFF',
    'editor.foreground': '#111827',
    'editor.lineHighlightBackground': '#F3F4F6',
    'editor.selectionBackground': '#7C3AED20',
    'editorCursor.foreground': '#7C3AED',
    'editorLineNumber.foreground': '#9CA3AF',
    'editorLineNumber.activeForeground': '#111827',
    'editorGutter.background': '#FFFFFF',
  },
  rules: [
    { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: '0000FF' },
    { token: 'string', foreground: 'A31515' },
    { token: 'function', foreground: '#795E26' },
    { token: 'heading', foreground: '#7C3AED', fontStyle: 'bold' },
  ],
});
```

### 4.3 快捷键绑定

| 快捷键         | 动作     | 实现                          |
| -------------- | -------- | ----------------------------- |
| `Ctrl+S`       | 保存文件 | flush 防抖内容 → `saveFile()` |
| `Ctrl+Z`       | 撤销     | flush 防抖内容 → `undo()`     |
| `Ctrl+Y`       | 重做     | flush 防抖内容 → `redo()`     |
| `Ctrl+Shift+Z` | 重做     | flush 防抖内容 → `redo()`     |

### 4.4 防抖实现

```typescript
// 300ms 防抖，避免频繁更新 Zustand store
function useDebouncedCallback(callback: (value: string) => void, delay: number): DebouncedCallback {
  // 使用 ref 存储 timeout 和 pending value
  // flush(): 立即执行业待处理的回调
  // cancel(): 取消待处理的回调
}
```

### 4.5 编辑器 Store 状态

```typescript
interface EditorStore {
  currentFile: IFile | null; // 当前打开的文件
  content: string; // 当前编辑内容
  isDirty: boolean; // 是否有未保存的更改
  undoStack: string[]; // 撤销栈（最多 50 条）
  redoStack: string[]; // 重做栈

  openFile(file: IFile): void; // 打开文件 → 重置 undo/redo
  updateContent(content: string): void; // 更新内容 + 管理 undo/redo
  saveFile(): Promise<void>; // IPC 保存 + 历史版本
  closeFile(): void; // 关闭文件 → 清空状态
  undo(): void; // 撤销
  redo(): void; // 重做
  pushUndo(content: string): void; // 手动推入 undo 栈
  markClean(): void; // 标记为已保存
}
```

### 4.6 浮动工具栏

选中文本时在正上方显示，包含 11 个按钮：

| #   | 按钮     | 功能                                                  | 实现方式                          |
| --- | -------- | ----------------------------------------------------- | --------------------------------- |
| 1   | 结构 Θ   | 下拉选择 Text/H1/H2/H3/List/Task/Code/Quote/Highlight | 替换选中文本格式                  |
| 2   | 粗体 B   | **粗体**                                              | 包裹 `**text**`                   |
| 3   | 斜体 I   | _斜体_                                                | 包裹 `*text*`                     |
| 4   | 下划线 U | <u>下划线</u>                                         | 包裹 `<u>text</u>`                |
| 5   | 代码 <>  | `行内代码`                                            | 包裹 `` `text` ``                 |
| 6   | 链接 🔗  | 超链接                                                | 插入 `[text](url)`                |
| 7   | 复制 📋  | 复制选中文本                                          | `navigator.clipboard.writeText()` |
| 8   | 评论 💬  | 插入注释                                              | 包裹 `<!-- text -->`              |
| 9   | **MD原文** | 查看整段 Markdown 源文                              | 设置 `mdSourceBlockId` + 选中整段 |

**MD 原文交互：**

```typescript
// resolveMdSourceBlockFromSelection — 从部分选区解析整段块
const block = resolveMdSourceBlockFromSelection(model, selection);
setMdSourceBlockId(block.id);
editor.setSelection({ startLineNumber: block.startLine, ... block.endLine });
// 光标移至其他块或失焦 → clearMdSourceBlockId()
// 工具栏按钮 onMouseDown preventDefault，避免点击时编辑器 blur 导致 mdSourceBlockId 被清除
```

**富文本 overlay 与源行分离：**

- 渲染 widget 仅作视觉层（`allowEditorOverflow: true` + `pointer-events: none`），**不再**通过动态 `lineHeight` 或 view zone 撑高 Monaco 源行
- 源行保持编辑器默认行高，选区按 Markdown 源行/列精确变化，避免「选第一行却覆盖到第三行」
- 块内渲染样式收紧段前段后间距，避免 widget 与源行双份留白

```css
.markdown-block-rendered p { margin-top: 0; margin-bottom: 0.35em; }
.markdown-block-source-hidden { opacity: 0; } /* 源行仅隐藏，不撑高 */
```

### 4.7 代码高亮（Prism.js）

支持语言：`bash`, `json`, `jsx`, `markdown`, `tsx`, `typescript`, `javascript`

```typescript
// 语言别名映射
const LANGUAGE_ALIAS_MAP = {
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
};

// 代码高亮
function highlightCode(value: string, language: string | null) {
  if (!language) return escapeHtml(value);
  const grammar = Prism.languages[language];
  if (!grammar) return escapeHtml(value);
  return Prism.highlight(value, grammar, language);
}
```

### 4.8 自动保存机制

```typescript
// MainPage.tsx — 1200ms 自动保存
useEffect(() => {
  if (!currentFile?.id || !isDirty) return;
  const timer = window.setTimeout(() => {
    saveFile();
  }, 1200);
  return () => window.clearTimeout(timer);
}, [currentFile?.id, isDirty, saveFile]);
```

### 4.9 文档行号去除

```typescript
// markdown.ts — 去除粘贴内容中的行号前缀
// 检测规则：连续 3+ 行匹配 /^(\s*)(\d{1,6})(?:\s+(.*))?$/ 则去除
function stripDocumentLineNumbers(content: string): string {
  // 1. 按行分割
  // 2. 检测行号模式
  // 3. 如果连续递增 ≥ 3 行 → 去除行号前缀
  // 4. 返回处理后的内容
}
```

### 4.10 特殊语法支持

| 语法            | 渲染结果                                           | 实现                    |
| --------------- | -------------------------------------------------- | ----------------------- |
| `==高亮文字==`  | `<mark class="markdown-highlight">高亮文字</mark>` | 正则替换                |
| `<!-- 注释 -->` | `<span class="markdown-comment">注释</span>`       | AST 转换                |
| `- [ ] 任务`    | 复选框 + 删除线                                    | remark-gfm              |
| `\| 表格 \|`    | HTML `<table>`                                     | remark-gfm + wrap table |

## 5. ContentWidget 富文本叠加层系统

> **⚠️ v3.0 中已弃用** — 以下为 v2.x 的历史文档，保留供参考。
> 
> ⚠️ **FloatingToolbar 需要重写** — FloatingToolbar 当前为 stub（返回 null），需要适配新的块编辑器架构。

### 5.1 架构概览

采用 Monaco ContentWidget overlay 实现 Typora 风格的所见即所得编辑。源行保持 Monaco 默认行高（被 `markdown-block-source-hidden` 隐藏），渲染后的 HTML 通过 ContentWidget 叠加在源行上方。

```
编辑内容（Markdown 纯文本）
  ↓
markdownBlockDetector.detectAllBlocks(model)
  ├── 识别 8 种块类型：heading / paragraph / unordered-list-item
  │   / ordered-list-item / task-list-item / blockquote / code-fence / table
  └── 返回 BlockInfo[]（块类型、起止行号、语法标记）
  ↓
editorBlockDecorations.buildBlockDecorations()
  ├── 语法标记隐藏（`**`, `#`, `- [ ]` 等）→ inlineClassName: 'hidden-markdown-marker'
  └── 源行隐藏 → inlineClassName: 'markdown-block-source-hidden'
  ↓
MarkdownRenderedBlocksController.sync(content, blocks, mdSourceBlockId)
  ├── 非 mdSourceBlockId 的块 → extractRenderableBlockMarkdown() → renderMarkdownToHtml()
  │   └── unified + remark + remark-gfm + remarkRehype + rehypeEnhanceMarkdown + rehypeStringify
  ├── 创建 ContentWidget (allowEditorOverflow: true, suppressMouseDown: false)
  └── 挂载到 Monaco overflow widget 层（pointer-events: none 保证点击穿透）
```

### 5.2 ContentWidget 生命周期控制器

**文件**：`src/render/components/Editor/markdownBlockWidgets.ts`

```typescript
class MarkdownRenderedBlocksController {
  // 核心数据结构
  private widgetRecords: Map<string, WidgetRecord>;  // blockId → {block, domNode, widget}
  private renderCache:  Map<string, string>;          // 渲染结果缓存（避免重复 remark 处理）
  private renderVersion: number;                       // 并发控制（过期版本丢弃）

  // 滚动处理
  private scrollListener: IDisposable;               // editor.onDidScrollChange 监听器
  private scrollRepositionTimer: ReturnType<typeof setTimeout>;  // 50ms 防抖

  // 布局
  private relayoutHandle: ReturnType<typeof setTimeout> | number;  // rAF 重排

  async sync(content, blocks, mdSourceBlockId): Promise<Set<string> | null>   // 主入口
  relayout()                                  // 设置 widget 宽度 = editor.contentWidth - 8
  dispose()                                   // 清理所有 widget + 监听器
}
```

### 5.3 Widget 滚动定位机制

**问题**：Monaco 只渲染其锚点位置在可视区域内的 ContentWidget。当多行代码块的首行滚出视口后，整个 widget 消失。

**方案**—动态锚点 + translateY 偏移（`syncWidgetScrollOffset`）：

```
block.startLine > firstVisible → 锚点保持 block.startLine，无偏移
block.startLine < firstVisible ≤ block.endLine
  → 锚点改为 firstVisible
  → translateY(-hiddenLines × lineHeight)，将已被滚出的部分上移隐藏
  → max-height = visibleLines × lineHeight，裁剪可见部分
```

### 5.4 Widget 高度溢出控制

**问题**：标题 H1 的渲染字体（如 `clamp(2.25rem, 2rem+1vw, 2.9rem)`）远超 Monaco 源行默认 ~24px，widget 内容溢出到相邻块区域。

**方案**—动态 max-height（`upsertWidget`）：

```typescript
// 标题使用专用行高比例：[42, 38, 34, 30, 28, 26] 对应 H1-H6
const lineCount = block.endLine - block.startLine + 1;
record.domNode.style.maxHeight = `${lineCount * lineHeight}px`;
```

配合 CSS `overflow: hidden` 裁剪溢出部分。

### 5.5 红色方框 Artifacts 修复

**问题**：渲染块中出现红色小方框。根因有三：

| 根因 | 机制 | 修复 |
|------|------|------|
| `bracketPairColorization: { enabled: true }` | Monaco 为括号对绘制彩色边框盒子 | 设为 `{ enabled: false }` |
| `matchBrackets: 'always'`（默认） | 匹配的括号对高亮显示 | 设为 `'never'` |
| `occurrencesHighlight: 'singleFile'`（默认） | 选中单词的其他出现位置高亮 | 设为 `'off'` |
| `.hidden-markdown-marker` 无背景色覆盖 | 红色 token（如数字、属性）透过透明 widget 可见 | `color: transparent !important` + `background: transparent !important` |

### 5.6 代码块样式

**问题**：Plain-text 代码块渲染无辨识度，与正文难以区分。

**方案**—Catppuccin Mocha 暗色主题：

```css
:root {
  --bg-code: #1e1e2e;    /* Catppuccin Mocha base */
  --text-code: #cdd6f4;  /* Catppuccin Mocha text */
}
.markdown-block-rendered--code-fence .markdown-code-block {
  background: var(--bg-code);
  border-radius: 10px;
  padding: 0.85em 1em;
}
```

Prism.js 语法高亮覆盖亮/暗两种主题，语言标签（`data-language`）显示在代码块顶部。

### 5.7 文本换行控制（未完全解决）

**问题**：正文内容（paragraph）渲染 widget 中，文本横向超出编辑区域时不会自动换行。

**已尝试的方案**：

| 方案 | 文件 | 效果 |
|------|------|------|
| CSS `overflow-wrap: anywhere` | `globals.css` `.markdown-block-widget .markdown-preview` | 理论上可在任意位置断行 |
| CSS `word-break: break-word` | `globals.css` 同上 | 长单词/URL 可断行 |
| CSS `white-space: normal` | `globals.css` 同上 | 覆盖 Monaco 的 `white-space: pre` 泄漏 |
| CSS `!important` 优先级提升 | `globals.css` 同上 | 防止 Monaco CSS 覆盖 |
| JS 即时宽度设置 | `markdownBlockWidgets.ts` `upsertWidget()` | widget 创建时立即 `domNode.style.width = contentWidth + 'px'` |
| CSS `contain: layout style` | `globals.css` `.markdown-block-widget` | 布局隔离，防止外部 CSS 泄漏 |
| CSS `.markdown-block-rendered *` 通配符 | `globals.css` | 对所有后代元素强制 `max-width: 100%` |
| CSS `overflow-x: hidden` | `globals.css` widget + preview | 裁剪溢出内容 |
| `<pre>`/`<code>` 专门处理 | `globals.css` | 代码块横向滚动，内联代码 `pre-wrap` |
| `<table>` 包裹层 | `globals.css` `.markdown-table-wrap` | `max-width: 100%` + `overflow-x: auto` |

**当前状态**：上述方案通过 `tsc --noEmit`、`eslint`、94/94 vitest、Vite build 验证，CSS 规则在 production build 中确认存在，但用户反馈在某些场景下仍有横向溢出。

**疑点**：
1. Monaco 的 `.monaco-editor { overflow-wrap: initial }` 可能优先级高于 widget 的 `!important`（需要排查 CSS 层叠上下文）
2. ContentWidget 的 DOM 节点所在父容器（Monaco overflow widget 层）宽度可能无约束
3. 浏览器默认 `white-space` 对某些元素的继承可能绕过通配符规则

### 5.8 CSS 规则总览（widget 渲染相关）

```
.markdown-block-widget                          # 根容器
├── overflow: hidden; overflow-x/y: hidden      # 裁剪溢出
├── contain: layout style                       # 布局隔离
├── box-sizing: border-box                      # 盒模型
│
└── .markdown-preview                           # 渲染内容容器
    ├── max-width: 100% !important              # 强制不超过 widget 宽度
    ├── overflow-wrap: anywhere !important      # 任意位置断行
    ├── word-break: break-word !important       # 长单词断行
    ├── white-space: normal !important          # 覆盖 Monaco pre
    ├── min-width: 0                            # 防止 flex 溢出
    ├── overflow-x: hidden                      # 横向裁剪
    │
    └── .markdown-block-rendered                # 块级渲染内容
        ├── min-width: 0; overflow-wrap: anywhere; word-break: break-word
        ├── * { max-width: 100%; overflow-wrap: anywhere }  # 所有后代
        ├── code { white-space: pre-wrap !important }        # 内联代码可换行
        ├── pre { white-space: pre !important; overflow-x: auto }  # 代码块可滚动
        └── pre code { white-space: pre !important }         # 代码块保持格式
```

## 6. 与其他模块的交互

| 模块       | 交互方式                                                     |
| ---------- | ------------------------------------------------------------ |
| 导航栏     | 通过 `editorStore` 提供撤销/重做状态；文件操作触发编辑器变化 |
| 认证系统   | 切换账号时 `editorStore.closeFile()` 清空编辑器状态          |
| 数据持久化 | `saveFile()` 通过 IPC 保存文件内容及历史版本                 |
| 设置       | 主题变化时切换 Monaco Editor 主题                            |
| 导出       | 导出当前编辑器内容为 MD/Word/PDF                             |

## 7. 关键设计决策

1. **Monaco Editor**：选择 VS Code 同源的编辑器，功能完善、大文件处理优秀
2. **无行号编辑区**：移除 gutter 行号，内容区横向空间最大化
3. **富文本优先**：默认所有块（含光标所在块）均显示排版态；MD 源文仅通过工具栏「MD原文」按需开启
4. **整段 MD 原文**：`mdSourceBlockId` 按块粒度切换，部分选区也会展开至整段块范围
5. **自定义撤销/重做栈**：与 Monaco 内置撤销分离，实现跨会话的撤销历史（最多 50 条）
6. **双层防抖**：300ms 防抖更新 Store + 1200ms 防抖自动保存，平衡实时性和性能
7. **块级渲染**：代码块、表格等实时渲染预览，提升 Markdown 可视化体验
8. **自定义主题**：两套完整 Monaco 主题（深色/浅色），与应用设计系统一致
9. **Prism.js 代码高亮**：渲染预览中的代码块使用 Prism.js，支持 7+ 编程语言
10. **文档行号检测**：智能检测粘贴内容中的行号前缀并去除，提升编辑体验
11. **源行与渲染层分离**：Monaco 源行保持紧凑默认行高；富文本 widget 纯视觉叠加，不通过 view zone / 动态行高改变布局，保证选区与段间距正确
12. **MD 原文防 blur 清除**：浮动工具栏 `mousedown.preventDefault()` + `data-floating-toolbar`，避免点击「MD原文」时编辑器失焦导致源文视图被清除
