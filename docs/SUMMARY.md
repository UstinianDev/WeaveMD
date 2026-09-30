# WeaveMD 文档索引

> 最后更新：2026-09-28
> 索引只列到「目录 / 任务」粒度；单篇文件清单由各目录的 README 或本文附录给出，避免索引本身膨胀。

## 核心文档

| 文档 | 说明 |
|------|------|
| [README](../README.md) | GitHub 项目主页（功能介绍、下载安装、开发指南） |
| [docs/README](./README.md) | 开发参考（技术栈、目录结构、命令、质量门禁） |
| [REQUIREMENTS](./REQUIREMENTS.md) | 功能需求文档（3.1~3.12，含 doc-pipeline 流水线） |
| [TODO](./TODO.md) | 功能进度与已知问题 |
| [CONTRIBUTING](./CONTRIBUTING.md) | 文档编写规范（渐进式披露、命名规范、更新流程） |

## 架构文档（按技术层，10 篇）

| 文档 | 说明 |
|------|------|
| [frontend](./architecture/frontend.md) | 前端渲染层（React / 8 个 store / 11 个 hooks / Tailwind） |
| [editor](./architecture/editor.md) | 编辑器内核（块树 / 双向转换 / 9 类控制器 / Outline） |
| [backend](./architecture/backend.md) | 主进程（Electron / AI 服务 / 11 个 IPC handler 模块 / 28 工具） |
| [ai-agent](./architecture/ai-agent.md) | AI/Agent 系统（循环 / 工具 / 意图 / 写控制 / 标题编号） |
| [knowledge](./architecture/knowledge.md) | 知识库（FTS5 索引 / BM25 搜索 / HyDE / Agentic RAG / 附件关联） |
| [database](./architecture/database.md) | 数据库（SQLite / 25 表：22 实表 + 3 虚拟表 / D1~D8 迁移） |
| [ipc](./architecture/ipc.md) | IPC 通信（contextBridge / 111 通道 / 11 组 / 事件持久化） |
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
| [07-数据持久化层](./modules/07-数据持久化层-Database.md) | SQLite 25 表 + FTS5 + vec0 |
| [08-IPC通信机制](./modules/08-IPC通信机制.md) | 111 通道（11 组）+ 事件持久化 |
| [09-国际化](./modules/09-国际化-i18n.md) | 中文简繁 + 英文（三语言） |
| [10-导出功能](./modules/10-导出功能-Export.md) | 8 格式导出（md/html/doc/docx/pdf/png/jpg/jpeg） |
| [11-AI代理面板](./modules/11-AI代理面板-Agent.md) | Agent / 知识库 / Agentic RAG + Composer 标签化 + 标题自动编号 |

## 规格文档（14 篇主文档 + 7 篇分册）

> 超长三级文档已按渐进式披露拆到 `docs/{文档名}/` 子目录：**主文档路径不变**（入链全保留），
> 头部给出索引，分册承载被拆出的章节，分册正文与原文件逐字一致。

| 分组 | 文档 | 说明 |
|------|------|------|
| 编辑器 v2 | [editor-v2-architecture](./specs/editor-v2-architecture.md) | v2 架构规范索引（§1 背景 / §2 总体架构）+ 分册 2 篇（§3-§4 数据模型与转换、§5-§6 渲染与控制器） |
| | [editor-v2-progress](./specs/editor-v2-progress.md) | v2 实施记录索引（§13.1~§13.15 条目表）+ 分册 3 篇（内核集成 / 退出与工具栏 / 行内与图片） |
| | [editor-v2-features](./specs/editor-v2-features.md) | v2 功能清单（编辑器 UI 规范 + 工具栏 + 图片 + 表格） |
| | [editor-v2-selection-undo](./specs/editor-v2-selection-undo.md) | v2 选区 / 撤销 / 集成设计 |
| | [markdown-block-exit-rules](./specs/markdown-block-exit-rules.md) | 退格退出规则（六条） |
| 浮动工具栏 | [floating-toolbar-refactor](./specs/floating-toolbar-refactor.md) | SPEC-EDIT-FT：选区触发 + 块类型下拉 |
| | [floating-toolbar-ux](./specs/floating-toolbar-ux-and-inline-format.md) | 行内格式（加粗 / 斜体 / 删除线 / 高亮 / 代码 / 链接）+ 分册：§9 实施记录 |
| | [floating-toolbar-format-sticky](./specs/floating-toolbar-format-sticky.md) | SPEC-EDIT-FT4：选区保持 + 格式粘性 + 分册：§9 实施记录 |
| | [drag-selection-flicker](./specs/drag-selection-flicker.md) | SPEC-EDIT-DSF：端点检测 + rAF 合并 |
| | [code-block-trailing-paragraph](./specs/code-block-trailing-paragraph.md) | SPEC-EDIT-CBTP：代码块尾随空行持久化 |
| AI 与知识库 | [ai-panel-features](./specs/ai-panel-features.md) | AI 面板历史交付记录（7 期 + 写控制 + Agentic RAG） |
| | [embedding-architecture](./specs/embedding-architecture.md) | Embedding 多提供商架构 |
| | [indexing-compatibility](./specs/indexing-compatibility.md) | 索引流程兼容性设计 |
| 发布 | [auto-update-spec](./specs/auto-update-spec.md) | 自动更新规范（架构 / IPC / 发布流程 / 故障排查） |

## devflow 产出

按任务成套存放，同一任务的四件套同名前缀：`{task}.req.md`（需求）、`{task}.plan.md` / `{task}.status.md`（计划与状态）、`{task}.*.tdd.md`（测试证据），另有 connectivity（连通性）与 compliance（合规）报告。

| 需求（`requirements/`，当前 6 篇 + archive 12 篇） | 计划与状态（`plan/`，当前 26 篇主文档 + 4 篇分册 + archive 32 篇） | 测试报告（`testing/`，21 篇） |
|---|---|---|
| [doc-pipeline.req](./requirements/doc-pipeline.req.md) | [doc-pipeline.plan](./plan/doc-pipeline.plan.md) / [status](./plan/doc-pipeline.status.md) / [connectivity](./plan/doc-pipeline.connectivity.md) / [compliance](./plan/doc-pipeline.compliance.md) / [docling-poc](./plan/doc-pipeline.docling-poc.md) / [remedial.diagnosis](./plan/doc-pipeline.remedial.diagnosis.md) | `doc-pipeline-b1` ~ `doc-pipeline-b11` + `doc-pipeline-remedial` + `doc-pipeline.final` |
| [agent-cost-optimize.req](./requirements/agent-cost-optimize.req.md) | [plan](./plan/agent-cost-optimize.plan.md) / [status](./plan/agent-cost-optimize.status.md) | `agent-cost-optimize.tdd` |
| [agent-perf-optimize.req](./requirements/agent-perf-optimize.req.md) | [plan](./plan/agent-perf-optimize.plan.md) / [phase2](./plan/agent-perf-optimize.phase2.plan.md) / [status](./plan/agent-perf-optimize.status.md) / [connectivity](./plan/agent-perf-optimize.connectivity.md) | — |
| [agent-memory-optimize.req](./requirements/agent-memory-optimize.req.md) | [plan](./plan/agent-memory-optimize.plan.md) / [status](./plan/agent-memory-optimize.status.md) / [connectivity](./plan/agent-memory-optimize.connectivity.md) / [compliance](./plan/agent-memory-optimize.compliance.md) | `agent-memory-optimize.tdd` |
| [agent-md-kb-optimize.req](./requirements/agent-md-kb-optimize.req.md) | [plan](./plan/agent-md-kb-optimize.plan.md) / [status](./plan/agent-md-kb-optimize.status.md) | — |
| [agent-memory-optimize.req](./requirements/agent-memory-optimize.req.md)（P0 第一批，已完成） | [direction](./plan/agent-memory-optimize.direction.md)（7 模块 30 任务路线图） / [plan](./plan/agent-memory-optimize.plan.md) / [status](./plan/agent-memory-optimize.status.md) / [connectivity](./plan/agent-memory-optimize.connectivity.md) / [compliance](./plan/agent-memory-optimize.compliance.md) | `agent-memory-optimize.tdd` |
| [agent-memory-optimize-2.req](./requirements/agent-memory-optimize-2.req.md)（P1 第二批，进行中） | [plan](./plan/agent-memory-optimize-2.plan.md) | — |
| — | 6 篇 doc-pipeline 调研（`plan/doc-pipeline.research-*.md`：parse / pdf-multimodal / storage / chunking / packaging / tools） | `spec-edit-ft` ~ `ft4` / `cbtp` / `dsf`（编辑器规格 TDD 6 篇） |

> 历史任务的计划与需求已归档至 `plan/archive/`、`requirements/archive/`，不在上表展开。
> 超长的 3 篇计划/状态已拆出分册（`plan/doc-pipeline.plan/`、`plan/doc-pipeline.status/`、
> `plan/agent-cost-optimize.status/`）：主文档保留批次总表/决策基线/总览，逐批变更与逐批记录进分册。

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
- 自动更新规范 → [auto-update-spec](./specs/auto-update-spec.md)
- 模块实现细节 → [modules/](./modules/)
- 编辑器/AI 面板设计 → [specs/](./specs/)
- 测试覆盖、验证证据 → [testing/](./testing/)
- 实施计划、优化状态 → [plan/](./plan/)
- 导出/MIME/打包指南 → [guide/](./guide/)
