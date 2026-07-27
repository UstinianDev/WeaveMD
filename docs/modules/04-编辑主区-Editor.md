# 编辑主区 (Editor) 功能总结

> 模块编号：04 | 优先级：P0 | 版本：v4.0 | 最后更新：2026-07-26

---

## 1. 功能概述

核心编辑区域，采用**双模式架构**：

- **Normal Mode**：Block Tree → WYSIWYG 可编辑富文本块，支持直接编辑段落/标题、回车创建段落、Backspace 删除空段落、Ctrl+Z/Y 撤销重做，右侧 Canvas Minimap（文档缩影）、浮动工具栏（选中文本时显示）、跨块文本选择、代码块双击编辑
- **Source Code Mode**：全屏 Monaco 编辑器，编辑原始 markdown（`Ctrl+\`` 或 View 菜单切换）
- **Find & Replace**：Typora 风格 inline bar，两种模式均可用（`Ctrl+F`）

## 2. 核心数据模型：Block Tree

```
BlockTree = { rootBlockIds: BlockId[], blocks: Record<BlockId, BlockNode>, version: number }
BlockNode = {
  id: BlockId, type: BlockType, sourceLines: string[],
  headingLevel?, fenceLanguage?, parentId, childrenIds,
  renderedHtml: string | null  // 缓存渲染 HTML
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

- `EditorView.tsx` — 主容器：双模式切换、Monaco 主题、全局快捷键、scroll 追踪
- `EditorScrollContainer.tsx` — 可滚动视口（forwardRef），渲染可编辑块组件
- `BlockRenderer.tsx` — 块类型分发器（支持 contentEditable 回调）
- `SourceCodeEditor.tsx` — 全屏 Monaco 编辑器（150ms debounce 写 store）
- `FindReplaceBar.tsx` — Typora 风格 inline 查找替换栏
- `Minimap.tsx` — Canvas 文档缩影（viewport 指示器 + 点击导航）
- `blocks/` — 块组件：Heading（可编辑）、Paragraph（可编辑）、ListItem、CodeFence、Table、Blockquote、Empty
- `OutlinePanel.tsx` — 文档大纲（从 AST 提取 H1-H3）
- `ActiveBlockEditor.tsx` —（已废弃）Monaco 迷你编辑器
- `FindReplaceModal.tsx` —（已废弃）旧居中模态框

## 4. 数据流

### Normal Mode

```
editorStore.content → buildBlockTree → renderMarkdownToHtml(per block)
  → BlockRenderer → 可编辑 block 组件 (contentEditable) → DOM
  → 用户编辑/回车/删除 → handleBlockContentChange/handleBlockEnter/handleBlockDelete
  → pushUndo → syncTreeToStore → editorStore.updateContent()
```

### Source Code Mode

```
SourceCodeEditor (Monaco) → 150ms debounce → editorStore.updateContent()
  → 切回 Normal Mode 时: buildBlockTree(latestContent) → 重建 blockTree
```

### Find & Replace

```
FindReplaceBar → searchEngine.findAllMatches(content) → 匹配高亮
  → replaceAll → editorStore.updateContent() → content useEffect → rebuild blockTree
```

## 5. 关键特性

| 特性           | 详情                                                                          |
| -------------- | ----------------------------------------------------------------------------- |
| **双模式**     | Normal（WYSIWYG 可编辑富文本 + Minimap）/ Source Code（全屏 Monaco）           |
| **Minimap**    | 64px Canvas，块类型颜色编码，viewport 指示器，点击导航                        |
| **标题字号**   | H1=26/700、H2=22/600、H3=18/600、H4=16/500、P=14/400                          |
| **代码块语言** | `<select>` 下拉选择；语言别名归一化（`sh`→`shell`、`Plain Text`→`plaintext`）  |
| **代码块编辑** | 双击进入 textarea 编辑模式，失焦保存                                          |
| **浮动工具栏** | 选中文本时显示；包含格式化、结构转换、超链接、评论、MD 源码显示                |
| **跨块选择**   | contentEditable 移至父容器，支持跨段落/标题选择                                |
| **自动保存**   | 1200ms debounce；关闭/切换文件前 flush                                        |
| **撤销/重做**  | 自定义栈，50 条上限，跨会话保留；段落增删手动 pushUndo                         |
| **光标跳转**   | 按 Enter 创建新段落后，光标自动跳转到新段落开头                                |
| **IME 兼容**   | isComposing 守卫；inline bar 无 DOM 挂载/卸载                                 |
| **快捷键**     | Ctrl+S 保存、Ctrl+Z/Y 撤销/重做、Ctrl+F 查找、Ctrl+` 源码模式                 |

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
