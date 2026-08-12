# 图片选中缩放与超链接交互优化 — 实施计划

> 计划编号：PLAN-EDIT-IMAGE-LINK-POLISH | 状态：待确认 | 更新：2026-08-12
> 需求：[REQ-EDIT-IMAGE-LINK-POLISH](../requirements/editor-image-link-polish.req.md)
> 任务名：`editor-image-link-polish` | 档位：M（standard TDD）
> 关联规范：SPEC-EDIT-CBTP（受保护空行）、SPEC-EDIT-FT/FT2/FT3/FT4、SPEC-EDITOR-V2（往返不变量）

## 一、总览

编辑主区 v2 图片与超链接交互 5 项优化。核心架构约束（已逐条核对源码）：

1. **宽度持久化走文本语法（D1）**：独立图宽度写入对齐包裹 `<div align="X" style="width:Npx">`，与现有对齐机制共用文本 wrapper；`stateToMarkdown` 对 `block.text` 原样回写（stateToMarkdown.ts:30-32）→ 往返无损成立。行内图宽度仅会话内（运行时 map），不 touch 块树。
2. **R2 镜像 code-block 空行保护全模式**：`backspaceCtrl.mergeParagraph`（保护分支）+ `markdownToState.appendTrailingParagraphIfCodeLast`（加载补偿）+ `formatCtrl.removeImage`（删除补偿）。code-block 分支零改动。
3. **R4/R5 纯函数可测性**：`toolbarState.computeToolbarState` 是 React-free 纯函数已有单测——R4 位置逻辑留在纯函数内（新增可选 linkRect 入参），组件侧只取 DOM rect。

**铁律**：任何影响既有断言（imageBlock.test.ts `toEqual`、ft2Css.test.ts CL1、E2E LINK-IMAGE-E2）的改动必须同步更新测试，不删除/跳过用例。

## 二、根因确认（R5，逐行核对源码）

**根因 = `InsertUrlModal.tsx:115-117` Enter `onKeyDown` 调 `handleConfirm()` 但无 `e.preventDefault()` 也无 `e.stopPropagation()`**，回车触发编辑层 `selectionchange` 竞态，抢在 `ContentBlock` layout-effect 恢复 pendingRange 之前把陈旧选区写入状态 → "选中内容丢失"。三假设已排除两个（无容器/块 Enter 冒泡；确认路径与点击「确定」逐行一致——H1/H2 否），H3 部分成立（autofocus 折叠 + 卸载时选区竞态）。

**修复（最小）**：Enter → `e.preventDefault(); e.stopPropagation(); handleConfirm();`（与「确定」同一 `handleConfirm`→`onConfirm`→`onFormat(..., restoreSelection:true)` 路径）。

> ⚠️ 实施时**先复现再修**：先写 InsertUrlModal 单测（Enter → onConfirm 被调、defaultPrevented=true、不触发 onCancel）+ E2E（选文本→加链→回车→`a.inline-link` 存在、textContent 不丢、activeElement 在块内、selection 非空）。若 preventDefault/stopPropagation 不足以修复竞态，向总指挥报告并深入（不改计划外文件）。

## 三、实施切片（逐需求，函数级改动）

### R1 图片选中框 + 四角缩放（功能 · 改动面最大，串行）

**Kernel（纯函数，先行可测）** `src/render/editor/kernel/imageBlock.ts`：
- `ImageBlockParseResult` 增 `width: number | null`。
- `parseImageBlockText`：wrapper 正则 `/^<div\s+align="(left|center|right)">/` 放宽为允许 `style="width:Npx"`，提取 width；无 style → null（向后兼容）。
- 新增导出 `wrapImageWidth(text, width: number | null): string | null`：非独立图 → null；null → 剥 style；>0 → 无 wrapper 时 `<div align="left" style="width:Npx">…</div>`、有 wrapper 时插入/更新 style（保留 align）。
- `wrapImageAlign` 换向保留 width（仅替换 align 子串 + 校验 style 仍在）。`unwrapImageAlign` 不变。`stateToMarkdown` 零改动（原样回写）。

**渲染层**：
- `LeafBlock.tsx` image-block case：alignStyle 扩展含 width（`width: parsed.width ? parsed.width+'px' : undefined`），外层 div width 即图片显示宽，img `max-width:100%` 缩放。
- 行内图会话宽度：新增纯函数 `applyRuntimeWidths(html, widthMap)`（inlineRenderer.ts 或新 imageWidth.ts），对 `class="inline-image"` 且 `data-start/data-end` 命中 map 的 img 注入 `style="width:Npx"`；ContentBlock/LeafBlock 渲染前调用。map 由 EditorV2 持有（keyed `blockId:start-end`），块卸载/重建时清理。

**resize 交互** 新组件 `ImageResizeBox.tsx`（或并入 ImageSelection 层）：
- fixed 覆盖层（选中框 + 4 角手柄 nw/ne/sw/se）；覆盖层 `pointer-events:none`，仅手柄 `auto`（G6 不挡文字选中/工具栏点击）。
- 复用 ImageToolbar 的 scroll 重锚定模式（ImageToolbar.tsx:110-131）：scroll 重查 `img.inline-image[data-start][data-end]` rect。
- 拖拽：mousemove 每帧只改 `<img style.width>`（DOM 直改不写块树）+ `height:auto`；mouseup 提交：独立图 → 新控制器 `setImageWidth(instance, blockId, width)`（wrapImageWidth 重写 text，走 applyBlockAction 恢复焦点）；行内图 → 写运行时 map。
- clamp：min 32px，max 容器可用宽度；四角方向增量。

**测试**：`imageWidth.test.ts`（parse width 矩阵 / wrapImageWidth round-trip / wrapImageAlign 保宽 / applyRuntimeWidths）；`imageBlock.test.ts` 既有 `toEqual` 补 `width:null`；LeafBlock/ContentBlock width 渲染断言；`markdownRoundTrip` 带 width wrapper 不变量；E2E R1·E6（选中框可见 + 拖拽后 style.width 变化 + 独立图 block.text 更新）。

### R2 图片后空行受保护（镜像 CBTP）

- `backspaceCtrl.ts` `mergeParagraph`：`if (prevLeaf.type === 'code-block') return null;` 旁增 `image-block` 分支。**决策**：图后非空段同样保护（与 code-block 语义一致）。
- `markdownToState.ts` `appendTrailingParagraphIfCodeLast`（私有，仅内部调用）：判定通用化为「最后叶子为 code-block 或 image-block」即补偿。
- `formatCtrl.ts` `removeImage`：补段判定（L362-368）扩展为 `lastLeaf.type === 'code-block' || lastLeaf.type === 'image-block'`。
- 插入中间（next 存在）不改。

**测试**：backspace 保护矩阵（图后空段/非空段不合并、删图后恢复、code-block 不回归）；image 收尾加载补偿；removeImage 补段（代码块+图/图+图/图+文本）；往返不变量。

### R3 超链接操作提示（替换 hover tooltip）

- `globals.css:1976-2004` `a.inline-link:hover::after`：`content: attr(data-href)` → `'ctrl + 左键  打开网页'`（**源码中键字后双空格，字面写入**）；`color:#1d4ed8`（深蓝）、`font-weight:700`、`font-style:italic`、`font-size:12px`、`letter-spacing:0.5px`；保留定位/`pointer-events:none`/`z-index`。`data-href` 属性保留（不破坏其它读取与 Ctrl+Click）。
- **存量断言更新**：`tests/styles/ft2Css.test.ts` CL1 改为断言 content 含 `ctrl + 左键`；E2E LINK-IMAGE-E2 改为断言新文案。`inlineRenderer.test.ts` data-href 属性断言不改。

### R4 链接场景工具栏定位 → 链接正左方

- `toolbarState.ts` `computeToolbarState` 增可选第 6 参 `linkRect?: {top,left,width,height}|null`。`inLink` 时：`left = clamp(linkRect.left - toolbarWidth - 8, …)`；`top = clamp(linkRect.top + linkRect.height/2 - toolbarHeight/2, …)`。非 link → 既有上方居中（G3 不回归）。
- `FloatingToolbar.tsx` `flushSelection`：`selection.inLink` 时 `range.startContainer/anchorNode → closest('a.inline-link') → getBoundingClientRect()` 传参；`showUnlinkOnly`（折叠 inLink）与全工具栏+解链两分支统一取该 rect。
- **滚动跟随（G4）**：仅 `selection.inLink` 时 scroll 重查链接 rect 重定位；非 link 场景维持既有 scroll-hide 行为（回归边界不动）。

**测试**：toolbarState linkRect 矩阵（常规/贴左缘/贴右缘/贴顶缘/贴底缘 → 左 8px + 垂直居中 + clamp）；非 link 上方居中不回归；组件级 `inLink` 定位 < linkRect.left。E2E R4·E5 放集成阶段（避免并发写 floating-toolbar.spec.ts）。

### R5 插入链接回车不丢内容（见 §二）

## 四、变更清单

| 类型 | 文件 | 内容 |
| --- | --- | --- |
| 修改 | `src/render/editor/kernel/imageBlock.ts` | parse 支持 `style="width:Npx"`；`ImageBlockParseResult.width`；`wrapImageWidth`；`wrapImageAlign` 保宽 |
| 修改 | `src/render/editor/kernel/inlineRenderer.ts` | `applyRuntimeWidths`（行内图会话宽度注入） |
| 新增 | `src/render/editor/controllers/imageWidthCtrl.ts` | `setImageWidth`（独立图宽度提交，wrapImageWidth 重写 text） |
| 修改 | `src/render/components/Editor/v2/types.ts` | `ImageSelection` 增 width?；widthMap 接口 |
| 新增 | `src/render/components/Editor/v2/ImageResizeBox.tsx` | 选中框 + 4 角手柄 overlay + 拖拽 + mouseup 提交 + scroll 重锚定 |
| 修改 | `src/render/components/Editor/v2/EditorV2.tsx` | 持行内图 width map；透传 widthMap/setImageWidth；resize 提交接入 |
| 修改 | `src/render/components/Editor/v2/blocks/LeafBlock.tsx` | image-block 应用 width 样式；接 width map |
| 修改 | `src/render/components/Editor/v2/blocks/ContentBlock.tsx` | `toDisplayHtml` 前置 `applyRuntimeWidths` |
| 修改 | `src/render/components/Editor/v2/toolbarState.ts` | `computeToolbarState` 增可选 linkRect；link 场景左定位 + clamp |
| 修改 | `src/render/components/Editor/v2/FloatingToolbar.tsx` | flushSelection 取 linkRect；link 场景 scroll 重锚定 |
| 修改 | `src/render/components/Editor/v2/InsertUrlModal.tsx` | Enter → `preventDefault()+stopPropagation()+handleConfirm()`（R5） |
| 修改 | `src/render/editor/controllers/backspaceCtrl.ts` | `mergeParagraph` 增 image-block 保护 |
| 修改 | `src/render/editor/kernel/markdownToState.ts` | 尾随补偿通用化至 image-block |
| 修改 | `src/render/editor/controllers/formatCtrl.ts` | `removeImage` 补段判定扩展 image-block |
| 修改 | `src/render/styles/globals.css` | 链接 hover 新文案/样式；图片选中框/手柄样式 |
| 测试 | `tests/editor/kernel/imageBlock.test.ts` | 既有 `toEqual` 补 width:null + parse width |
| 测试 | `tests/editor/kernel/imageWidth.test.ts` | wrapImageWidth / applyRuntimeWidths |
| 测试 | `tests/editor/kernel/imageTrailingParagraph.test.ts` | image 收尾补偿 + 往返 |
| 测试 | `tests/editor/kernel/markdownRoundTrip.test.ts` | 带 width wrapper 图往返 |
| 测试 | `tests/editor/controllers/` | backspace 保护矩阵 / removeImage 补段 |
| 测试 | `tests/components/InsertUrlModal.test.tsx` | Enter preventDefault + onConfirm |
| 测试 | `tests/components/toolbarState.test.ts` | linkRect 定位矩阵 |
| 测试 | `tests/styles/ft2Css.test.ts` | CL1 content → 'ctrl + 左键' |
| E2E | `e2e/floating-toolbar.spec.ts` | R3 改文案（E2）、R5 新增 E4；R4·E5 与 R1·E6 集成阶段加 |
| 文档 | `docs/specs/` + `docs/modules/04` + `docs/SUMMARY.md` | R2 图尾随空行扩展、R1 宽度持久化、R4/R5 交互记录 |

## 五、执行拆分（总指挥编排）

**Wave-1 并行（3 worker，文件零交集）**：
- **Worker-A（R2）**：`backspaceCtrl.ts`、`markdownToState.ts`、`formatCtrl.ts`（仅 removeImage 分支）、`imageTrailingParagraph.test.ts`、`markdownRoundTrip.test.ts`。
- **Worker-B（R3 + R5）**：`InsertUrlModal.tsx`、`globals.css`（仅 hover 段，**不追加 resize CSS**）、`InsertUrlModal.test.tsx`、`ft2Css.test.ts`、`floating-toolbar.spec.ts`（**仅** R3·E2 改文案 + R5·E4 新增）。
- **Worker-C（R4）**：`toolbarState.ts`、`FloatingToolbar.tsx`、`toolbarState.test.ts`。**不写** floating-toolbar.spec.ts（R4·E5 留集成阶段）。

> 冲突铁律：任一 worker 发现需改「已分配给其它 worker 的文件」→ 不改，回报告总指挥，由总指挥仲裁/串行化。

**Wave-2 串行（合并全量回归通过后）**：**R1**（图片缩放，改动面最大，涉及 kernel + 渲染层 + EditorV2 + ImageResizeBox + globals.css append + E2E E5/E6）。R1 完成后统一全量门禁。

## 六、TDD 顺序（M/standard：核心新行为测试先行 → 回归）

- Kernel 先行：`imageWidth.test.ts`（RED）→ 实现 → GREEN。
- R2：`imageTrailingParagraph.test.ts`（RED）→ 实现 → backspace/removeImage → 回归。
- R3：改 `ft2Css.test.ts` CL1（先红）→ CSS → GREEN → E2E 更新。
- R5：`InsertUrlModal.test.tsx` Enter 用例（先红）→ handler → GREEN → E2E E4。**先复现再修**。
- R4：`toolbarState.test.ts` linkRect 矩阵（先红）→ 纯函数 → GREEN → FloatingToolbar wiring → 非 link 回归。
- R1：kernel → 渲染断言 → ImageResizeBox 交互 → 集成 → E2E E6。
- 收尾：全量门禁（见 §七）。

## 七、验收标准（G 判据 → 断言映射，摘要）

| 判据 | 断言 |
| --- | --- |
| R1·G1 选中框+四角 | imageSelection 时 `.image-resize-box` + 4 手柄可见 |
| R1·G2 拖拽实时宽 | 拖角 → img style.width 变化、height:auto；放开后独立图 block.text 更新 |
| R1·G3 clamp | 32px ~ 容器宽边界停 |
| R1·G4 独立图往返+对齐保宽 | wrapImageWidth/wrapImageAlign 单测 + markdownRoundTrip |
| R1·G5 行内图会话宽 | applyRuntimeWidths + 重渲染保留、重载消失 |
| R1·G6 不挡/跟随 | pointer-events 断言 + scroll 重锚定 |
| R2·G1 保护 | 图后空/非空段行首退格不合并 |
| R2·G2 加载补尾随 | 图收尾 → 末两块 image-block+空段 |
| R2·G3 删图解保护 | removeImage 补段 + 退格恢复 |
| R2·G4 code-block 不回归 | 既有用例全绿 |
| R3·G1 文案样式 | content 含 `ctrl + 左键`、深蓝、700、italic、12px、letter-spacing 0.5px |
| R3·G2 定位沿用 | position:absolute + pointer-events:none 保留 |
| R3·G3 打开行为不变 | data-href 属性 + Ctrl+Click 不回归 |
| R4·G1/G2 左方定位 | linkRect 矩阵：left=linkRect.left-宽-8、垂直居中 |
| R4·G3 非 link 上方居中 | 既有定位单测保持 |
| R4·G4 滚动跟随 | link 场景 scroll 重锚定 |
| R5·G1/G2 同一路径+选区恢复 | Enter 与确定同 handleConfirm/onFormat；E2E textContent 不丢、activeElement 在块内、selection 非空 |
| R5·G3 空 URL | 既有空值用例保持 |

**质量门禁**：`tsc --noEmit` + `vitest run` + ESLint(0 error) + `vite build` + `npx playwright test` 全绿；往返不变量（含带 width wrapper 图块）不破坏。

## 八、风险与回退

| 风险 | 缓解 | 回退 |
| --- | --- | --- |
| 拖拽提交频率高触发重渲染 | 拖拽期只改 DOM/img style，mouseup 才提交 | 移除 ImageResizeBox |
| `<div align style>` 解析破坏既有对齐 | 解析器向后兼容 + 既有 toEqual 同步 | 回退 imageBlock 正则 |
| 选中框/手柄遮挡 | pointer-events 控制 | 删除 overlay 层 |
| R5 补 preventDefault 影响既有 modal | 仅 Enter 分支，空 URL 分支不动 | 移除 stopPropagation 仅留 preventDefault |
| R2 保护误伤 | 仅 image-block 分支 + 全量回归 | checkout 相关 controller |
| R4 左定位 clamp 越界 | 纯函数 clamp | 回退 computeToolbarState 入参 |
| 并行同文件冲突 | 冲突铁律（见 §五） | 串行化 |
| R3 文案/字距断言脆弱 | 固定字面量写断言 | 回退 content 到 attr(data-href) |
| 行内图 width map 泄漏 | keyed by blockId + 清理 | 移除 map |

## 九、明确不动项（回归边界）

- 块树模型、双向转换六条退出规则、撤销/重做、查找替换、大纲。
- 链接/图片**插入**、`applyLinkOrImage`、`unlinkRange`、`replaceImage`、`makeImageInline` 语义。
- `media://` 协议、CSP、图片加载失败占位。
- code-block 空行保护语义（R2 只扩展 image-block）。
- 浮动工具栏非链接场景的显示/隐藏/滚动退出规则（R4 仅 link 场景变更）。
- renderLink 的 `href`/`data-href` 属性（R3 仅换伪元素 content）。
- `stateToMarkdown` 序列化逻辑。
