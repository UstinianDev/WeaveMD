# WeaveMD

## 项目简介

WeaveMD 是基于 Electron 的本地 Markdown 可视化笔记应用。核心定位：**离线优先、本地存储、多账号隔离**的所见即所得 Markdown 编辑器，面向知识工作者、开发者和内容创作者。

## 技术栈

| 类别 | 技术 |
|------|------|
| 桌面框架 | Electron + Vite + Electron Builder |
| 前端 | React 18 + TypeScript + Tailwind |
| 状态管理 | Zustand v4 |
| 数据存储 | SQLite（better-sqlite3） |
| 编辑器 | 自研块树内核（v2，照搬 marktext/muya 架构）+ Monaco（Source 模式） |
| 测试 | Vitest + Playwright（真实 Chromium E2E） |

## 目录结构

```
src/
├── main/                  # Electron 主进程
│   ├── ai/                # AI 服务（llmClient / kbIndexer / kbSearch / agentLoop 等）
│   └── db/                # SQLite 数据访问层
├── render/                # React 前端
│   ├── editor/            # 编辑内核（v2，React-free）
│   │   ├── kernel/        # 块树、双向转换、行内渲染、选区
│   │   └── controllers/   # 七类交互控制器
│   ├── components/        # UI 组件（Auth / Editor / Navbar / Settings / AIAgent）
│   ├── stores/            # Zustand 状态管理
│   └── services/          # 业务逻辑（markdown、搜索、保存）
└── shared/                # 跨进程共享类型和常量

docs/                      # 项目文档（需求、技术选型、模块、规格、测试）
tests/                     # Vitest 单元/组件测试
e2e/                       # Playwright 真实 Chromium E2E
```

## 如何运行

```bash
# 安装依赖
npm install

# 开发模式（Vite + Electron HMR）
npm run dev

# 构建
npm run build
```

## 开发命令

| 命令 | 用途 |
|------|------|
| `npm run dev` | Vite + Electron 开发模式（HMR） |
| `npm run build` | Vite build + electron-builder 打包 |
| `npm run test` | Vitest 单元测试 |
| `npm run typecheck` | TypeScript 类型检查（tsc --noEmit） |
| `npm run lint` | ESLint 代码检查 |
| `npx playwright test` | Playwright E2E 测试 |

## 质量门禁

`tsc --noEmit` + `vitest run` + ESLint(0 error) + `vite build` + `npx playwright test` 全绿才算完成。

## 项目文档

- [SUMMARY](./SUMMARY.md) — 项目总结与模块索引
- [REQUIREMENTS](./REQUIREMENTS.md) — 功能需求文档
- [TECH_STACK](./TECH_STACK.md) — 技术选型文档
- [modules/](./modules/) — 各模块详细文档
- [specs/](./specs/) — 编辑主区 v2 规格与实施记录
- [testing/](./testing/) — TDD 测试报告
