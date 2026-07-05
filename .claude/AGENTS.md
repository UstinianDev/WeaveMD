# WeaveMD — AGENTS.md

> 本文件是 CLAUDE.md 的扩展入口，将 AI 认知体系分为三层。
> **CLAUDE.md** 负责"构建命令 + 目录结构 + 代码规范"；本文件负责"设计文档路由 + 开发规则路由 + 工作流路由"。

---

## 1. 文档体系 (docs/)

详细设计文档统一放置在 `docs/` 目录下，AI 代理按需读取：

| 文档 | 用途 | 何时查阅 |
|------|------|----------|
| `docs/FRONTEND.md` | 前端组件设计、UI 规范、状态管理约定 | 编写/修改 React 组件、样式时 |
| `docs/SECURITY.md` | 认证流程、SQLite 加密、XSS/CSRF 防护 | 处理认证、密码、Token 时 |
| `docs/DATABASE.md` | Schema、索引、迁移、IPC 数据流 | 操作数据库、编写 DB 层时 |
| `docs/ARCHITECTURE.md` | 分层架构、IPC 通信、模块依赖图 | 理解整体结构、添加新模块时 |
| `docs/WORKFLOW.md` | Git 流程、Code Review、发布流程 | 提交代码、准备发布时 |

**核心约定**：每完成一个功能，必须先更新对应 docs 文档，再提交代码。

---

## 2. 开发规则 (rules/)

`docs/` 是通用指南，`rules/` 是 AI 代理必须遵守的硬性规则：

| 规则文件 | 侧重 |
|----------|------|
| `rules/CONVENTIONS.md` | 命名、导入顺序、组件组织、CSS 策略 |
| `rules/SECURITY.md` | 禁止 hardcode 密钥、数据库参数化查询、密码策略 |
| `rules/WORKFLOW.md` | 编码 → 测试 → 文档 → 提交的固定流程 |

---

## 3. 工作流约束

1. **文档必须先于代码**：新增功能前先更新或创建 docs 中对应的设计文档。
2. **测试必须通过**：每次功能完成后运行 `npm run test`，失败则修复再继续。
3. **Git 提交到 GitHub**：遵循 `type(scope): message` 格式（如 `feat(auth): add login page`）。
4. **Hooks 守护**：`.vscode/settings.json` 中注册了任务钩子，确保流程不被绕过。

---

> @CLAUDE.md — 打通本文件与 CLAUDE.md 的链接。