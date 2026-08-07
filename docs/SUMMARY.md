# WeaveMD 项目总结

> 版本：v3.5 | 最后更新：2026-08-08

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
| 导出功能   | [modules/10-导出功能-Export.md](./modules/10-导出功能-Export.md)             | MD/Word/PDF 导出                             |

## 3. 编辑主区 v2（当前主线）

编辑主区已按 marktext/muya 架构完成深度重做（M1-M4 完成），详见
[specs/editor-v2-architecture.md](./specs/editor-v2-architecture.md) 与
[specs/markdown-block-exit-rules.md](./specs/markdown-block-exit-rules.md)：

- 不可变块树内核 + 无损双向转换；仅叶子内容块 contentEditable（按需重渲染、IME 守卫）
- 语法渲染对齐 marktext：标题 `#`×n 提示、深灰列表 marker、圆形任务复选框、引用绿色竖线，符号不可选中
- 六条退出规则 + 退格链；代码块一键删除/受保护空行（重载后经解析期补偿恢复，SPEC-EDIT-CBTP）
- 浮动工具栏（SPEC-EDIT-FT，v1.0 已实施）：仅单一语法类型选区显示（G1）；自定义块类型下拉
  可展开（G3①），段落/标题/代码块/引用/三类列表一一正确对应（G3②），不可转目标置灰；
  块转换按 `canConvertBlock` 矩阵分发（kernel/syntaxType.ts 提供 `resolveSyntaxType`）
- 跨块鼠标拖选（rAF 节流 + 反向端点交换 + 非内容区回退，正向/反向均跨块）+ 块树级删除；
  **v1 回退路径已退役**（v2 唯一路径）

## 4. 验证与测试

- Vitest：289 例（内核/控制器/组件，含往返不变式、退出规则矩阵、输入链路、跨块删除、
  代码块尾随空行补偿、浮动工具栏显示/转换矩阵）
- Playwright 真实 Chromium E2E：28 例（输入/IME/富文本渲染/语法外观/退出与退格链/
  浮动工具栏/跨块拖选/代码块尾随空行重载恢复）
- 质量门禁：`tsc --noEmit` + `vitest run` + ESLint(0 error) + `vite build` + `npx playwright test`

> 各模块详细实现见 `docs/modules/`，需求见 `docs/REQUIREMENTS.md`，技术选型见 `docs/TECH_STACK.md`。
