# 编辑主区 (Editor) 功能总结

> 模块编号：04 | 优先级：P0 | 版本：v3.1 | 最后更新：2026-07-21

---

## 1. 功能概述

应用的核心编辑区域，包含目录面板、Monaco 编辑器、浮动工具栏和历史面板。支持 Markdown 编辑、Typora 式富文本排版、目录导航、按需 MD 原文查看、撤销/重做、自动保存等功能。

**v3.0 深度重做：True WYSIWYG 块编辑器（2026-07-18）：**

- 学习 MarkText/Muya 架构，全面替换 ContentWidget 叠加层系统
- 采用 Block Tree 数据模型 + React 块组件 + 按需 Monaco 迷你编辑器
- 彻底解决了 v2.x 所有已知问题（横向溢出、Widget 消失、红色 artifacts 等）
- FloatingToolbar 需要重写以适配新架构

**v3.1 代码块体验优化（2026-07-21）：**

- 代码块头部右上角语言标签由 `Plain Text` 按钮改造为下拉选择器（固定挂载在代码块 header 容器内，不使用页面级浮层/右侧悬浮控件）
- 支持多语言切换：Plain Text、markdown、shell、json、以及多种常见编程语言
- 切换语言时同步回写 Markdown 围栏首行（```language），并触发重新渲染
- 兼容 `Plain Text`（含空格）等不规范语言标识：渲染前统一规范化为 `plaintext`
- 代码块渲染外观升级为浅色“终端窗口”风格：白色背景 + 左上角红/黄/绿三色圆点

**v2.x 历史（精简）：**

- v2.2：修复若干 ContentWidget/代码块渲染问题（已由 v3.0 架构替代）
- v2.1：移除行号、优化富文本显示与「MD原文」切换（旧方案）

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

| 旧架构 (v2.x)                  | 新架构 (v3.0)                             |
| ------------------------------ | ----------------------------------------- |
| Monaco 全文档编辑器            | React Block 组件 + 按需 Monaco 迷你编辑器 |
| ContentWidget 叠加层           | 普通 DOM 流中的 React 组件                |
| 位置型 BlockID (`heading:3-5`) | 稳定 BlockID (`42_a3f2`)                  |
| 全局 decorations 隐藏语法标记  | 内联 Monaco decorations 仅作用于活动块    |
| 滚动 translateY 偏移           | 原生浏览器滚动                            |
| `allowEditorOverflow: true`    | 无需此项                                  |

### 新增文件 (16 个)

| 文件                                           | 作用                                      |
| ---------------------------------------------- | ----------------------------------------- |
| `services/blockTree.ts`                        | Block Tree 数据结构和不可变工具函数       |
| `services/blockTreeBuilder.ts`                 | Markdown 字符串 → BlockTree 解析器        |
| `services/blockTreeSerializer.ts`              | BlockTree → Markdown 字符串序列化         |
| `services/blockController.ts`                  | 块级操作：分割、合并、导航、变换          |
| `services/inlineDecorator.ts`                  | 内联 WYSIWYG 装饰：隐藏语法标记、应用格式 |
| `components/Editor/ActiveBlockEditor.tsx`      | Monaco 迷你编辑器包装器                   |
| `components/Editor/EditorScrollContainer.tsx`  | 可滚动文档视口                            |
| `components/Editor/BlockRenderer.tsx`          | 块类型分发器                              |
| `components/Editor/blocks/HeadingBlock.tsx`    | H1-H6 标题块                              |
| `components/Editor/blocks/ParagraphBlock.tsx`  | 段落块                                    |
| `components/Editor/blocks/ListItemBlock.tsx`   | 无序/有序/任务列表块                      |
| `components/Editor/blocks/CodeFenceBlock.tsx`  | 围栏代码块                                |
| `components/Editor/blocks/TableBlock.tsx`      | 表格块                                    |
| `components/Editor/blocks/BlockquoteBlock.tsx` | 引用块                                    |
| `components/Editor/blocks/EmptyBlock.tsx`      | 点击添加占位符                            |

## 2. 架构位置

- 页面入口：`src/render/pages/MainPage.tsx`
- 编辑主区组件：`src/render/components/Editor/`（`EditorView`、`BlockRenderer`、`ActiveBlockEditor`、`EditorScrollContainer`、`blocks/*`）
- 数据模型与渲染服务：`src/render/services/`（`blockTree*`、`blockController`、`inlineDecorator`、`markdown`）
- 状态：`src/render/stores/`（`editorStore`、`uiStore`、`historyStore`）

## 3. 实现逻辑流程

核心流程（精简）：

- 布局：`OutlinePanel + EditorView (+ FloatingToolbar/HistoryPanel)`
- 编辑：active block 使用 Monaco 迷你编辑器；inactive blocks 由 React 组件渲染
- 渲染：`markdown.ts` 负责 Markdown → HTML（含 GFM、表格包裹、Prism 高亮、特殊语法）
- 目录：从 Markdown AST 提取 H1-H3，点击定位到对应行/块
- 保存：内容变更 → 防抖更新 store → 空闲后自动保存（IPC）
- 撤销/重做：`editorStore` 自管 undo/redo 栈
- v2 legacy：旧 ContentWidget/MD 原文切换仍有遗留代码，但不再是主路径

## 4. 实现细节

实现要点（精简）：

- Monaco：迷你编辑器仅用于 active block（配置与主题见 `monacoSetup`/相关初始化代码）
- 状态：`editorStore` 管理当前文件、内容、脏状态、undo/redo；保存通过 IPC
- Markdown：`markdown.ts` 提供 AST pipeline + 特殊语法（高亮、注释、表格包裹、Prism）

### 4.7 代码高亮（Prism.js）

支持语言（含别名/规范化）：`bash/shell/sh/zsh`, `json`, `jsx`, `markdown/md`, `tsx`, `typescript/ts`, `javascript/js`，并扩展支持 `html/xml/svg`、`css`、`yaml/yml`、`python`、`sql`、`java`。

### 4.8 代码块语言选择器（v3.1）

**目标**：将代码块头部右上角原“Plain Text”语言标签改造成下拉选择器，点击切换语言后同步更新代码块语法标识与高亮。

**结构约束（硬性）**

- 控件必须挂载在代码块 header 容器内，复用原有“右上角语言标签”所在位置
- 禁止把下拉渲染到页面最右侧空白区域（禁止页面级 portal/fixed 悬浮控件）
- 使用原生 `select`（或等价的“非 portal”方案）保证不脱离代码块 DOM 结构

**交互**

- 选择语言后，回写 Markdown 围栏首行：` ```json ` / ` ```shell ` / ` ```plaintext `
- 同步触发 `onContentChange(block.id, nextSourceLines)`，走现有渲染链路重新生成 HTML

**语言规范化**

- `Plain Text` / `plain text` / `text` / `txt` → `plaintext`
- `shell` / `sh` / `zsh` → `bash`（用于 Prism 高亮）

### 4.9 代码块渲染样式（v3.1）

**目标**：Plain Text 渲染态内容必须清晰可见，且代码块整体呈现浅色“终端窗口”视觉（白色背景 + macOS 三色圆点）。

**要点**

- 代码块容器：白底、轻边框、圆角与阴影，形成可识别的“代码窗口”层级
- 头部区域：浅灰背景分隔线 + 左侧三色圆点 + 右侧语言下拉
- 内容区域：白底深色文本，Prism token 颜色适配浅色背景

### 4.10 其他能力（源码入口）

- 自动保存：`MainPage.tsx` + `editorStore.saveFile()`（IPC）
- 文档行号去除：`markdown.ts` 的 `prepareMarkdownForRendering()/stripDocumentLineNumbers()`
- 特殊语法：`==highlight==`、HTML 注释可视化、任务列表、表格包裹

## 5. ContentWidget（v2.x）历史说明

v3.x 已弃用 ContentWidget 叠加层方案（v2.x 方案依赖 `markdownBlockWidgets.ts`/`editorBlockDecorations.ts` 等）。为减少上下文消耗，本节仅保留历史结论：旧方案存在滚动定位、布局溢出、可编辑性等系统性限制，已由 v3 Block Tree + React blocks 取代。

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
