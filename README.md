<p align="center">
  <img src="public/icons/icon.png" width="100" alt="WeaveMD Logo">
</p>

<h1 align="center">WeaveMD</h1>

<p align="center">
  <strong>本地优先的 Markdown 可视化笔记桌面应用</strong>
</p>

<p align="center">
  离线存储 · 多账号隔离 · 所见即所得 · AI 代理辅助
</p>

---

## 简介

WeaveMD 是一款基于 Electron 的本地 Markdown 笔记应用，所有数据存储在本地 SQLite 数据库中，不依赖任何云服务。支持所见即所得（WYSIWYG）和源码双模式编辑，内置 AI 代理可辅助写作、检索知识库、管理文件。

## 功能模块

### 编辑器

- **双模式编辑**：Normal 模式（块树 WYSIWYG）+ Source Code 模式（Monaco 编辑器），`Ctrl+`` 一键切换
- **块树内核**：自研不可变块树架构，纯函数操作，支持无损 Markdown 双向转换
- **前缀即时转换**：输入 `# `、`- `、`1. `、`- [ ] `、`> `、` ```lang ` 自动转换为对应块类型
- **浮动工具栏**：选区触发，支持加粗、斜体、删除线、高亮、行内代码、链接、图片、数学公式、表格
- **可编辑表格**：每格独立编辑，支持增删行列、对齐、Markdown 往返
- **图片编辑**：工具栏直选文件插入，`media://` 本地图协议，四角等比缩放，独立图片工具栏
- **跨块拖选**：支持跨段落/标题拖选，字符输入/粘贴自动替换选区
- **撤销/重做**：`Ctrl+Z` / `Ctrl+Y`，50 条历史

### AI 代理

- **Agent 模式**：基于远程 OpenAI 兼容 API，支持多轮对话、工具调用（≤12 轮自动收敛）
- **18+ 内置工具**：文件读写、知识库检索、联网搜索、目录分析、链接检查等
- **知识库**：FTS5 全文检索 + jieba 中文分词 + RRF 混合检索融合 + 条件重排
- **写控制**：auto/manual 两种写入模式，manual 模式下 AI 改写需用户确认（红删绿增预览）
- **交互暂停**：AI 遇到信息不足时主动提问，用户回答后自动恢复执行
- **任务队列**：持久化 SQLite 队列，同会话串行，支持断线恢复和文件回滚

### 文件管理

- **多账号隔离**：每个账号独立的文件空间，bcryptjs 密码加密，JWT 会话管理
- **文件树**：新建、重命名、移动、删除（软删除），支持文件夹组织
- **导出**：支持 Markdown、HTML、PDF、DOC、DOCX、PNG、JPG、JPEG 共 8 种格式
- **自动保存**：1200ms 防抖自动保存，切换/关闭前强制 flush

### 界面

- **深色主题**：Default（明亮）+ Warm Earth（暖色陶土）两套主题
- **国际化**：中文简体、中文繁体、English 三语言
- **无边框窗口**：自定义标题栏，支持最小化/最大化/关闭
- **自动更新**：内置 electron-updater，启动时自动检查 GitHub Releases 新版本

## 下载安装

前往 [GitHub Releases](https://github.com/UstinianDev/WeaveMD/releases) 下载最新版本：

| 平台 | 文件 | 说明 |
|------|------|------|
| Windows | `WeaveMD Setup x.x.x.exe` | NSIS 安装包，双击运行 |
| macOS | `WeaveMD-x.x.x.dmg` | DMG 镜像，拖入 Applications |

### Windows 安装

1. 下载 `.exe` 安装包
2. 双击运行，如遇「未知发布者」警告，点击「仍要运行」
3. 按向导完成安装

### macOS 安装

1. 下载 `.dmg` 文件
2. 打开后将 WeaveMD 拖入 Applications 文件夹
3. 首次打开如遇安全提示，右键 → 打开，或在「系统设置 → 隐私与安全性」中允许

### 自动更新

应用启动后会自动检查新版本。也可手动检查：顶部菜单 → 帮助 → 检查更新。

## 技术栈

| 类别 | 技术 |
|------|------|
| 桌面框架 | Electron 31 + Vite 5 |
| 前端 | React 18 + TypeScript + TailwindCSS |
| 状态管理 | Zustand v4 |
| 数据存储 | SQLite（better-sqlite3，FTS5 全文检索） |
| 编辑器 | 自研块树内核 + Monaco Editor |
| AI | OpenAI 兼容 API + jieba-wasm 分词 |
| 测试 | Vitest + Playwright |

## 开发

```bash
# 克隆仓库
git clone https://github.com/UstinianDev/WeaveMD.git
cd WeaveMD

# 安装依赖
npm install

# 开发模式（Vite + Electron HMR）
npm run dev

# 构建安装包
npm run build
```

### 命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式（HMR） |
| `npm run build` | 构建安装包 |
| `npm run test` | 单元测试 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint 代码检查 |
| `npx playwright test` | E2E 测试 |

## 目录结构

```
src/
├── main/                  # Electron 主进程
│   ├── ai/                # AI 服务（LLM 客户端、Agent 循环、知识库、工具）
│   ├── db/                # SQLite 数据访问层
│   └── update.ts          # 自动更新
├── render/                # React 渲染进程
│   ├── editor/            # 编辑器内核（块树、控制器）
│   ├── components/        # UI 组件
│   │   ├── Editor/        # 编辑器组件（v2、工具栏、图片缩放）
│   │   ├── AIAgent/       # AI 面板（消息流、设置、工作流）
│   │   ├── Auth/          # 认证页面
│   │   ├── Navbar/        # 顶部导航栏
│   │   └── Settings/      # 设置界面
│   ├── stores/            # Zustand 状态管理
│   └── services/          # 业务逻辑
└── shared/                # 跨进程共享类型和常量
```

## 许可证

MIT
