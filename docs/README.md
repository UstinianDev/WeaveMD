# WeaveMD

## 项目简介

WeaveMD 是基于 Electron 的本地 Markdown 可视化笔记应用。核心定位：**离线优先、本地存储、多账号隔离**的所见即所得 Markdown 编辑器，面向知识工作者、开发者和内容创作者。

## 技术栈

| 类别 | 技术 |
|------|------|
| 桌面框架 | Electron ^31 + Vite ^5 + Electron Builder |
| 前端 | React 18 + TypeScript ^5.4 + TailwindCSS ^3.4（自定义色板，非默认色） |
| 状态管理 | Zustand v4 |
| 数据存储 | SQLite（better-sqlite3 ^11，FTS5 全文检索） |
| 编辑器 | 自研块树内核（v2，照搬 marktext/muya 架构）+ Monaco（Source 模式） |
| AI | 远程 OpenAI 兼容 API（remote-only）+ jieba-wasm 分词 + FTS5 关键词召回 |
| 测试 | Vitest + Playwright（真实 Chromium E2E） |
| 图标 | react-icons/md（Material Design Icons） |

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

- [SUMMARY](./SUMMARY.md) — 文档索引
- [REQUIREMENTS](./REQUIREMENTS.md) — 功能需求文档
- [TODO](./TODO.md) — 功能进度与已知问题
- [modules/](./modules/) — 各模块详细文档（11 个模块）
- [specs/](./specs/) — 编辑主区 v2 规格与实施记录（12 个规格文档）
- [testing/](./testing/) — TDD 测试报告（6 个测试报告）
- [plan/](./plan/) — Devflow 实施计划与状态记录（10 个文档）
- [requirements/](./requirements/) — Devflow 需求文档（4 个文档）

### 查阅规则（渐进式披露）

- 项目是什么、怎么跑 → README.md
- 功能需求、验收标准 → REQUIREMENTS.md
- 功能进度、已知问题 → TODO.md
- 模块实现细节、架构 → docs/modules/{模块名}.md
- 编辑主区规格、设计决策 → docs/specs/
- 测试覆盖、验证证据 → docs/testing/
- 实施计划、变更清单 → docs/plan/
