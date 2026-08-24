# WeaveMD — AGENTS.md

> 本文件是 CLAUDE.md 的扩展入口，将 AI 认知体系分为三层。
> **CLAUDE.md** 负责"构建命令 + 目录结构 + 代码规范"；本文件负责"设计文档路由 + 开发规则路由 + 工作流路由"。

---

## 1. 文档体系 (docs/)

详细设计文档统一放置在 `docs/` 目录下，AI 代理按需读取：

| 文档 | 用途 | 何时查阅 |
|------|------|----------|
| `docs/REQUIREMENTS.md` | 功能需求与实现状态（含附录 A 编辑器状态） | 核对需求、验收标准时 |
| `docs/TECH_STACK.md` | 技术选型与架构决策 | 技术栈、项目结构疑问时 |
| `docs/SUMMARY.md` | 项目总览与进度索引 | 首次进入项目 / 快速概览 |
| `docs/modules/` | 各模块功能总结（01-10，编辑主区见 04） | 深入某个模块实现时 |
| `docs/specs/` | 编辑主区专项规范（退出规则/浮动工具栏/拖选/代码块补偿等） | 编辑主区行为与边界时 |

**核心约定**：每完成一个功能，必须先更新对应 docs 文档，再提交代码。

---

## 2. 开发规则 (.claude/rules/)

`docs/` 是通用指南，`.claude/rules/` 是 AI 代理必须遵守的硬性规则：

| 规则文件 | 侧重 |
|----------|------|
| `.claude/rules/CONVENTIONS.md` | 命名、导入顺序、组件组织、CSS 策略 |
| `.claude/rules/SECURITY.md` | 禁止 hardcode 密钥、数据库参数化查询、密码策略 |
| `.claude/rules/WORKFLOW.md` | 编码 → 测试 → 文档 → 提交的固定流程 |

---

## 3. 工作流约束

1. **文档必须先于代码**：新增功能前先更新或创建 docs 中对应的设计文档。
2. **测试必须通过**：每次功能完成后运行 `npm run test`，失败则修复再继续。
3. **Git 提交到 GitHub**：遵循 `type(scope): message` 格式（如 `feat(auth): add login page`）。
4. **Hooks 守护**：`.claude/settings.json` 中注册了任务钩子，确保流程不被绕过。

---

## 4. 设计规则

### ❌ 绝对禁止项

#### 配色禁止
- 紫色/靛蓝色/蓝紫渐变（#6366F1、#8B5CF6）
- 纯平背景色（必须有噪点纹理或渐变）
- Tailwind 默认色板

#### 布局禁止
- Hero + 三卡片布局
- 完美居中对齐
- 等宽多栏（必须不对称）

#### 文案禁止
- 高深的专业名词和无意义的空话
- Lorem Ipsum 占位文本
- 被动语态和长句

#### 组件禁止
- Shadcn/Material UI 默认组件（必须深度定制）
- Emoji 作为功能图标
- 线性动画（ease-in-out）

### ✅ 必须遵守项

#### 文案风格
- 口语化，像朋友聊天
- 具体化，有数字和场景
- 可以幽默、自嘲、甚至挑衅
- 每句话不超过 15 个字

#### 图片系统
- 图标：使用 Iconify 图标库（https://iconify.design）
- 占位图：使用 Picsum Photos（https://picsum.photos）
- 真实图片：使用 Pexels 搜索（https://www.pexels.com）
- 插画：使用 unDraw（https://undraw.co）

---

> @CLAUDE.md — 打通本文件与 CLAUDE.md 的链接。