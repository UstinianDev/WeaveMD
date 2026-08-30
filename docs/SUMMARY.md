# WeaveMD 文档索引

> 最后更新：2026-08-29（文档整理完成）

## 核心文档

| 文档 | 说明 |
|------|------|
| [README](../README.md) | 项目简介、技术栈、运行方式 |
| [REQUIREMENTS](./REQUIREMENTS.md) | 功能需求文档（AUTH/EDIT/NAV/FILE/EXP/UI/AGT/KB/WC） |
| [TODO](./TODO.md) | 功能进度与已知问题 |

## 模块文档

| 文档 | 说明 |
|------|------|
| [01-加载页面](./modules/01-加载页面-Splash.md) | 启动动画 |
| [02-认证系统](./modules/02-认证系统-Auth.md) | 注册/登录/JWT/多账号 |
| [03-顶部导航栏](./modules/03-顶部导航栏-Navbar.md) | 菜单/导出/视图切换 |
| [04-编辑主区](./modules/04-编辑主区-Editor.md) | v2 块树内核架构 |
| [05-设置界面](./modules/05-设置界面-Settings.md) | 主题/AI/知识库设置 |
| [06-窗口控制](./modules/06-窗口控制-Window.md) | Frameless 窗口 |
| [07-数据持久化层](./modules/07-数据持久化层-Database.md) | SQLite + better-sqlite3 |
| [08-IPC通信机制](./modules/08-IPC通信机制.md) | 白名单通道 + contextBridge |
| [09-国际化](./modules/09-国际化-i18n.md) | 中文简繁 + 英文 |
| [10-导出功能](./modules/10-导出功能-Export.md) | 8 格式导出 |
| [11-AI代理面板](./modules/11-AI代理面板-Agent.md) | Chat/Agent/知识库/R1-R12 对齐 |

## 规格文档

| 文档 | 说明 |
|------|------|
| [editor-v2-architecture](./specs/editor-v2-architecture.md) | v2 块树架构设计 |
| [editor-v2-progress](./specs/editor-v2-progress.md) | v2 实施记录 |
| [editor-v2-features](./specs/editor-v2-features.md) | v2 功能清单 |
| [editor-v2-selection-undo](./specs/editor-v2-selection-undo.md) | 选区/撤销设计 |
| [markdown-block-exit-rules](./specs/markdown-block-exit-rules.md) | 六条退出规则 |
| [floating-toolbar-ux](./specs/floating-toolbar-ux-and-inline-format.md) | 浮动工具栏 UX |
| [floating-toolbar-refactor](./specs/floating-toolbar-refactor.md) | 工具栏重构记录 |
| [code-block-trailing-paragraph](./specs/code-block-trailing-paragraph.md) | 代码块尾随空行 |
| [drag-selection-flicker](./specs/drag-selection-flicker.md) | 拖选闪烁优化 |
| [editor-refactor-technical-debt](./specs/editor-refactor-technical-debt.md) | 编辑器技术债务 |
| [ai-panel-features](./specs/ai-panel-features.md) | AI 面板功能清单 |

## 测试报告

| 文档 | 说明 |
|------|------|
| [spec-edit-ft](./testing/spec-edit-ft.tdd.md) | 浮动工具栏 TDD |
| [spec-edit-ft2](./testing/spec-edit-ft2.tdd.md) | 行内格式 TDD |
| [spec-edit-ft3](./testing/spec-edit-ft3.tdd.md) | 叠加收敛 TDD |
| [spec-edit-ft4](./testing/spec-edit-ft4.tdd.md) | 相邻混合强调 TDD |
| [spec-edit-cbtp](./testing/spec-edit-cbtp.tdd.md) | 代码块尾随空行 TDD |
| [spec-edit-dsf](./testing/spec-edit-dsf.tdd.md) | 拖选闪烁 TDD |

## Devflow 产出（计划/需求）

| 文档 | 说明 |
|------|------|
| [plan/](./plan/) | 实施计划与状态记录 |
| [requirements/](./requirements/) | 需求文档 |

## 其他

| 文档 | 说明 |
|------|------|
| [guide/packaging](./guide/packaging.md) | 打包与发布指南 |
