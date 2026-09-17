# WeaveMD 文档索引

> 最后更新：2026-09-17

## 核心文档

| 文档 | 说明 |
|------|------|
| [README](../README.md) | GitHub 项目主页（功能介绍、下载安装、开发指南） |
| [REQUIREMENTS](./REQUIREMENTS.md) | 功能需求文档（完整版） |
| [TODO](./TODO.md) | 功能进度与已知问题 |
| [CONTRIBUTING](./CONTRIBUTING.md) | 文档编写规范（渐进式披露、命名规范、更新流程） |
| [packaging](./guide/packaging.md) | 打包与发布指南（Electron Builder） |

## 架构文档（按技术层）

| 文档 | 说明 |
|------|------|
| [frontend](./architecture/frontend.md) | 前端渲染层架构（React/状态管理/CSS/TipTap） |
| [editor](./architecture/editor.md) | 编辑器内核（块树/转换/渲染/控制器/Outline统一） |
| [backend](./architecture/backend.md) | 主进程架构（Electron/AI/IPC/工具系统） |
| [ai-agent](./architecture/ai-agent.md) | AI/Agent 系统（循环/工具/意图/写控制/Composer标签化/标题编号） |
| [knowledge](./architecture/knowledge.md) | 知识库系统（FTS5索引/BM25搜索/HyDE/Agentic RAG） |
| [database](./architecture/database.md) | 数据库架构（SQLite/better-sqlite3/16+表/FTS5） |
| [ipc](./architecture/ipc.md) | IPC 通信机制（contextBridge/80+通道/9组/事件持久化） |
| [security](./architecture/security.md) | 安全架构（JWT/bcrypt/safeStorage/参数化查询） |
| [testing](./architecture/testing.md) | 测试架构（Vitest/Playwright/TDD/质量门禁） |
| [build](./architecture/build.md) | 构建与发布（Vite/Electron Builder/GitHub Release） |

## 模块文档

| 文档 | 说明 |
|------|------|
| [01-加载页面](./modules/01-加载页面-Splash.md) | 启动动画（Lottie + 版本检测） |
| [02-认证系统](./modules/02-认证系统-Auth.md) | 注册/登录/JWT/多账号切换 |
| [03-顶部导航栏](./modules/03-顶部导航栏-Navbar.md) | 图标菜单/撤销/重做/设置/AI按钮 |
| [04-编辑主区](./modules/04-编辑主区-Editor.md) | v2 块树内核 + Outline 统一 + 浮动工具栏 |
| [05-设置界面](./modules/05-设置界面-Settings.md) | UnifiedSettings 8 Tab + 主题系统 |
| [06-窗口控制](./modules/06-窗口控制-Window.md) | Frameless 窗口 + 自动更新 |
| [07-数据持久化层](./modules/07-数据持久化层-Database.md) | SQLite 16+ 表 + FTS5 |
| [08-IPC通信机制](./modules/08-IPC通信机制.md) | 80+ 通道（9 组）+ 事件持久化 |
| [09-国际化](./modules/09-国际化-i18n.md) | 中文简繁 + 英文（三语言） |
| [10-导出功能](./modules/10-导出功能-Export.md) | 8 格式导出（md/html/pdf/docx/...） |
| [11-AI代理面板](./modules/11-AI代理面板-Agent.md) | Agent/知识库/Agentic RAG/HyDE + Composer标签化 + 标题自动编号 |

## 规格文档

| 文档 | 说明 |
|------|------|
| [editor-v2-architecture](./specs/editor-v2-architecture.md) | v2 块树架构设计（§1-§6：内核/渲染/选区/撤销） |
| [editor-v2-progress](./specs/editor-v2-progress.md) | v2 实施记录（§13：分阶段交付 + 门禁证据） |
| [editor-v2-features](./specs/editor-v2-features.md) | v2 功能清单（编辑器 UI 规范 + 工具栏 + 图片 + 表格） |
| [editor-v2-selection-undo](./specs/editor-v2-selection-undo.md) | v2 选区/撤销/集成设计（跨块选区 + undo栈） |
| [ai-panel-features](./specs/ai-panel-features.md) | AI 面板历史交付记录（7 期 + 写控制 + Agentic RAG） |
| [auto-update-spec](./specs/auto-update-spec.md) | 自动更新规范（架构/数据流/IPC/发布流程/故障排查） |
| [markdown-block-exit-rules](./specs/markdown-block-exit-rules.md) | 退格退出规则（六条：列表/引用/任务/代码块） |
| [floating-toolbar-refactor](./specs/floating-toolbar-refactor.md) | 浮动工具栏重构规范（SPEC-EDIT-FT：选区触发 + 块类型下拉） |
| [floating-toolbar-ux](./specs/floating-toolbar-ux-and-inline-format.md) | 浮动工具栏 UX + 行内格式（加粗/斜体/删除线/高亮/代码/链接） |
| [floating-toolbar-format-sticky](./specs/floating-toolbar-format-sticky.md) | 格式应用交互修正（SPEC-EDIT-FT4：选区保持 + 格式粘性） |
| [drag-selection-flicker](./specs/drag-selection-flicker.md) | 跨块拖选闪烁优化（SPEC-EDIT-DSF：端点检测 + rAF合并） |
| [code-block-trailing-paragraph](./specs/code-block-trailing-paragraph.md) | 代码块/图片块尾随空行持久化（SPEC-EDIT-CBTP） |
| [embedding-architecture](./specs/embedding-architecture.md) | Embedding 多提供商架构设计 |
| [indexing-compatibility](./specs/indexing-compatibility.md) | 索引流程兼容性设计 |

## 需求文档

### 当前

| 文档 | 说明 |
|------|------|
| [agent-perf-optimize.req](./requirements/agent-perf-optimize.req.md) | Agent 性能优化需求（17 子任务：流式推测执行 / 工具延迟 / Prompt 缓存 / KB 缓存 / 监控） |

### 历史（`docs/requirements/archive/`）

12 篇已完成任务的需求文档已归档。

## 实施计划

### 当前

| 文档 | 说明 |
|------|------|
| [agent-perf-optimize.plan](./plan/agent-perf-optimize.plan.md) | Agent 性能优化计划（阶段 1-4） |
| [agent-perf-optimize.phase2.plan](./plan/agent-perf-optimize.phase2.plan.md) | Agent 性能优化阶段 2 计划 |
| [agent-perf-optimize.status](./plan/agent-perf-optimize.status.md) | Agent 性能优化状态（全阶段追踪） |
| [agent-perf-optimize.connectivity](./plan/agent-perf-optimize.connectivity.md) | 连通性验证报告 |

### 归档（`docs/plan/archive/`）

32 篇已完成任务的计划/状态/瓶颈分析/连通性/重构报告文件已归档。

## 测试报告

| 文档 | 说明 |
|------|------|
| [spec-edit-ft](./testing/spec-edit-ft.tdd.md) | 浮动工具栏 TDD（SPEC-EDIT-FT） |
| [spec-edit-ft2](./testing/spec-edit-ft2.tdd.md) | 行内格式 TDD（SPEC-EDIT-FT2） |
| [spec-edit-ft3](./testing/spec-edit-ft3.tdd.md) | 叠加收敛 TDD（SPEC-EDIT-FT3） |
| [spec-edit-ft4](./testing/spec-edit-ft4.tdd.md) | 格式应用交互修正 TDD（SPEC-EDIT-FT4） |
| [spec-edit-cbtp](./testing/spec-edit-cbtp.tdd.md) | 代码块尾随空行 TDD（SPEC-EDIT-CBTP） |
| [spec-edit-dsf](./testing/spec-edit-dsf.tdd.md) | 拖选闪烁 TDD（SPEC-EDIT-DSF） |

## 查阅规则（渐进式披露）

- 项目是什么、怎么跑 → [README](../README.md)
- 技术栈、目录结构、命令 → [docs/README](./README.md)
- 功能进度、已知问题 → [TODO](./TODO.md)
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