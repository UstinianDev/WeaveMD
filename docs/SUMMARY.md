# WeaveMD 项目总结

> 版本：v3.10 | 最后更新：2026-08-14

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
| 导出功能   | [modules/10-导出功能-Export.md](./modules/10-导出功能-Export.md)             | 8 格式导出（md/html/pdf/doc/docx/png/jpg/jpeg）|

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
- 拖选闪烁优化（SPEC-EDIT-DSF，v0.1 已实施）：`lastAppliedRangeRef` 端点级变化检测（端点
  全等跳过写入，静止不再重建 selection）+ `selectionchange` rAF 合并（工具栏渲染 ≤ 每帧一次）
  + 一致性判定短路/上限（`resolveSyntaxTypesInRange` 边枚举边比对，反向多类型 O(1) 判定）
- 行内格式化增强（SPEC-EDIT-FT2，v1.0 已实施）：inlineLexer 结构化 token 识别 +
  underline/math/image 渲染（KaTeX）；`formatRange` 双形态 toggle（加粗两次回原文，永不产生
  `****`）；橡皮擦清除选区全部标记；工具栏分组（字符格式/对象插入/橡皮擦）+ 共享
  `isBoundedWrap` activeTest；`.md-syntax` 方案 B（默认隐藏、聚焦灰显）、`==高亮==` 黄色
  highlight 主题变量、工具栏尺寸收敛 globals.css；Ctrl+U / Ctrl+Shift+M 快捷键
- 格式应用交互修正（SPEC-EDIT-FT3，v1.0 已实施）：Step 0 选区归一化（选中渲染内容及部分
  语法符号再点格式 → 解除，绝不叠加 `****…****`/`====…====`）；跨多个同风格 token 的选区
  逐 token 拆分解除（C10，case A 内容内部分选区一并补全）；跨风格叠加（C12：加粗后再斜体
  生成三连 `***`，lexer 解析为 em 内嵌 strong 并渲染，解除逐层剥离）；格式应用后恢复选区
  保持选中、工具栏驻留（点击工具栏外/滚动/Escape/键入退出，块转换仍退出）；工具栏尺寸
  回调（按钮 32×28px、字号 13px、总高 ≤34px）
- 跨风格叠加与拖选标记安全（SPEC-EDIT-FT4 / PLAN-EDIT-FT4，v1.0 已实施）：选区含**异风格**
  边界标记（`**123**` 选 `3**` 点斜体）折叠到纯内容再叠加（formatCtrl `foldCrossStyleMarkers`，
  U1 叠加语义），lexer 支持相邻混合强调（`**12*3***` → strong 内嵌 em，close run 拆分），
  纯内容部分选区（`**abc**` 选 `ab`）同样归一化合并（U6）；删除/光标路径标记偏移安全——
  `snapSelectionToContent`/`deleteSelectionContent`/`snapOffsetInText` + ContentBlock keydown 拦截
   （选 `粗**` 退格 → `**加**`；方向键落入标记内吸附内容边界，键入不分裂标记）；e2e FT4-E1/E2 +
   DSG-R1/R2/R3/P 共 7 例转正
- FT4 收尾增量（2026-08-09）：lexer 支持 **open 三连拆分**（`***12*3**` = strong 内嵌 em，
  对应 `**123**` 选内容前部 `12` 点斜体的产物，渲染无字面 `*` 残体、再点回退）；根容器
  `onDragStart` preventDefault **禁用原生拖拽移动选区**（含标记选区不被拖走破坏语法，
  跨块拖选不受影响，e2e `drag-selection-move.spec.ts`）
- 链接渲染与本地图片显示（REQ-EDIT-LINK-IMAGE，2026-08-11）：`safeUrl` 放行裸域名 +
  `normalizeHref` 无协议链接自动补 `https://`（渲染 href/data-href 补全、`.md-syntax` 保留
  原始 → textContent 与源一致）；本地图片走自定义 `media://` 协议（主进程
  `media-protocol.ts` 映射本地文件，dev/prod 一致显示，不再受 `file://` 跨协议/CSP 阻止；
  **2026-08-12 修复**：特权集去除 `standard`，盘符编码进 host 不被 Chromium 拒绝，完整 app
  本地图加载成功）、CSP `img-src` 放行 `https: http: media:`、加载失败事件委托回退
  `.inline-image-fallback` 占位（无 broken 图标）；链接 hover tooltip 修复为
  `attr(data-href)` 显示完整 URL（原 `--link-tip` 未定义失效），Ctrl+Click 打开不变
- 图片直选插入与图片工具栏（K3~K7，2026-08-11）：工具栏「图片」→ 系统文件框直选（取消
  no-op），选中文本替换为图片（alt=选中文本，空格→`%20`）；`image-block` 原子块模型
  （K1/K2）+ `toImgSrc` 单层解码修复（`%20` 不再 `%2520` 双重编码）；点击图片 → 图片工具栏
  （修改图片/内联图片/居左/居中/居右/移除图片）替换文本工具栏，行内图对齐/内联置灰、
  独立成块可对齐（源码 `<div align>` 包裹）；修改图片弹层预填 src/alt
- 图片缩放与图片后空行、链接提示与工具栏定位（R1~R5，2026-08-12）：点击图片显示四角
  缩放手柄（`.image-resize-box`，拖拽实时 DOM-only 缩放，独立图 `setImageWidth` 写
  `<div align style="width:Npx">`、行内图写会话 `BlockWidthMap`）；图片后空行受保护
  （SPEC-EDIT-CBTP 扩展到 image-block，`appendTrailingParagraphIfLast`）；链接 hover
  提示「ctrl + 左键  打开网页」；链接场景工具栏定位到链接正左方（`computeToolbarState`
  `linkRect` 参数）；InsertUrlModal 回车直接确认修复选中内容丢失竞态
- 图片缩放三缺陷修复（REQ-EDIT-IMAGE-RESIZE-FIX，2026-08-13）：等比例拖拽改「跟随指针
  位移」——宽度增量 = `√(dx²+dy²)`（方向取主轴向符号），斜向按对角距离顺滑增长；
  松手提交后选中框重锚定（`useLayoutEffect` 每次渲染后重查 img rect，修复"框比图小"）；
  宽度落点从外层 div 移到 `<img>` 自身（`renderImageBlock` 经 `applyImgWidth` 注入），
  小图可放大、无溢出、居中/居右（含带宽度图）正确。文档：`docs/specs/editor-v2-architecture.md`
  13.15、`docs/plan/editor-image-resize-fix.*`
- 跨块选区替换输入（2026-08-13）：字符输入/IME/粘贴跨块选区时，浏览器原生删除只改 DOM、
  `onInput` 仅同步焦点块模型 → 其余块重渲染"复活"。ContentBlock 原生 `beforeinput` 拦截 +
  `onPaste`，经 `replaceLeafRange`（blockTree.ts）块树级删除 + 插入收敛单块。文档：
  `e2e/cross-block-replace-input.spec.ts`（R1/R2）
- 编辑主区纯重构（REQ-EDITOR-TOOLBAR-IMAGE-LINK，2026-08-13）：删 `ImageToolbar.scheduleHide`
  死代码；`imageAnchor.ts`（findImageEl/readImageRect）收敛 ImageToolbar/ImageResizeBox 滚动
  重锚定重复；`modalConstants.ts` 收敛双份 `EMPTY_URL_MESSAGE`。断言零修改、845 全绿。
  文档：`docs/plan/editor-toolbar-image-link-refactor.*`、`docs/refactor/editor-toolbar-image-link.refactor.md`
- 文件树切换保存修复（2026-08-14）：FileTreePanel 切换前统一 `saveCurrentDraftIfNeeded()`
  （`services/saveCurrentDraft.ts`，flush + dirty 落盘，与 Navbar 一致）；点击当前文件 no-op；
  打开总 readDisk 以磁盘为真源（陈旧缓存不再覆盖新内容）；`saveFile` 返回 boolean（写盘失败
  保留 dirty）；Source 模式 `flushContent` 强制 flush Monaco 防抖内容。文档：
  `docs/plan/fix-file-switch-save-loss.status.md`

## 4. 验证与测试

- Vitest：**919 例**（内核/控制器/组件，含往返不变式、退出规则矩阵、输入链路、跨块删除、
  代码块尾随空行补偿、浮动工具栏显示/转换矩阵/驻留、拖选闪烁的端点变化检测与 rAF 节流、
  FT2 的 inlineLexer/strip/katex/toggle/clearFormat、FT3 的 Step0 归一化矩阵/跨 token 拆分/
  选区恢复/集成、三连 `***` 跨风格叠加、CSS 静态断言、快捷键接线、
  FT4 的 formatCtrl 跨风格折叠/相邻混合强调/两两组合渲染/selection 标记吸附/ContentBlock 删除与方向键吸附/
  open 三连拆分/拖拽禁用事件断言、图片 imageBlock 解析/直选插入/对齐/内联/移除/replace、
  media:// 协议 decode 与特权集不含 standard 断言、图片工具栏滚动重锚定（Bug B）、
  removeImage 代码块尾随空段补偿（Bug C）三布局 + 往返、跨块替换输入 replaceLeafRange）
- Playwright 真实 Chromium E2E：**76 例（71 通过 + 5 既有红，含跨块替换输入 2 例新增）**（输入/IME/富文本渲染/语法外观/退出与退格链/
  浮动工具栏/跨块拖选/代码块尾随空行重载恢复/反向跨类型拖选与 selectionchange 收敛/
  FT2 工具栏计算样式/标记隐藏与聚焦灰显/黄色高亮/下划线/图片/数学/橡皮擦/
   FT3 部分标记不叠加/跨多 token 逐 token 解除/加粗后斜体叠加渲染/工具栏驻留与点击外/Escape 退出/
   FT4 跨风格叠加无字面残体（E1/E2）与拖选含标记删除/格式化/光标恢复无移位（DSG-R1/R2/R3/P）/
   原生拖拽移动选区禁用（drag-selection-move）/
   图片直选插入/取消 no-op/图片工具栏全链路/行内图对齐置灰（LINK-IMAGE-E3/E4/E5/E6、FT2-E6/E9）/
   图片工具栏滚动跟随（LINK-IMAGE-E7，Bug B）/代码块+图片打开→移除→保护空行恢复（Bug C）/
   跨块选区输入替换（R1/R2，cross-block-replace-input.spec.ts）；
   5 个既有红为 drag-selection-markers.spec.ts 跨任务缺陷）
- 质量门禁：`tsc --noEmit` + `vitest run` + ESLint(0 error) + `vite build` + `npx playwright test`
  + `vitest --coverage`（改动文件口径 ≥80%，当前全量 95.45%；`@vitest/coverage-v8`）

> 各模块详细实现见 `docs/modules/`，需求见 `docs/REQUIREMENTS.md`，技术选型见 `docs/TECH_STACK.md`。
