# 图片选中缩放与超链接交互优化需求

> 需求编号：REQ-EDIT-IMAGE-LINK-POLISH | 状态：待确认 | 更新：2026-08-12
> 关联需求：EDIT-12（超链接交互）、EDIT-13；关联模块：docs/modules/04-编辑主区-Editor.md
> 关联规范：SPEC-EDITOR-V2（往返不变量）、SPEC-EDIT-CBTP（受保护空行模式）、SPEC-EDIT-FT（浮动工具栏）
> 前置任务：`editor-link-image-fix`（已完成：media:// 协议、链接渲染、URL hover 提示）
> 任务名：`editor-image-link-polish`

---

## 1. 背景

编辑主区 v2 图片与超链接交互有 5 项待优化（用户实测反馈）：

| # | 现象 |
| --- | --- |
| 1 | 点击图片只有悬浮工具栏，没有选中框，也没有四角伸缩点，无法调整图片大小 |
| 2 | 工具栏插入图片后，图片后的空行可被 Backspace 合并删掉，导致光标/布局异常 |
| 3 | 悬停超链接只显示原始 URL，不提示「ctrl + 左键 打开网页」操作方式 |
| 4 | 点击超链接出现的「文本类型\|解链」工具栏位置不定（正上/斜上方），期望在链接内容正左方 |
| 5 | 选中内容→添加超链接→不点确定直接回车，选中内容会丢失（Bug） |

## 2. 已确认的设计决策（用户已选定）

| # | 决策 | 内容 |
| --- | --- | --- |
| D1 | 宽度持久化 | 独立图宽度写入对齐包裹 `<div align="X" style="width:Npx">`，与现有对齐机制一致、往返无损；行内图宽度仅会话内生效（运行时 map），不持久化 |
| D2 | 提示触发 | 替换现有 hover 提示（不再显示原始 URL），改为深蓝加粗斜体「ctrl + 左键  打开网页」，控制字号与字符间距 |
| D3 | 缩放作用域 | 独立图 + 行内图点击均出现选中框与四角伸缩点，均可拖拽缩放 |

## 3. 需求清单与验收要点

### R1 图片选中框 + 四角伸缩点（功能）

- **目标**：点击图片出现选中框（图片外轮廓），四角有伸缩点（nw/ne/sw/se），可拖拽缩放宽度，高度按比例自动。
- **验收**：
  - G1 点击独立图/行内图 → 图片四周出现可见选中框 + 四角手柄。
  - G2 拖拽任一角手柄 → 图片宽度实时变化（高度 `auto` 等比），松开提交。
  - G3 有宽度下限（如 32px）与上限（容器宽度，不超出）。
  - G4 独立图缩放后：`block.text` 变为 `<div align="X" style="width:Npx">![alt](src)</div>`，`stateToMarkdown(markdownToState(M)) === M` 保持（往返无损）；对齐切换（居左/中/右）不丢宽度。
  - G5 行内图缩放后：会话内宽度保持（运行时 map，重载后按 D1 恢复原始尺寸）；不影响块树文本。
  - G6 选中框/手柄不干扰文字选中与图片工具栏交互；滚轮/滚动时选中框跟随。

### R2 图片后空行受保护（保护逻辑，镜像 SPEC-EDIT-CBTP）

- **目标**：浮动工具栏插入独立图后自动追加的空行受保护，Backspace 不可删除该空行；图片被删除后空行恢复正常。
- **验收**：
  - G1 独立图后紧跟的空段落，光标在行首按 Backspace → 不合并、不删除（同 code-block 行为）。
  - G2 文档最后叶子为 image-block 时，加载/模式切换后自动补尾随空段落（镜像 `appendTrailingParagraphIfCodeLast` 扩展）。
  - G3 删除图片后该保护解除：空行可正常退格合并；删除后整树为空的兜底逻辑保持现状。
  - G4 既有 code-block 空行保护行为不回归（全量测试回归）。

### R3 超链接操作提示（功能）

- **目标**：悬停超链接时，显示深蓝加粗斜体「ctrl + 左键  打开网页」提示；替换现有 `attr(data-href)` 内容。
- **验收**：
  - G1 `a.inline-link:hover::after` content 为「ctrl + 左键  打开网页」，深蓝色、加粗、斜体；字号 11~12px，字符间距 0.4~0.6px（"控制好字体大小，字符间距"）。
  - G2 提示定位沿用现有（链接下方、`pointer-events:none`），不遮挡链接本身。
  - G3 链接点击/Ctrl+Click 打开行为不变（G5 不再依赖 `data-href` 但保留属性不破坏其它读取）。

### R4 链接场景工具栏定位 → 链接正左方（优化）

- **目标**：选区命中链接（`selection.inLink`）时，工具栏由"上方居中"改为超链接内容**正左方**，贴近链接（间距 8px，垂直居中于链接盒）。
- **验收**：
  - G1 光标在链接内（解链-only 面板）→ 面板位于链接正左方。
  - G2 选区覆盖链接文本（完整工具栏 + 解链）→ 工具栏位于链接正左方。
  - G3 普通文本选区（非链接）工具栏仍为上方居中（不回归）。
  - G4 滚动/窗口变化时位置跟随链接（复用 ImageToolbar 的 live-rect 模式或等价）。

### R5 插入链接回车不丢选中内容（Bug）

- **目标**：选中文本 → 添加超链接 → 输入 URL 后直接回车（不点确定）→ 链接正确应用且选中内容不丢失。
- **验收**：
  - G1 回车与点击「确定」行为一致（同一确认路径）。
  - G2 回车后链接应用到原选区，焦点/选区正确恢复，内容不丢失、不替换。
  - G3 空 URL 回车 → 显示"URL 不能为空"、不关闭模态（现状保持）。

## 4. 明确不动项（回归边界）

- 块树模型、双向转换六条退出规则、撤销/重做、查找替换、大纲。
- 链接/图片插入、`applyLinkOrImage`、`unlinkRange`、`replaceImage` 语义。
- `media://` 协议、CSP、图片加载失败占位（D1 不触碰）。
- 现有 code-block 空行保护语义（R2 只扩展 image-block，不改变 code-block）。
- 浮动工具栏非链接场景的显示/隐藏规则（G3 除外，定位仅链接场景变更）。

## 5. 改动文件清单（预估，规划阶段细化）

| 文件 | 改动 | 风险 |
| --- | --- | --- |
| `kernel/imageBlock.ts` | `parseImageBlockText` 支持 `<div align style="width:Npx">`；新增 setWidth/保持对齐与宽度共存 | 中 |
| `kernel/inlineRenderer.ts` | image-block 渲染读 width → div style width（img max-width:100% 缩放） | 中 |
| `controllers/backspaceCtrl.ts` | `mergeParagraph` 增加 image-block 保护分支 | 低 |
| `kernel/markdownToState.ts` | `appendTrailingParagraphIfCodeLast` 扩展至 image-block（通用化） | 低 |
| `components/Editor/v2/` 相关 | 图片选中框+手柄（新组件或并入 ImageToolbar）、resize 交互与提交、运行时宽度 map、行内图宽度应用 | 高 |
| `components/Editor/v2/FloatingToolbar.tsx` + `toolbarState.ts` | 链接场景位置计算改为链接正左方；Enter 确认路径修复 | 中 |
| `components/Editor/v2/InsertUrlModal.tsx` | Enter `preventDefault` + 走与「确定」一致路径 | 低 |
| `styles/globals.css` | 链接 hover 提示新文案/样式；图片选中框/手柄样式 | 低 |
| `docs/specs/` | R2 沿用 code-block-trailing-paragraph.md 模式 → 扩展文档 | 低 |

## 6. 验收标准（汇总）

- R1~R5 各验收点 G1~G4 全过。
- 质量门禁：`tsc --noEmit` + `vitest run` + ESLint(0 error) + `vite build` + `npx playwright test` 全绿；改动文件 coverage 记录。
- 往返不变量不破坏：`stateToMarkdown(markdownToState(M)) === M`（含带宽度 wrapper 的图片块）。

## 7. 风险与回退

| 风险 | 缓解 |
| --- | --- |
| resize 提交频率高导致重渲染 | 拖拽期间只改 DOM/img style，mouseup 才提交块树（独立图）或运行时 map（行内图） |
| `<div align style>` 解析破坏既有对齐 | 解析器向后兼容（无 style 时 width=null）；既有 wrapper 测试全量回归 |
| 选中框/手柄遮挡或误触 | `pointer-events` 控制；手柄仅选中时显示；不影响文本选中与工具栏点击 |
| Enter 修复影响既有模态关闭 | 仅补 preventDefault/stopPropagation + 同一确认路径；空 URL 分支保持 |
| 保护空行扩展误伤 | 仅 image-block 分支，code-block 分支不动；全量回归 |

---
