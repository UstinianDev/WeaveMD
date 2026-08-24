# WeaveMD 项目总结

> 版本：v3.14 | 最后更新：2026-08-24

## 1. 项目概览

WeaveMD 是基于 Electron 的本地 Markdown 可视化笔记应用（离线优先、本地存储、多账号隔离）。

| 属性     | 值                                                                 |
| -------- | ------------------------------------------------------------------ |
| 桌面框架 | Electron + Vite + Electron Builder                                 |
| 前端     | React 18 + TypeScript + Tailwind                                   |
| 状态管理 | Zustand v4                                                         |
| 数据存储 | SQLite（better-sqlite3）                                           |
| 编辑器   | 自研块树内核（v2，照搬 marktext/muya 架构）+ Monaco（Source 模式） |

## 2. 模块文档索引

| 模块       | 文档                                                                         | 核心内容                                     |
| ---------- | ---------------------------------------------------------------------------- | -------------------------------------------- |
| 加载页面   | [modules/01-加载页面-Splash.md](./modules/01-加载页面-Splash.md)             | 启动动画、跳转机制                           |
| 认证系统   | [modules/02-认证系统-Auth.md](./modules/02-认证系统-Auth.md)                 | 注册/登录、JWT、多账号隔离                   |
| 顶部导航栏 | [modules/03-顶部导航栏-Navbar.md](./modules/03-顶部导航栏-Navbar.md)         | 菜单、快捷键、窗口控制、文件系统同步         |
| 编辑主区   | [modules/04-编辑主区-Editor.md](./modules/04-编辑主区-Editor.md)             | 双模式编辑、块树、浮动工具栏、导航/查找/撤销 |
| 设置界面   | [modules/05-设置界面-Settings.md](./modules/05-设置界面-Settings.md)         | 语言、主题、账号                             |
| 窗口控制   | [modules/06-窗口控制-Window.md](./modules/06-窗口控制-Window.md)             | frameless 窗口、IPC、拖拽区                  |
| 数据持久化 | [modules/07-数据持久化层-Database.md](./modules/07-数据持久化层-Database.md) | SQLite Schema、CRUD、文件保存                |
| IPC 机制   | [modules/08-IPC通信机制.md](./modules/08-IPC通信机制.md)                     | 安全架构、preload 类型定义                   |
| 国际化     | [modules/09-国际化-i18n.md](./modules/09-国际化-i18n.md)                     | Provider、多语言                             |
| 导出功能   | [modules/10-导出功能-Export.md](./modules/10-导出功能-Export.md)             | 8 格式导出                                   |
| AI 代理面板 | [modules/11-AI代理面板-Agent.md](./modules/11-AI代理面板-Agent.md)           | 双智能体、知识库、块级改写、KB 参数持久化    |

## 3. 编辑主区 v2 与 AI 面板（功能清单）

详细功能实现记录已拆分到 specs/：

- [编辑主区 v2 功能清单](./specs/editor-v2-features.md) — 块树内核、浮动工具栏、行内格式、跨块拖选、图片、表格等全部功能
- [AI 面板功能清单与交付记录](./specs/ai-panel-features.md) — 第 1~7 期交付时间线、后端收敛 remote-only、延期项

架构与进度文档：

- [editor-v2-architecture.md](./specs/editor-v2-architecture.md) — v2 架构设计
- [editor-v2-progress.md](./specs/editor-v2-progress.md) — v2 实施进度（spec 13.x）
- [markdown-block-exit-rules.md](./specs/markdown-block-exit-rules.md) — 六条退出规则
- [floating-toolbar-ux-and-inline-format.md](./specs/floating-toolbar-ux-and-inline-format.md) — 浮动工具栏 UX
- [floating-toolbar-format-sticky.md](./specs/floating-toolbar-format-sticky.md) — 格式粘滞
- [drag-selection-flicker.md](./specs/drag-selection-flicker.md) — 拖选闪烁优化
- [code-block-trailing-paragraph.md](./specs/code-block-trailing-paragraph.md) — 代码块尾随空行
- [editor-refactor-technical-debt.md](./specs/editor-refactor-technical-debt.md) — 重构技术债

### 重构记录

- [AI 模块重构·需求](./requirements/ai-module-refactor.req.md) — consent 统一 / 死代码清理 / SSE 去重 / IPC 拆分 / stream 提取
- [AI 模块重构·计划](./plan/ai-module-refactor.plan.md) — 实施计划与变更清单
- [AI 模块重构·报告](./refactor/ai-module-refactor.refactor.md) — 前后对比与验证证据

### AI 面板体验优化（2026-08-21）

- [需求文档](./requirements/ai-panel-adjustments.req.md) — 8 项 UI 调整需求
- [实施计划](./plan/ai-panel-adjustments.plan.md) — 变更清单与验收标准
- [任务状态](./plan/ai-panel-adjustments.status.md) — 全部完成（tsc 0 | vitest 1492 | lint 0）

### Notus Agent 克隆（2026-08-24）

深度模仿 Notus 项目的 AI Agent 功能，采用完全替换策略，21 项功能全部实现：

- [差距分析](./plan/notus-agent-clone.analysis.md) — 21 项功能差距，P0/P1/P2 分级
- [实施计划](./plan/notus-agent-clone.plan.md) — 5 个 Phase，变更清单与验收标准
- [设计决策](./plan/notus-agent-clone.design.md) — 黑客帝国极客美学风格
- [任务状态](./plan/notus-agent-clone.status.md) — 全部完成

**核心交付物**：
- 持久化任务队列（SQLite FIFO，同会话串行）
- Agent Session 状态机（11 种状态）
- Checkpoint/Resume 系统（断线可恢复）
- SSE 事件持久化+回放
- 文件快照+回滚
- 死循环检测
- 结构化提问卡片（ClarifyDrawer）
- 多文件补丁预览（PatchPreviewDialog）
- 联网搜索工具（集成 searchClient）
- 6 个新 Agent 工具（共 13 个）

## 4. 验证与测试

- **Vitest**：1497 例（内核/控制器/组件/Store/IPC/Agent，含往返不变式、退出规则矩阵、格式化、拖选、图片、表格、AI 面板、任务队列）
- **Playwright E2E**：76+ 例（输入/IME/富文本渲染/语法外观/浮动工具栏/跨块拖选/图片/表格）
- **质量门禁**：`tsc --noEmit` + `vitest run` + ESLint(0 error) + `vite build` + `npx playwright test` + 覆盖率 ≥80%

## 5. 文档索引

- [README](./README.md) — 项目简介、技术栈、运行方式
- [TODO](./TODO.md) — 功能进度、已知问题
- [REQUIREMENTS](./REQUIREMENTS.md) — 功能需求文档
- [TECH_STACK](./TECH_STACK.md) — 技术选型文档

## 6. 已知限制

详见 [editor-v2-progress.md §13.x](./specs/editor-v2-progress.md)：

- v2 Normal 无查找高亮
- 撤销/重做后光标回到重建树首块
- 段落级 MD Source 视图未迁移
