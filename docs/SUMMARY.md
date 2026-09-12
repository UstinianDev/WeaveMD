# WeaveMD 文档索引

> 最后更新：2026-09-12

## 核心文档

| 文档 | 说明 |
|------|------|
| [README](../README.md) | GitHub 项目主页（功能介绍、下载安装、开发指南） |
| [REQUIREMENTS](./REQUIREMENTS.md) | 功能需求文档（完整版） |
| [TODO](./TODO.md) | 功能进度与已知问题 |
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
| [markdown-block-exit-rules](./specs/markdown-block-exit-rules.md) | 退格退出规则（六条：列表/引用/任务/代码块） |
| [floating-toolbar-refactor](./specs/floating-toolbar-refactor.md) | 浮动工具栏重构规范（SPEC-EDIT-FT：选区触发 + 块类型下拉） |
| [floating-toolbar-ux](./specs/floating-toolbar-ux-and-inline-format.md) | 浮动工具栏 UX + 行内格式（加粗/斜体/删除线/高亮/代码/链接） |
| [floating-toolbar-format-sticky](./specs/floating-toolbar-format-sticky.md) | 格式应用交互修正（SPEC-EDIT-FT4：选区保持 + 格式粘性） |
| [drag-selection-flicker](./specs/drag-selection-flicker.md) | 跨块拖选闪烁优化（SPEC-EDIT-DSF：端点检测 + rAF合并） |
| [code-block-trailing-paragraph](./specs/code-block-trailing-paragraph.md) | 代码块/图片块尾随空行持久化（SPEC-EDIT-CBTP） |

## 需求文档

| 文档 | 说明 |
|------|------|
| [optimize-outline-aiheading-composer.req](./requirements/optimize-outline-aiheading-composer.req.md) | Outline统一 + 标题编号 + Composer标签化 |
| [agent-optimize-v3.req](./requirements/agent-optimize-v3.req.md) | Agent 优化 v3 需求（搜索持久化/动态轮次/多文件Diff） |
| [agent-kb-refactor.req](./requirements/agent-kb-refactor.req.md) | Agent/KB 重构需求（模块拆分/缓存提取） |
| [fix-web-search-loop.req](./requirements/fix-web-search-loop.req.md) | web_search 死循环修复需求（✅ 已修复） |

## 实施计划

### 最近修复（2026-09-12）

| 文档 | 说明 |
|------|------|
| [export-image-fix.status](./plan/export-image-fix.status.md) | **导出图片修复**：offscreen渲染 + 3x缩放因子 + 高清晰度导出 |
| [url-query-fix.status](./plan/url-query-fix.status.md) | **URL查询修复**：Agent系统提示词优化，强制调用web_search工具 |
| [view-toggle-fix.status](./plan/view-toggle-fix.status.md) | **视图切换修复**：删除冗余ViewMenu + scrollTop滚动位置保持 |
| [arrow-key-navigation.status](./plan/arrow-key-navigation.status.md) | **上下键跨块导航**：实现ArrowUp/ArrowDown跨语法类型跳转 |
| [save-function-fix.status](./plan/save-function-fix.status.md) | **保存功能修复**：文件树刷新 + 编辑器同步 |

### 历史计划

| 文档 | 说明 |
|------|------|
| [optimize-outline-aiheading-composer.status](./plan/optimize-outline-aiheading-composer.status.md) | **编辑主区+AI面板优化（2026-09-11）**：Outline统一 + 标题编号 + Composer标签化 |
| [agent-optimization.status](./plan/agent-optimization.status.md) | **Agent 优化（2026-09-11）**：折叠重构 + Hover 调淡 + 消息编辑 + 上下文修复 |
| [agent-optimize-v3.plan](./plan/agent-optimize-v3.plan.md) | Agent 优化 v3 实施计划（搜索持久化/动态轮次/多文件Diff） |
| [agent-optimize-v3.status](./plan/agent-optimize-v3.status.md) | Agent 优化 v3 状态（✅ 完成） |
| [ai-agent-optimize.status](./plan/ai-agent-optimize.status.md) | AI Agent 优化状态（30/30 ✅ 完成） |
| [ai-perf-optimize-v2.status](./plan/ai-perf-optimize-v2.status.md) | AI 性能优化 v2 状态（✅ 完成） |
| [ai-perf-2026-09-09.status](./plan/ai-perf-2026-09-09.status.md) | AI 性能优化 2026-09-09 状态（✅ 完成） |
| [agent-kb-refactor.plan](./plan/agent-kb-refactor.plan.md) | Agent/KB 重构计划（模块拆分/缓存提取） |
| [agent-kb-refactor.status](./plan/agent-kb-refactor.status.md) | Agent/KB 重构状态（✅ 完成） |
| [fix-web-search-loop.plan](./plan/fix-web-search-loop.plan.md) | web_search 死循环修复计划（✅ 完成） |
| [embedding-architecture](./plan/embedding-architecture.md) | Embedding 多提供商架构设计 |
| [indexing-compatibility](./plan/indexing-compatibility.md) | 索引流程兼容性设计（多提供商适配） |

## 测试报告

| 文档 | 说明 |
|------|------|
| [spec-edit-ft](./testing/spec-edit-ft.tdd.md) | 浮动工具栏 TDD（SPEC-EDIT-FT） |
| [spec-edit-ft2](./testing/spec-edit-ft2.tdd.md) | 行内格式 TDD（SPEC-EDIT-FT2） |
| [spec-edit-ft3](./testing/spec-edit-ft3.tdd.md) | 叠加收敛 TDD（SPEC-EDIT-FT3） |
| [spec-edit-ft4](./testing/spec-edit-ft4.tdd.md) | 格式应用交互修正 TDD（SPEC-EDIT-FT4） |
| [spec-edit-cbtp](./testing/spec-edit-cbtp.tdd.md) | 代码块尾随空行 TDD（SPEC-EDIT-CBTP） |
| [spec-edit-dsf](./testing/spec-edit-dsf.tdd.md) | 拖选闪烁 TDD（SPEC-EDIT-DSF） |

## 重构报告

| 文档 | 说明 |
|------|------|
| [agent-kb-refactor](./refactor/agent-kb-refactor.refactor.md) | Agent/KB/工具重构报告（2026-09-10 ✅ 完成） |
