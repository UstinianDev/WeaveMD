# 编辑主区 (Editor) 功能总结

> 模块编号：04 | 优先级：P0 | 最后更新：2026-07-08

---

## 1. 功能概述

应用的核心编辑区域，包含目录面板、Monaco 编辑器、浮动工具栏和历史面板。支持 Markdown 编辑、实时预览、目录导航、块级渲染、撤销/重做、自动保存等功能。

## 2. 架构位置

```
src/render/pages/MainPage.tsx                          # 主页面布局
src/render/components/Editor/
├── EditorView.tsx                                     # Monaco 编辑器封装 (504行)
├── OutlinePanel.tsx                                   # 目录面板
├── FloatingToolbar.tsx                                # 浮动工具栏
├── HistoryPanel.tsx                                   # 历史面板
├── editorBlockDecorations.ts                          # 编辑器块装饰
├── markdownBlockWidgets.ts                            # Markdown 块小部件
└── markdownBlockRenderer.ts                           # Markdown 块渲染器
src/render/services/
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
│  目录树        │    Markdown 编辑 + 块级渲染                  │
│  H1/H2/H3      │    行号 / 代码高亮 / 自动缩进               │
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

### 3.6 块级渲染流程

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
  fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
  lineNumbers: 'on',
  minimap: { enabled: false },
  wordWrap: 'on',
  automaticLayout: true,
  readOnly: false,
  padding: { top: 16, bottom: 16 },
  scrollBeyondLastLine: false,
  renderLineHighlight: 'line',
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: 'on',
  smoothScrolling: true,
  bracketPairColorization: { enabled: true },
  guides: { indentation: false },
  tabSize: 2,
  insertSpaces: true,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  overviewRulerLanes: 0,
  scrollbar: {
    verticalScrollbarSize: 6,
    horizontalScrollbarSize: 6,
  },
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

选中文本时在正上方 2px 处显示，包含 10 个按钮：

| #   | 按钮     | 功能                                                  | 实现方式                          |
| --- | -------- | ----------------------------------------------------- | --------------------------------- |
| 1   | 结构 Θ   | 下拉选择 Text/H1/H2/H3/List/Task/Code/Quote/Highlight | 替换选中文本格式                  |
| 2   | 位置     | 左对齐/居中/右对齐/缩进+/-                            | 添加对齐标记                      |
| 3   | 粗体 B   | **粗体**                                              | 包裹 `**text**`                   |
| 4   | 斜体 I   | _斜体_                                                | 包裹 `*text*`                     |
| 5   | 下划线 U | <u>下划线</u>                                         | 包裹 `<u>text</u>`                |
| 6   | 代码 <>  | `行内代码`                                            | 包裹 `` `text` ``                 |
| 7   | 颜色 🎨  | 字体色/背景色                                         | 插入颜色标记                      |
| 8   | 链接 🔗  | 超链接                                                | 插入 `[text](url)`                |
| 9   | 复制 📋  | 复制选中文本                                          | `navigator.clipboard.writeText()` |
| 10  | 评论 💬  | 插入注释                                              | 包裹 `<!-- text -->`              |

**样式：**

```css
.floating-toolbar {
  background: rgba(26, 26, 26, 0.95);
  border: 1px solid #2d2d2d;
  border-radius: 8px;
  position: absolute;
  top: -2px; /* 选中文本正上方 2px */
  animation: toolbar-enter 150ms ease;
}
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

## 5. 与其他模块的交互

| 模块       | 交互方式                                                     |
| ---------- | ------------------------------------------------------------ |
| 导航栏     | 通过 `editorStore` 提供撤销/重做状态；文件操作触发编辑器变化 |
| 认证系统   | 切换账号时 `editorStore.closeFile()` 清空编辑器状态          |
| 数据持久化 | `saveFile()` 通过 IPC 保存文件内容及历史版本                 |
| 设置       | 主题变化时切换 Monaco Editor 主题                            |
| 导出       | 导出当前编辑器内容为 MD/Word/PDF                             |

## 6. 关键设计决策

1. **Monaco Editor**：选择 VS Code 同源的编辑器，功能完善、大文件处理优秀
2. **自定义撤销/重做栈**：与 Monaco 内置撤销分离，实现跨会话的撤销历史（最多 50 条）
3. **双层防抖**：300ms 防抖更新 Store + 1200ms 防抖自动保存，平衡实时性和性能
4. **块级渲染**：代码块、表格等实时渲染预览，提升 Markdown 可视化体验
5. **自定义主题**：两套完整 Monaco 主题（深色/浅色），与应用设计系统一致
6. **Prism.js 代码高亮**：渲染预览中的代码块使用 Prism.js，支持 7+ 编程语言
7. **文档行号检测**：智能检测粘贴内容中的行号前缀并去除，提升编辑体验
