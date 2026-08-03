# WeaveMD 项目总结文档

> 版本：v3.0 | 最后更新：2026-08-03

---

## 目录

1. [项目概览](#1-项目概览)
2. [技术栈架构](#2-技术栈架构)
3. [模块文档索引](#3-模块文档索引)
4. [关键设计决策](#4-关键设计决策)
5. [项目结构总览](#5-项目结构总览)

---

## 1. 项目概览

**WeaveMD** 是一款基于 Electron 的本地 Markdown 可视化笔记桌面应用，面向知识工作者、开发者和内容创作者。核心定位是**离线优先、本地存储、多账号隔离**的 Markdown 编辑器。

| 属性     | 值                                   |
| -------- | ------------------------------------ |
| 项目名称 | WeaveMD                              |
| 目标平台 | Windows / macOS / Linux              |
| 桌面框架 | Electron (最新稳定版)                |
| 前端框架 | React 18 + TypeScript                |
| 构建工具 | Vite 5 + vite-plugin-electron        |
| 打包工具 | Electron Builder                     |
| 设计风格 | 深色现代体系 + 几何插图风格          |
| 数据存储 | SQLite (better-sqlite3)              |
| 状态管理 | Zustand v4                           |
| 编辑器   | Monaco Editor (@monaco-editor/react) |

---

## 2. 技术栈架构

### 2.1 整体架构分层

- UI：React 页面与组件（AuthPage/MainPage + Editor/Navbar/Settings）
- 状态与业务：Zustand stores + hooks（auth/editor/ui/history）
- 渲染与服务：Markdown pipeline（unified/remark/rehype）+ Prism 高亮 + IPC bridge
- 主进程：Electron window + SQLite（better-sqlite3）+ IPC handlers + 导出

### 2.2 核心依赖

| 类别     | 依赖                      | 用途              |
| -------- | ------------------------- | ----------------- |
| 桌面框架 | Electron                  | 跨平台桌面应用    |
| 前端框架 | React 18 + TypeScript     | UI 渲染与类型安全 |
| 状态管理 | Zustand                   | 编辑/认证等状态   |
| 样式     | TailwindCSS + Shadcn/ui   | 主题与组件风格    |
| 编辑器   | Monaco                    | 主编辑体验        |
| Markdown | unified + remark + rehype | 解析/渲染管线     |
| 代码高亮 | Prism.js                  | 代码块高亮        |
| 数据存储 | SQLite（better-sqlite3）  | 本地离线存储      |

### 2.3 设计令牌 (Design Tokens)

| Token                | 值                                   | 用途                             |
| -------------------- | ------------------------------------ | -------------------------------- |
| `--bg-primary`       | `#0F0F0F`                            | 主背景色                         |
| `--bg-secondary`     | `#1A1A1A`                            | 次级背景色                       |
| `--border-color`     | `#2D2D2D`                            | 边框色                           |
| `--text-primary`     | `#FFFFFF`                            | 主文本色                         |
| `--text-sub`         | `#999999`                            | 副文本色                         |
| `--accent`           | `#7C3AED`                            | 主强调色 (紫蓝)                  |
| `--accent-secondary` | `#6366F1`                            | 次强调色 (蓝紫)                  |
| `--radius-input`     | `8px`                                | 输入框/按钮圆角                  |
| `--radius-card`      | `12px`                               | 卡片/面板圆角                    |
| `--bg-code`          | `#1E1E2E`                            | 代码块语义底色（暗色主题变量）   |
| `--text-code`        | `#CDD6F4`                            | 代码块语义文字色（暗色主题变量） |
| 过渡                 | `150ms cubic-bezier(0.4, 0, 0.2, 1)` | 交互过渡                         |

---

## 3. 模块文档索引

各功能模块的详细实现文档已拆分至 `docs/modules/` 目录，以下为索引：

| 模块              | 文档                                                                         | 核心内容                                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 加载页面 (Splash) | [modules/01-加载页面-Splash.md](./modules/01-加载页面-Splash.md)             | 启动动画、CSS 动画序列、提前跳转机制                                                                                                                                                                     |
| 认证系统          | [modules/02-认证系统-Auth.md](./modules/02-认证系统-Auth.md)                 | 注册/登录流程、JWT 生成、会话恢复、账号切换/删除、交互式吉祥物                                                                                                                                           |
| 顶部导航栏        | [modules/03-顶部导航栏-Navbar.md](./modules/03-顶部导航栏-Navbar.md)         | 布局结构、File/Help/History/View 菜单、CreateDialog 弹窗（新建文件/文件夹）、删除文件夹从侧栏选中项、文件系统同步                                                                                        |
| 编辑主区          | [modules/04-编辑主区-Editor.md](./modules/04-编辑主区-Editor.md)             | 双模式架构、Block Tree、浮动工具栏、文件系统实时同步、文件删除空状态、侧边栏Tab切换（目录/文件）、文件树累积展示、Minimap、FindReplaceBar、目录导航+动态高亮、可拖拽目录/历史面板宽度、自动保存/撤销重做 |
| 设置界面          | [modules/05-设置界面-Settings.md](./modules/05-设置界面-Settings.md)         | 语言选择、主题切换、自定义主题、账号管理                                                                                                                                                                 |
| 窗口控制          | [modules/06-窗口控制-Window.md](./modules/06-窗口控制-Window.md)             | frameless 窗口配置、IPC 通道、拖拽区域                                                                                                                                                                   |
| 数据持久化层      | [modules/07-数据持久化层-Database.md](./modules/07-数据持久化层-Database.md) | SQLite Schema、WAL 模式、数据隔离、CRUD 操作、文件保存流程                                                                                                                                               |
| IPC 通信机制      | [modules/08-IPC通信机制.md](./modules/08-IPC通信机制.md)                     | 安全架构、30+ 个 IPC 通道（含文件系统直操作）、preload API 类型定义                                                                                                                                      |
| 国际化 (i18n)     | [modules/09-国际化-i18n.md](./modules/09-国际化-i18n.md)                     | Provider 模式、翻译键组织、三语言支持                                                                                                                                                                    |
| 导出功能          | [modules/10-导出功能-Export.md](./modules/10-导出功能-Export.md)             | MD/Word/PDF 导出实现                                                                                                                                                                                     |

---

## 4. 关键设计决策

### 4.1 纯本地认证

**决策**：使用本地 SQLite + bcryptjs + JWT 实现认证，无需后端服务。

**理由**：完全离线可用、快速开发无需部署后端、一人多账号数据完全隔离。

**后续升级**：可扩展为本地优先 + 可选云同步（OAuth 集成、云端备份）

### 4.2 多账号支持

**决策**：同一用户可创建多个账号，避免单账号笔记堆积。每个账号独立存储、通过 `user_id` 完全隔离，切换时清除旧 Token + 加载新账号数据。

### 4.3 自动保存

**决策**：内容变化 1200ms 后自动保存，关闭窗口时通过 `before-quit` 事件触发保存，切换文件时先保存当前文件。

### 4.4 软删除

**决策**：文件使用软删除（`deleted_at` 字段），便于恢复。

### 4.5 双模式编辑器

**决策**：编辑器 v4 双模式架构。

- **Normal Mode**：Block Tree → 容器级 `contentEditable`（`editor-content-area` div）。支持直接编辑、Enter/Backspace 块操作、Ctrl+Z/Y 撤销重做、Canvas Minimap；浮动工具栏（选中文本时显示）使用 `document.execCommand` + `Range API` 直接操作 DOM，格式化 Toggle：Bold/Italic/Underline/Strikethrough/Highlight/InlineCode/Link/Comment/MD Source。空块使用零宽空格 `\u200B` + CSS `::before` 占位。浮动工具栏与 Navbar 全接入 i18n。
- **Source Code Mode**：全屏 Monaco 编辑原始 markdown（`Ctrl+\`` 或 View 切换）；代码块通过此模式编辑（双击禁用，防止 `#` 被误检测为标题）。
- **Find & Replace**：Typora 风格 inline bar，双模式通用。
- **核心字段**：`BlockNode.startLine`（1-based，目录导航映射）、`renderedHtml`（缓存 DOM HTML，重渲染恢复富文本）。
- **列表块**：`resolveNextTypeFromSource` 基于 `detectMarkdownLine` 做 heading/task/ordered/unordered 前缀识别；`ListItemBlock.getVisibleText` 正则按 task > ordered > unordered 顺序剥离，避免 `- [ ] ` 残留 `[ ]`。
- **性能**：滚动 padding 移至内层；`version` 仅在内容/结构变更时自增（`setBlockRenderedHtml` 不自增）；`lastBuiltContentRef` 跳过挂载冗余重建。

**目录导航与高亮**：

- Normal Mode：`startLine` → `scrollToBlock`；`detectActiveHeading` 取视口顶部 + 10px 检测
- Source Code Mode：`lineNumber` → `scrollToLine`；`getNearestHeadingLineNumber` → headingIndex

### 4.6 主题系统

**决策**：使用 CSS 变量 + HTML 类名实现多主题切换。5 种预设主题（Light、Dark、Light Header、High Contrast、Custom），主题持久化到 localStorage + 后端数据库。

### 4.7 超链接交互

**决策**：浮动工具栏 Link 按钮点击后隐藏工具栏开 Modal（防遮挡）；Modal 移出 `!isVisible` 守卫始终渲染（修复点 Link 后工具栏永久消失）。edit 模式含"移除链接"按钮（unwrap `<a>` 保留文本）。Ctrl/Cmd+click 经 IPC `LINK_OPEN_EXTERNAL` → `shell.openExternal`；`will-navigate` + `setWindowOpenHandler` 阻止窗口内导航。hover 蓝色 tooltip（`a.inline-link:hover::after` + `--link-tip`，i18n `toolbar.linkTip`）。

**链接 WYSIWYG 保留（v2.9.6 修复）**：`wrapRangeWithTag` 包裹前将 range 钳制到 `span.block-content` 内（防跨装饰 span 边界触发 surroundContents 异常→extractContents 分裂 marker 致双复选框）；`buildSourceLinesFromContent` + `getBlockRenderedHtml` list-item 分支改为克隆 blockEl 后移除装饰节点（marker/checkbox/bullet）再走 `domToMarkdown`（能看见祖先级 `<a>`）；包裹后清理 el 内嵌套同标签元素 + 空 `<a>` 兄弟（extractContents 残留）。

### 4.8 文件系统同步

**决策**：editorStore.saveFile 对路径型 ID 直接写磁盘（`file:write`）；handleOpenFile 用磁盘路径作 file ID；垃圾箱仅清列表不同步删除磁盘；删除文件夹从侧栏选中项获取（`getSelectedFolder`，非文件夹提示）；CreateDialog 弹窗选位置+填名称创建文件/文件夹。

---

## 5. 项目结构总览

- `src/main/`：Electron 主进程（窗口、IPC handlers、SQLite）
- `src/render/`：React 前端（页面、Editor 组件、stores、services、styles）
  - `src/render/components/Common/CreateDialog.tsx`：新建文件/文件夹弹窗
- `src/shared/`：共享 types/constants
- `docs/`：设计与模块文档（入口见 `.claude/CLAUDE.md`）
- `tests/`：Vitest 测试

---

> 本文档为 WeaveMD 项目概要总结，各模块详细实现请参阅 `docs/modules/` 目录下的对应文档。
> 基于项目需求文档、技术选型文档及源码综合分析生成。
