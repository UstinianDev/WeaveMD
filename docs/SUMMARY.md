# WeaveMD 项目总结文档

> 版本：v2.1 | 最后更新：2026-07-08

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

```
┌─────────────────────────────────────────────────┐
│              展示层 (UI Components)               │
│  React 组件库 (Shadcn/ui 风格)                    │
│  页面: AuthPage, MainPage                        │
│  组件: Button, Input, Modal, Dropdown 等         │
├─────────────────────────────────────────────────┤
│            业务逻辑层 (Hooks & Stores)             │
│  Zustand Stores: auth, editor, ui, history       │
│  自定义 Hooks: useAuth, useEditor, useTheme      │
│  事件处理: 快捷键映射、拖拽排序等                   │
├─────────────────────────────────────────────────┤
│            数据访问层 (Services & API)             │
│  IPC 通信 (window.weaveMD.*)                     │
│  本地存储 (localStorage)                          │
│  Markdown 处理 (unified + remark + rehype)       │
├─────────────────────────────────────────────────┤
│             主进程层 (Electron Main)               │
│  窗口管理 (BrowserWindow)                         │
│  数据库操作 (better-sqlite3)                      │
│  IPC 处理器 (ipcMain.handle)                     │
│  文件系统操作 (fs)                                │
│  导出功能 (MD/Word/PDF)                          │
└─────────────────────────────────────────────────┘
```

### 2.2 核心依赖

| 类别          | 依赖                                                | 用途             |
| ------------- | --------------------------------------------------- | ---------------- |
| 前端框架      | react@^18.3.0, react-dom@^18.3.0                    | UI 渲染          |
| 类型系统      | typescript@^5.4.0                                   | 类型安全         |
| 状态管理      | zustand@^4.5.0                                      | 轻量状态管理     |
| 样式          | tailwindcss@^3.4.0, postcss@^8.4.0                  | 原子化 CSS       |
| 编辑器        | @monaco-editor/react@^4.6.0                         | Markdown 编辑    |
| Markdown 处理 | unified, remark-parse, remark-gfm, rehype-stringify | AST 解析与渲染   |
| 代码高亮      | prismjs@^1.29.0                                     | 代码块语法高亮   |
| 数据库        | better-sqlite3@^9.4.0                               | 本地 SQLite 存储 |
| 加密          | bcryptjs@^2.4.3                                     | 密码哈希         |
| JWT           | jsonwebtoken@^9.1.0                                 | 本地 Token 认证  |
| 桌面框架      | electron@latest                                     | 跨平台桌面应用   |
| 构建          | vite@^5.1.0, vite-plugin-electron@^0.28.0           | 开发与构建       |
| 打包          | electron-builder@latest                             | 跨平台打包       |

### 2.3 设计令牌 (Design Tokens)

| Token                | 值                                   | 用途            |
| -------------------- | ------------------------------------ | --------------- |
| `--bg-primary`       | `#0F0F0F`                            | 主背景色        |
| `--bg-secondary`     | `#1A1A1A`                            | 次级背景色      |
| `--border-color`     | `#2D2D2D`                            | 边框色          |
| `--text-primary`     | `#FFFFFF`                            | 主文本色        |
| `--text-sub`         | `#999999`                            | 副文本色        |
| `--accent`           | `#7C3AED`                            | 主强调色 (紫蓝) |
| `--accent-secondary` | `#6366F1`                            | 次强调色 (蓝紫) |
| `--radius-input`     | `8px`                                | 输入框/按钮圆角 |
| `--radius-card`      | `12px`                               | 卡片/面板圆角   |
| 过渡                 | `150ms cubic-bezier(0.4, 0, 0.2, 1)` | 交互过渡        |

---

## 3. 模块文档索引

各功能模块的详细实现文档已拆分至 `docs/modules/` 目录，以下为索引：

| 模块              | 文档                                                                         | 核心内容                                                                                |
| ----------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 加载页面 (Splash) | [modules/01-加载页面-Splash.md](./modules/01-加载页面-Splash.md)             | 启动动画、CSS 动画序列、提前跳转机制                                                    |
| 认证系统          | [modules/02-认证系统-Auth.md](./modules/02-认证系统-Auth.md)                 | 注册/登录流程、JWT 生成、会话恢复、账号切换/删除、交互式吉祥物                          |
| 顶部导航栏        | [modules/03-顶部导航栏-Navbar.md](./modules/03-顶部导航栏-Navbar.md)         | 布局结构、File/Help/History 菜单、窗口控制                                              |
| 编辑主区          | [modules/04-编辑主区-Editor.md](./modules/04-编辑主区-Editor.md)             | 目录面板、Monaco 编辑器、浮动工具栏、自动保存、撤销/重做栈、Markdown 处理管道、块级渲染 |
| 设置界面          | [modules/05-设置界面-Settings.md](./modules/05-设置界面-Settings.md)         | 语言选择、主题切换、自定义主题、账号管理                                                |
| 窗口控制          | [modules/06-窗口控制-Window.md](./modules/06-窗口控制-Window.md)             | frameless 窗口配置、IPC 通道、拖拽区域                                                  |
| 数据持久化层      | [modules/07-数据持久化层-Database.md](./modules/07-数据持久化层-Database.md) | SQLite Schema、WAL 模式、数据隔离、CRUD 操作、文件保存流程                              |
| IPC 通信机制      | [modules/08-IPC通信机制.md](./modules/08-IPC通信机制.md)                     | 安全架构、22 个 IPC 通道、preload API 类型定义                                          |
| 国际化 (i18n)     | [modules/09-国际化-i18n.md](./modules/09-国际化-i18n.md)                     | Provider 模式、翻译键组织、三语言支持                                                   |
| 导出功能          | [modules/10-导出功能-Export.md](./modules/10-导出功能-Export.md)             | MD/Word/PDF 导出实现                                                                    |

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

### 4.5 块级渲染

**决策**：编辑器内对代码块、表格等 Markdown 块进行实时渲染预览。光标进入块时显示源码，离开时显示渲染效果，使用 Monaco Editor 的装饰和小部件 API。

### 4.6 主题系统

**决策**：使用 CSS 变量 + HTML 类名实现多主题切换。5 种预设主题（Light、Dark、Light Header、High Contrast、Custom），主题持久化到 localStorage + 后端数据库。

---

## 5. 项目结构总览

```
weaveMD/
├── src/
│   ├── main/                          # Electron 主进程
│   │   ├── index.ts                   # 主进程入口（单实例锁、初始化）
│   │   ├── window.ts                  # 窗口管理（主窗口、启动画面）
│   │   ├── ipc-handlers.ts            # IPC 处理器（认证、文件、导出等）
│   │   ├── preload.ts                 # 预加载脚本（安全 API 桥接）
│   │   └── db/
│   │       ├── index.ts               # 数据库初始化 + 迁移
│   │       ├── users.ts               # 用户 CRUD
│   │       ├── files.ts               # 文件 CRUD（软删除）
│   │       ├── history.ts             # 历史版本 CRUD
│   │       └── settings.ts            # 设置 CRUD
│   │
│   ├── render/                        # React 前端
│   │   ├── App.tsx                    # 根组件（阶段管理、主题切换）
│   │   ├── main.tsx                   # 渲染进程入口
│   │   ├── pages/
│   │   │   ├── AuthPage.tsx           # 认证页（双栏布局）
│   │   │   └── MainPage.tsx           # 主页面（编辑器布局）
│   │   ├── components/
│   │   │   ├── Auth/                  # 认证组件
│   │   │   │   ├── LoginPage.tsx
│   │   │   │   ├── SignupPage.tsx
│   │   │   │   ├── SplashLoader.tsx
│   │   │   │   ├── InteractiveMascot.tsx
│   │   │   │   └── AuthWindowControls.tsx
│   │   │   ├── Editor/                # 编辑器组件
│   │   │   │   ├── EditorView.tsx
│   │   │   │   ├── OutlinePanel.tsx
│   │   │   │   ├── FloatingToolbar.tsx
│   │   │   │   ├── HistoryPanel.tsx
│   │   │   │   ├── editorBlockDecorations.ts
│   │   │   │   ├── markdownBlockWidgets.ts
│   │   │   │   └── markdownBlockRenderer.ts
│   │   │   ├── Navbar/                # 导航栏组件
│   │   │   │   ├── TopBar.tsx
│   │   │   │   ├── FileMenu.tsx
│   │   │   │   ├── MoreMenu.tsx
│   │   │   │   └── HistoryMenu.tsx
│   │   │   ├── Settings/              # 设置组件
│   │   │   │   ├── SettingsModal.tsx
│   │   │   │   ├── ThemeSelector.tsx
│   │   │   │   └── AccountManager.tsx
│   │   │   └── Common/                # 通用组件
│   │   │       ├── Button.tsx
│   │   │       ├── Input.tsx
│   │   │       ├── Modal.tsx
│   │   │       ├── Dropdown.tsx
│   │   │       └── StatusBar.tsx
│   │   ├── stores/                    # Zustand 状态管理
│   │   │   ├── authStore.ts
│   │   │   ├── editorStore.ts
│   │   │   ├── uiStore.ts
│   │   │   └── historyStore.ts
│   │   ├── services/                  # 业务服务
│   │   │   ├── markdown.ts
│   │   │   ├── markdownBlockDetector.ts
│   │   │   ├── storage.ts
│   │   │   ├── export.ts
│   │   │   └── api.ts
│   │   ├── hooks/                     # 自定义 Hooks
│   │   │   ├── useAuth.ts
│   │   │   ├── useEditor.ts
│   │   │   └── useTheme.ts
│   │   ├── i18n/                      # 国际化
│   │   │   ├── index.tsx
│   │   │   ├── en.json
│   │   │   ├── zh-CN.json
│   │   │   └── zh-TW.json
│   │   ├── styles/
│   │   │   └── globals.css            # 全局样式 + 主题变量
│   │   └── utils/
│   │       ├── crypto.ts              # 加密工具
│   │       ├── validators.ts          # 验证工具
│   │       ├── helpers.ts             # 辅助函数
│   │       ├── monacoSetup.ts         # Monaco 配置
│   │       └── weaveMDBridge.ts       # API 桥接
│   │
│   └── shared/                        # 共享代码
│       ├── types.ts                   # TypeScript 类型定义
│       └── constants.ts               # 常量（IPC 通道、验证规则等）
│
├── tests/                             # 测试
│   ├── setup.ts
│   ├── components/
│   ├── db/
│   ├── services/
│   ├── stores/
│   └── utils/
│
├── docs/                              # 文档
│   ├── ARCHITECTURE.md
│   ├── DATABASE.md
│   ├── FRONTEND.md
│   ├── SECURITY.md
│   ├── WORKFLOW.md
│   ├── SUMMARY.md
│   └── modules/                       # 各模块详细文档
│       ├── README.md
│       ├── 01-加载页面-Splash.md
│       ├── 02-认证系统-Auth.md
│       ├── 03-顶部导航栏-Navbar.md
│       ├── 04-编辑主区-Editor.md
│       ├── 05-设置界面-Settings.md
│       ├── 06-窗口控制-Window.md
│       ├── 07-数据持久化层-Database.md
│       ├── 08-IPC通信机制.md
│       ├── 09-国际化-i18n.md
│       └── 10-导出功能-Export.md
│
├── public/icons/                      # 应用图标
├── electron-builder.yml               # 打包配置
├── vite.config.ts                     # Vite 配置
├── vitest.config.ts                   # 测试配置
├── tsconfig.json                      # TypeScript 配置
├── tailwind.config.ts                 # TailwindCSS 配置
├── postcss.config.js                  # PostCSS 配置
├── package.json                       # 依赖管理
├── .eslintrc.cjs                      # ESLint 配置
└── .prettierrc                        # Prettier 配置
```

---

> 本文档为 WeaveMD 项目概要总结，各模块详细实现请参阅 `docs/modules/` 目录下的对应文档。
> 基于 WeaveMD v2.1 需求文档、技术选型文档及源码综合分析生成。
