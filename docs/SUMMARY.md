# WeaveMD 项目总结文档

> 版本：v2.5.0 | 最后更新：2026-07-25

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

| 模块              | 文档                                                                         | 核心内容                                                                                            |
| ----------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 加载页面 (Splash) | [modules/01-加载页面-Splash.md](./modules/01-加载页面-Splash.md)             | 启动动画、CSS 动画序列、提前跳转机制                                                                |
| 认证系统          | [modules/02-认证系统-Auth.md](./modules/02-认证系统-Auth.md)                 | 注册/登录流程、JWT 生成、会话恢复、账号切换/删除、交互式吉祥物                                      |
| 顶部导航栏        | [modules/03-顶部导航栏-Navbar.md](./modules/03-顶部导航栏-Navbar.md)         | 布局结构、File/Help/History/View 菜单、Find & Replace inline bar、窗口控制 |
| 编辑主区          | [modules/04-编辑主区-Editor.md](./modules/04-编辑主区-Editor.md)             | 双模式架构（WYSIWYG 可编辑富文本 + 全屏 Monaco 源码）、Block Tree、浮动工具栏、跨块选择、代码块双击编辑、Minimap、FindReplaceBar、自动保存/撤销重做 |
| 设置界面          | [modules/05-设置界面-Settings.md](./modules/05-设置界面-Settings.md)         | 语言选择、主题切换、自定义主题、账号管理                                                            |
| 窗口控制          | [modules/06-窗口控制-Window.md](./modules/06-窗口控制-Window.md)             | frameless 窗口配置、IPC 通道、拖拽区域                                                              |
| 数据持久化层      | [modules/07-数据持久化层-Database.md](./modules/07-数据持久化层-Database.md) | SQLite Schema、WAL 模式、数据隔离、CRUD 操作、文件保存流程                                          |
| IPC 通信机制      | [modules/08-IPC通信机制.md](./modules/08-IPC通信机制.md)                     | 安全架构、22 个 IPC 通道、preload API 类型定义                                                      |
| 国际化 (i18n)     | [modules/09-国际化-i18n.md](./modules/09-国际化-i18n.md)                     | Provider 模式、翻译键组织、三语言支持                                                               |
| 导出功能          | [modules/10-导出功能-Export.md](./modules/10-导出功能-Export.md)             | MD/Word/PDF 导出实现                                                                                |

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

**决策**：编辑器采用双模式架构（v3.x）：**Normal Mode** — Block Tree 渲染为只读富文本块，无点击编辑，右侧 Canvas Minimap 显示文档缩影（viewport 指示器 + 点击导航）；**Source Code Mode** — 全屏 Monaco 编辑器编辑原始 markdown（`Ctrl+`` 或 View 菜单切换）。Find & Replace 为 Typora 风格 inline bar（`FindReplaceBar`），两种模式均可使用。状态通过 `uiStore`（`isSourceCodeMode`、`isFindReplaceOpen`）跨组件共享。

### 4.6 主题系统

**决策**：使用 CSS 变量 + HTML 类名实现多主题切换。5 种预设主题（Light、Dark、Light Header、High Contrast、Custom），主题持久化到 localStorage + 后端数据库。

---

## 5. 项目结构总览

- `src/main/`：Electron 主进程（窗口、IPC handlers、SQLite）
- `src/render/`：React 前端（页面、Editor 组件、stores、services、styles）
- `src/shared/`：共享 types/constants
- `docs/`：设计与模块文档（入口见 `.claude/CLAUDE.md`）
- `tests/`：Vitest 测试

---

> 本文档为 WeaveMD 项目概要总结，各模块详细实现请参阅 `docs/modules/` 目录下的对应文档。
> 基于项目需求文档、技术选型文档及源码综合分析生成。
