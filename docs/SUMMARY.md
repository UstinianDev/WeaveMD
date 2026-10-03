# WeaveMD 文档索引

> 最后更新：2026-10-04
> 索引只列到「目录 / 任务」粒度；单篇文件清单由各目录的 README 或本文附录给出，避免索引本身膨胀。

## 核心文档

| 文档 | 说明 |
|------|------|
| [README](../README.md) | GitHub 项目主页（功能介绍、下载安装、开发指南） |
| [docs/README](./README.md) | 开发参考（技术栈、目录结构、命令、质量门禁） |
| [REQUIREMENTS](./REQUIREMENTS.md) | 功能需求文档（3.1~3.13，含 doc-pipeline 流水线与多意图识别执行） |
| [testing/](./testing/) | TDD 报告 + [索引](./testing/README.md)（**交付时点快照**，测试意图溯源用） |
| [TODO](./TODO.md) | 功能进度与已知问题 |
| [CONTRIBUTING](./CONTRIBUTING.md) | 文档编写规范（渐进式披露、命名规范、更新流程） |

## 架构文档（按技术层，10 篇）

| 文档 | 说明 |
|------|------|
| [frontend](./architecture/frontend.md) | 前端渲染层（React / 8 个 store / 11 个 hooks / Tailwind） |
| [editor](./architecture/editor.md) | 编辑器内核（块树 / 双向转换 / 9 类控制器 / Outline） |
| [backend](./architecture/backend.md) | 主进程（Electron / AI 服务 / 13 个 IPC handler 模块 / 30 工具） |
| [ai-agent](./architecture/ai-agent.md) | AI/Agent 系统（循环 / 30 工具 / 意图 / 写控制 / 自动记忆 / 标题编号） |
| [knowledge](./architecture/knowledge.md) | 知识库（FTS5 索引 / BM25 搜索 / HyDE / Agentic RAG / 附件关联） |
| [database](./architecture/database.md) | 数据库（SQLite / 27 表：23 实表 + 4 虚拟表 / D1~D8 + agent_memory 5 追加式迁移） |
| [ipc](./architecture/ipc.md) | IPC 通信（contextBridge / 119 通道 / 11 组 / 事件持久化） |
| [security](./architecture/security.md) | 安全（JWT / bcrypt / safeStorage / 参数化查询 / 外发闸） |
| [testing](./architecture/testing.md) | 测试（Vitest / Playwright / TDD / 质量门禁） |
| [build](./architecture/build.md) | 构建与发布（Vite / electron-builder / sizeGate 体积门禁） |

## 模块文档（11 个）

| 文档 | 说明 |
|------|------|
| [01-加载页面](./modules/01-加载页面-Splash.md) | 启动动画 + 阶段切换 |
| [02-认证系统](./modules/02-认证系统-Auth.md) | 注册 / 登录 / JWT / 多账号切换 |
| [03-顶部导航栏](./modules/03-顶部导航栏-Navbar.md) | 图标菜单 / 撤销重做 / 设置 / AI 按钮 |
| [04-编辑主区](./modules/04-编辑主区-Editor.md) | v2 块树内核 + Outline 统一 + 浮动工具栏 |
| [05-设置界面](./modules/05-设置界面-Settings.md) | UnifiedSettings 多 Tab + 主题系统 |
| [06-窗口控制](./modules/06-窗口控制-Window.md) | Frameless 窗口 + 自动更新 |
| [07-数据持久化层](./modules/07-数据持久化层-Database.md) | SQLite 27 表（含 agent_memory）+ FTS5 + vec0 |
| [08-IPC通信机制](./modules/08-IPC通信机制.md) | 119 通道（11 组）+ 事件持久化 |
| [09-国际化](./modules/09-国际化-i18n.md) | 中文简繁 + 英文（三语言） |
| [10-导出功能](./modules/10-导出功能-Export.md) | 8 格式导出（md/html/doc/docx/pdf/png/jpg/jpeg） |
| [11-AI代理面板](./modules/11-AI代理面板-Agent.md) | Agent / 知识库 / Agentic RAG + Composer 标签化 + 标题自动编号 + 分册 4 篇（优化历史 / Diff 卡片 / 提问卡片 / 触发优化与提示词规则） |

## 规格文档（22 篇主文档 + 10 篇分册，按模块分文件夹）

> **按模块存储**：`docs/specs/{editor|ai-agent|knowledge|release}/`。超长文档另按渐进式披露拆到
> `docs/specs/{模块}/{同名}/NN-主题.md` —— **主文档路径不变**（入链全保留），头部给索引，
> 分册正文与原章节逐字一致。

| 模块文件夹 | 主文档 | 分册 |
|---|---|---|
| **`editor/`（编辑器）** | [editor-v2-architecture](./specs/editor/editor-v2-architecture.md) · [editor-v2-progress](./specs/editor/editor-v2-progress.md) · [editor-v2-features](./specs/editor/editor-v2-features.md) · [editor-v2-selection-undo](./specs/editor/editor-v2-selection-undo.md) · [markdown-block-exit-rules](./specs/editor/markdown-block-exit-rules.md) · [floating-toolbar-refactor](./specs/editor/floating-toolbar-refactor.md) · [floating-toolbar-ux](./specs/editor/floating-toolbar-ux-and-inline-format.md) · [floating-toolbar-format-sticky](./specs/editor/floating-toolbar-format-sticky.md) · [drag-selection-flicker](./specs/editor/drag-selection-flicker.md) · [code-block-trailing-paragraph](./specs/editor/code-block-trailing-paragraph.md) | 7 篇（architecture 2、progress 3、format-sticky 1、ux 1） |
| **`ai-agent/`（AI 面板与 Agent）** | [ai-panel-features](./specs/ai-agent/ai-panel-features.md) · **[agent-prompt-context](./specs/ai-agent/agent-prompt-context.md)**（SPEC-AGENT-PTX 提示词组装与注入契约）· **[agent-message-storage](./specs/ai-agent/agent-message-storage.md)**（SPEC-AGENT-MSG 消息写读契约）· **[agent-tool-runtime](./specs/ai-agent/agent-tool-runtime.md)**（SPEC-AGENT-TOOL 工具执行/并发/外发闸）· **[agent-cost-caching](./specs/ai-agent/agent-cost-caching.md)**（SPEC-AGENT-COST 成本核算与缓存）· **[agent-memory](./specs/ai-agent/agent-memory.md)**（SPEC-AGENT-MEM 自动记忆，+ 分册 3 篇） | 3 篇（memory 01 存储与策略 / 02 读写工具与后台提取 / 03 召回与经验注入） |
| **`knowledge/`（知识库与文档处理）** | [embedding-architecture](./specs/knowledge/embedding-architecture.md) · [indexing-compatibility](./specs/knowledge/indexing-compatibility.md) · **[kb-indexing-egress](./specs/knowledge/kb-indexing-egress.md)**（SPEC-KB-IDX 分块/索引/检索/外发）· **[document-parsing](./specs/knowledge/document-parsing.md)**（SPEC-DOC-PARSE 解析层）· **[attachments-multimodal](./specs/knowledge/attachments-multimodal.md)**（SPEC-DOC-ATTACH 附件与多模态） | — |
| **`release/`（发布）** | [auto-update-spec](./specs/release/auto-update-spec.md) | — |

> **加粗为本次从 `docs/plan/` 提炼的 8 篇新 spec**（plan 已整体退役、历史见 git，功能规格以本表为准）。
> `docs/research/` 另存**外部资料调研**（不属规格，见下）。

## devflow 产出（现行）

> **已完成任务的需求 / 计划 / 测试报告正文已删除**（2026-10-04 文档精简），历史一律见 git 日志。
> 保留在库里的只有两类：① **现行**任务的过程文档；② 需求文档 —— 后者是**当前代码行为的裁定依据**
> （Q 裁定、硬性约束），不是过程产物。

| 任务 | 需求 | 计划与状态 | 验证证据 |
|---|---|---|---|
| **ai-core-perf**（性能优化：AI 代理多意图 / 自动记忆 / 任务队列 / 内置工具 + 文档解析；13 瓶颈，实施 9 放弃 4） | [req](./requirements/ai-core-perf/ai-core-perf.req.md) | [bottleneck](./plan/ai-core-perf.bottleneck.md) · [plan](./plan/ai-core-perf.plan.md) · [status](./plan/ai-core-perf.status.md) · [connectivity](./plan/ai-core-perf.connectivity.md) · [delivery](./plan/ai-core-perf.delivery.md) | `tests/benchmarks/ai-core-perf.test.ts` + `tests/main/ai/aiCorePerfGuards.test.ts` |

### 需求文档（`requirements/`，8 篇 / 6 个模块子文件夹）

| 模块 | 文档 |
|---|---|
| `ai-core-perf/` | [ai-core-perf.req](./requirements/ai-core-perf/ai-core-perf.req.md) |
| `agent-multi-intent/` | [agent-multi-intent.req](./requirements/agent-multi-intent/agent-multi-intent.req.md)（§3 Q1~Q14 / §6 Q17~Q24 裁定） |
| `agent-memory/` | [optimize](./requirements/agent-memory/agent-memory-optimize.req.md) · [optimize-2](./requirements/agent-memory/agent-memory-optimize-2.req.md) · [optimize-3](./requirements/agent-memory/agent-memory-optimize-3.req.md) |
| `agent-kb-ux/` | [agent-kb-ux.req](./requirements/agent-kb-ux/agent-kb-ux.req.md) |
| `doc-pipeline/` | [doc-pipeline.req](./requirements/doc-pipeline/doc-pipeline.req.md) |
| `agent-history-toolcards/` | [agent-history-toolcards.req](./requirements/agent-history-toolcards/agent-history-toolcards.req.md) |

## 其他

| 文档 | 说明 |
|------|------|
| [guide/packaging](./guide/packaging.md) | 打包与发布指南（Electron Builder + files 反向排除 + sizeGate） |

## 查阅规则（渐进式披露）

- 项目是什么、怎么跑 → [README](../README.md)
- 技术栈、目录结构、命令 → [docs/README](./README.md)
- 功能进度、已知问题 → [TODO](./TODO.md)
- 功能需求、验收标准 → [REQUIREMENTS](./REQUIREMENTS.md)
- 文档编写规范 → [CONTRIBUTING](./CONTRIBUTING.md)
- 前端渲染层、状态管理 → [frontend](./architecture/frontend.md)
- 编辑器内核、块树、控制器 → [editor](./architecture/editor.md)
- 主进程、IPC、工具系统 → [backend](./architecture/backend.md)
- AI/Agent 循环、工具、意图 → [ai-agent](./architecture/ai-agent.md)
- 知识库索引、搜索、HyDE → [knowledge](./architecture/knowledge.md)
- 数据库表结构、DAO → [database](./architecture/database.md)
- IPC 通道、事件持久化 → [ipc](./architecture/ipc.md)
- 认证、加密、权限 → [security](./architecture/security.md)
- 测试策略、工具、覆盖率 → [testing](./architecture/testing.md)
- 构建、打包、发布 → [build](./architecture/build.md)
- 自动更新规范 → [auto-update-spec](./specs/release/auto-update-spec.md)
- 模块实现细节 → [modules/](./modules/)
- 功能规格与行为契约 → [specs/](./specs/)（按模块分文件夹：editor / ai-agent / knowledge / release）
- 外部资料调研 → [research/](./research/)
- 测试意图溯源（为何有这条测试）→ [testing/](./testing/)（**交付时点快照，数字已过期**；活证据在 `tests/` + `e2e/`）
- 实施计划、优化状态、验证证据 → `./plan/`（现行 5 篇，全部属 ai-core-perf；已完成任务的历史见 git）
- 导出/MIME/打包指南 → [guide/](./guide/)
