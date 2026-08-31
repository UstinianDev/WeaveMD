# WeaveMD 文档索引

> 最后更新：2026-08-31

## 核心文档

| 文档 | 说明 |
|------|------|
| [README](../README.md) | GitHub 项目主页（功能介绍、下载安装、开发指南） |
| [REQUIREMENTS](./REQUIREMENTS.md) | 功能需求文档 |
| [TODO](./TODO.md) | 功能进度与已知问题 |
| [packaging](./guide/packaging.md) | 打包与发布指南 |

## 模块文档

| 文档 | 说明 |
|------|------|
| [01-加载页面](./modules/01-加载页面-Splash.md) | 启动动画 |
| [02-认证系统](./modules/02-认证系统-Auth.md) | 注册/登录/JWT/多账号 |
| [03-顶部导航栏](./modules/03-顶部导航栏-Navbar.md) | 图标菜单/撤销/重做/设置 |
| [04-编辑主区](./modules/04-编辑主区-Editor.md) | v2 块树内核架构 |
| [05-设置界面](./modules/05-设置界面-Settings.md) | UnifiedSettings 8 Tab + 主题系统 |
| [06-窗口控制](./modules/06-窗口控制-Window.md) | Frameless 窗口 + 自动更新 |
| [07-数据持久化层](./modules/07-数据持久化层-Database.md) | SQLite 16+ 表（核心 + AI/Agent/配置） |
| [08-IPC通信机制](./modules/08-IPC通信机制.md) | 80+ 通道（9 组：Auth/File/Settings/AI/KB/Agent...） |
| [09-国际化](./modules/09-国际化-i18n.md) | 中文简繁 + 英文 |
| [10-导出功能](./modules/10-导出功能-Export.md) | 8 格式导出 |
| [11-AI代理面板](./modules/11-AI代理面板-Agent.md) | Agent/知识库/改写/写控制 |

## 规格文档

| 文档 | 说明 |
|------|------|
| [editor-v2-architecture](./specs/editor-v2-architecture.md) | v2 块树架构设计 |
| [editor-v2-progress](./specs/editor-v2-progress.md) | v2 实施记录 |
| [editor-v2-features](./specs/editor-v2-features.md) | v2 功能清单 |
| [ai-panel-features](./specs/ai-panel-features.md) | AI 面板功能清单 |
| [markdown-block-exit-rules](./specs/markdown-block-exit-rules.md) | 六条退出规则 |
| [floating-toolbar-ux](./specs/floating-toolbar-ux-and-inline-format.md) | 浮动工具栏 UX |

## 测试报告

| 文档 | 说明 |
|------|------|
| [spec-edit-ft](./testing/spec-edit-ft.tdd.md) | 浮动工具栏 TDD |
| [spec-edit-ft2](./testing/spec-edit-ft2.tdd.md) | 行内格式 TDD |
| [spec-edit-ft3](./testing/spec-edit-ft3.tdd.md) | 叠加收敛 TDD |
| [spec-edit-cbtp](./testing/spec-edit-cbtp.tdd.md) | 代码块尾随空行 TDD |
| [spec-edit-dsf](./testing/spec-edit-dsf.tdd.md) | 拖选闪烁 TDD |
