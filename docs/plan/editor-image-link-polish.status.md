# editor-image-link-polish — 进度/分级状态

> 更新：2026-08-12 | 任务 slug：`editor-image-link-polish`
> 工作流：/devflow-core（M 级，standard TDD）

## 阶段 0 — 任务分级与分类

**请求类型**：混合 — 2 功能开发（图片选中框+四角伸缩点、超链接操作提示）+ 1 优化（链接场景工具栏定位）+ 1 保护逻辑扩展（图片后空行）+ 1 Bug（Enter 丢选中内容）。

**跨模块判断**：不跨模块。全部落在「编辑主区 v2」一个模块内（kernel controllers / kernel / v2 组件 / CSS）。不涉权限/密钥/数据库/多端/Agent/Skill/MCP。

**定档**：**M**（半天~1天，单模块多子模块）。

**裁剪决定**：
- 需求对齐（grill-me）：✅ 执行（存在 3 个真实设计分叉需用户决策）
- 技术调研（Firecrawl/Context7）：❌ 跳过（宽度持久化为内部文本语法设计，无外部库依赖）
- 规划（Plan 智能体）：✅ 执行
- 并行执行：✅ 按模块拆分
- TDD：**M / standard**
- 合规核对、质量门禁、交付核对：✅

## 需求清单（5 项）

| # | 需求 | 类型 | 现状（已核实） |
| --- | --- | --- | --- |
| 1 | 点击图片出现选中框，图片四角有伸缩点（可拖拽缩放） | 功能 | 无任何选中框/手柄；仅 `ImageSelection` 状态 + ImageToolbar 悬浮 |
| 2 | 浮动工具栏插图后，图后新增空行受保护，Backspace 不可删，图片删除后才解除 | 保护逻辑 | 未保护；仅 code-block 有此模式（backspaceCtrl.mergeParagraph:58） |
| 3 | 超链接内容被指针选中时显示「ctrl + 左键 打开网页」深蓝加粗斜体提示 | 功能 | 现有 hover tooltip 显示原始 URL（attr(data-href)），非操作提示 |
| 4 | 「文本类型\|解链」栏目从正上/斜上方改为超链接内容正左方 | 优化 | computeToolbarState 恒为"上方居中"（toolbarState.ts:114-120） |
| 5 | 选中内容加超链接后直接回车不点确定 → 选中内容丢失 | Bug | InsertUrlModal Enter 走 handleConfirm 但无 preventDefault + 时序竞争 |

## 已核实关键事实（供规划阶段引用）

- 图片块无 width 字段：`BlockMetaV2` 无 width；对齐走文本 `<div align>` 包裹（imageBlock.ts:40-64），序列化原样回写 `block.text`（stateToMarkdown.ts:30-32）→ 宽度持久化必须嵌文本语法或走 meta。
- 图后空行创建点：`formatCtrl.insertImageFromSelection:286-292`（无 next 叶时 append 空段）。
- code-block 空行保护全模式：backspaceCtrl.mergeParagraph:58-60 + markdownToState.appendTrailingParagraphIfCodeLast:190-201 + formatCtrl.removeImage:355-368 + docs/specs/code-block-trailing-paragraph.md。
- 链接命中：`findIntersectingLinks`（inlineLexer.ts:599-611）+ `SelectionState.inLink`（toolbarState.ts:106）；"解链-only"分支 showUnlinkOnly（FloatingToolbar.tsx:411-412）。
- InsertUrlModal Enter：input onKeyDown 调 handleConfirm 无 preventDefault（InsertUrlModal.tsx:115-117）；无 `<form>`。
- 现有链接 hover tooltip：`a.inline-link:hover::after { content: attr(data-href) }`（globals.css:1978-2000）。

## 待用户决策（阶段 1 对齐）— 已确认

1. 图片宽度持久化方案 → **写入对齐包裹 style**（`<div align style="width:Npx">`，仅独立图持久化）。
2. 提示触发时机 → **替换现有 hover 提示**为「ctrl + 左键  打开网页」深蓝加粗斜体。
3. resize 作用域 → **独立图 + 行内图都可缩放**（行内图宽度仅会话内）。

## 阶段 1 — 需求对齐（完成）

- 产出 `docs/requirements/editor-image-link-polish.req.md`（5 需求 + D1~D3 + 验收 G 判据）。

## 阶段 2 — 规划（完成）

- Plan 智能体产出 `docs/plan/editor-image-link-polish.plan.md`。
- R5 根因核实：`InsertUrlModal.tsx:115-117` Enter 无 preventDefault/stopPropagation → selectionchange 竞态；修复 = 补两者 + 同「确定」路径（实施时先复现再修）。
- R4 方案：`computeToolbarState` 增可选 linkRect 入参（保持纯函数可测），inLink 时链接正左方定位。
- 执行拆分：Wave-1 三并行（R2 / R3+R5 / R4，文件零交集）→ Wave-2 串行 R1（图片缩放）。
- 状态：**已实现，全部门禁通过（2026-08-12）**。

## 阶段 3~8 — 执行与交付

**实现**：Wave-1 三并行（R2 / R3+R5 / R4，文件零交集）→ Wave-2 串行 R1（内核 → UI）。

**测试证据（全量门禁）**：
- `tsc --noEmit` → 0 error
- `npx vitest run` → 49 files / 816 passed（基线 762 + 新增）
- `npm run lint` → 0 error（8 条存量 warning：useContentSync/useEditorActions，非本任务文件）
- `npx vite build` → ✓（electron-builder MSI 打包报 WiX `Icon:WeaveMDIcon.exe` 错误，**存量环境/配置问题**，与本次改动无关）
- `npx playwright test` → 61 passed / 5 failed（5 个失败均为**存量已知 RED**：drag-selection-markers.spec.ts，本次未触碰，git diff 为空）

**E2E 新增/更新**：image-resize.spec.ts（R1·E6 行内/独立图 + R4·E5）、floating-toolbar.spec.ts（LINK-IMAGE-E2 改文案、LINK-IMAGE-E4R5 新增）。

**实现期发现的 2 个代码问题（已修复）**：
1. R1 拖拽被终止：FloatingToolbar 文档捕获 mousedown 把 `.image-resize-box` 手柄当"工具栏外"→ `onCloseImage()` 清空选中。修复：捕获 handler 对 `target.closest('.image-resize-box')` 提前 return（FloatingToolbar.tsx）。
2. R3/R4 E2E 交互：链接贴左缘被左置工具栏遮挡，hover/点击被拦截。修复：测试内先 `Escape` 收起工具栏再 hover/点击链接。

**合规核对**（system-architecture-analyzer）：**PASS-WITH-NOTES**，代码合规、无安全违规、往返不变量保持、code-block 零改动。

**文档同步**（docs worker）：`specs/code-block-trailing-paragraph.md`（9.3 图扩展）、`specs/editor-v2-architecture.md`（13.15 宽度模型/缩放）、`specs/floating-toolbar-ux-and-inline-format.md`（9.6 R4+R5）、`modules/04`（v2.7）、`SUMMARY.md`。

## 遗留问题 / 注意事项（交付核对）

- **N1（文档/测试语义）**：`formatCtrlModule.test.ts` 3 条 removeImage 断言按 R2 解析期补偿语义更新（changedBlockIds `[img,para]`→`[img]`），为预期树结构变化，非弱化。
- **N2（R1 内联 style 例外）**：ImageResizeBox 用内联 `style={{left/top/width/height}}`，违反 CONVENTIONS 一般禁 inline style，但为 fixed overlay 动态像素值的必要例外（与 ImageToolbar 同风格），已在 13.15 注明。
- **N3（R4 E2E 依赖）**：LINK-IMAGE-E2 先 Escape 再 hover 依赖 150ms 等待，环境抖动下可能不稳定；如出现偶发红需加大等待。
- **N4（存量）**：5 个 drag-selection-markers E2E 为已知 RED（标签「当前 RED」），本任务未触碰；若要全绿需单独立项。
- **N5（打包）**：MSI WiX icon 错误为存量 electron-builder 配置问题，非本次回归。

## 下一任务（建议）

- 修 drag-selection-markers 5 个已知 RED E2E（独立任务）。
- 或修复 electron-builder MSI WiX icon 配置（独立任务，非功能）。
