# 实现计划：edit-image-insert-marktext

> 任务名：`edit-image-insert-marktext` | 日期：2026-08-11 | 状态：待实施
> 需求：`.opencode/workflows/devflow/edit-image-insert-marktext/requirements.md`（已确认）
> 范围：重做浮动工具栏图片插入为 marktext 式"空占位两段式交互"；内核/控制器/渲染层/样式/测试全链路。

## Overview

当前图片插入走 `FloatingToolbar.handleFormat` → `InsertUrlModal` 单步 `applyLinkOrImage`（`![alt](url)` 一步写入）。本任务改为：点图片按钮 → `formatCtrl.insertImagePlaceholder` 立即写 `![选中文本]()`（空 src）→ lexer 放行 image 空 href → renderer 渲染 `.inline-image-empty` 占位（textContent 保持 === 源文本）→ 锚定占位打开新组件 `ImageEditTool`（本地/Embed 双 Tab）→ `onReplaceImage` 经新纯函数 `replaceImageRange` 更新 token → 工具栏图片操作后立即隐藏，取消时占位保留。

**四个设计决策**：
- **D1 lexer 放行范围**：仅 image 放行空 href；link 空 href **不放行**。`safeUrl('')` 的"空"与"危险协议"判定分离（非空仍走 safeUrl 白名单）。
- **D2 空图占位渲染形态**：`!` `[` `]` `(` `)` 渲染为 `.md-syntax` span，alt 文本置于 `.inline-image-empty` span 内 → **textContent === `![alt]()`**（不变量）。非空图保持既有 `<img class="inline-image">`。
- **D3 协议扩展**：不扩展现有 `onFormat`；新增回调 `onInsertImage(blockId, start, end)` / `onReplaceImage(blockId, imgStart, imgEnd, {src, alt, title})`，走既有 `applyBlockAction` 管线。
- **D4 全模式**：WeaveMD 无简单/全模式开关 —— Link Tab 常驻 src+alt+title 三输入；Select Tab 选中即直接应用（alt 继承占位 alt）。

## 变更清单

| 类型 | 绝对路径 | 职责 |
|---|---|---|
| 修改 | `src/render/editor/kernel/inlineLexer.ts` | `matchImageOrLink`：image 空 href 放行（`href=''`），link 空 href 仍 `null` |
| 修改 | `src/render/editor/kernel/inlineRenderer.ts` | `renderToken` image 分支：`href===''` → `.inline-image-empty` 占位（md-syntax 括号 + alt 文本），非空走既有 `<img>`/`toImgSrc` |
| 新增 | `src/render/editor/kernel/imageReplace.ts` | 纯函数 `replaceImageRange(text, token, img)`：token 区间 → `![alt](src "title")` + 光标落点；导出 `escapeMarkdownUrl(src)` |
| 修改 | `src/render/editor/kernel/index.ts` | 导出 `replaceImageRange` / `escapeMarkdownUrl` |
| 修改 | `src/render/editor/controllers/formatCtrl.ts` | 新增 `insertImagePlaceholder`（写 `![label]()`，光标置括号内，返回 `imageRange`）；新增 `replaceImage`；`applyLinkOrImage` 复用 `escapeMarkdownUrl`（行为不变） |
| 修改 | `src/render/editor/editorInstance.ts` | `EditorActionResult` 增加可选 `imageRange?: {start;end}` |
| 新增 | `src/render/components/Editor/v2/ImageEditTool.tsx` | 锚定占位的弹层：双 Tab（Select/Embed link）、Select 直接应用（`dialog.pickImage`）、Link Tab src 自动聚焦全选 + 全模式 alt/title、Enter/Embed 确认、Escape/×/取消关闭 |
| 修改 | `src/render/components/Editor/v2/FloatingToolbar.tsx` | 图片按钮两段式（不再 `setInsertModal`）；新增 `onInsertImage/onReplaceImage/getBlockEl` props；插入后立即隐藏；锚定 effect；渲染 ImageEditTool；`interactionGuard` 合并 insertModal/imageEdit |
| 修改 | `src/render/components/Editor/v2/useEditorActions.ts` | 新增 `onInsertImage`/`onReplaceImage` handler → `applyBlockAction` → formatCtrl 新入口 |
| 修改 | `src/render/components/Editor/v2/EditorV2.tsx` | 向 FloatingToolbar 透传两个新 handler 与 `getBlockEl` |
| 修改 | `src/render/styles/globals.css` | 新增 `.inline-image-empty` 占位样式（虚线框 + 图标走 `::before`，不污染 textContent） |
| 修改 | `tests/editor/kernel/inlineLexer.test.ts` | 空 href 放行矩阵 |
| 修改 | `tests/editor/kernel/inlineRenderer.test.ts` | `.inline-image-empty` 渲染断言（textContent 不变量） |
| 修改 | `tests/editor/kernel/markdownRoundTrip.test.ts` | 空图/带 title 往返不变量 |
| 新增 | `tests/editor/kernel/imageReplace.test.ts` | `replaceImageRange` 纯函数 |
| 修改 | `tests/editor/controllers/formatCtrl.test.ts` | `insertImagePlaceholder`/`replaceImage` 控制器层 |
| 新增 | `tests/components/imageEditTool.test.tsx` | ImageEditTool 组件 |
| 修改 | `tests/components/floatingToolbarV2.test.tsx` | 图片链路 TB3/TB10* 适配新两段式（链接 TB 不动） |
| 修改 | `tests/styles/ft2Css.test.ts` | `.inline-image-empty` 静态断言 |
| 修改 | `e2e/` 浮动工具栏 spec | 重写 FT2-E6、LINK-IMAGE-E3/E4；新增主链路 e2e（IMG-E1/E2/E4） |
| 新增 | `.opencode/workflows/devflow/edit-image-insert-marktext/progress.md` | 进度文档 |

## 实施步骤（TDD，原子单元，每步 RED→GREEN）

依赖先序：P1 → P2 → P4；P3 与 P4 可并行；P5 可并行；P6 最后。

### Phase 1：内核 — lexer 空 href + 占位渲染 + 往返不变量
- 1.1 lexer：`matchImageOrLink` 空 href 时 image 放行 / link 拒；非空保持 safeUrl。
- 1.2 renderer：image `href===''` → `<span class="md-syntax">![</span><span class="inline-image-empty">alt</span><span class="md-syntax">]()</span>`。
- 1.3 roundTrip：`![]()`、`![a]()`、`![alt](src "title")` 往返恒等。
- Checkpoint-1 commit：`feat(editor): lexer allows empty-href image & empty-image placeholder render`

### Phase 2：内核 replaceImageRange + 控制器入口
- 2.1 `imageReplace.ts`：`escapeMarkdownUrl`（`/[\s()<>]/` → `<...>` 包裹）+ `replaceImageRange(text, token, {src,alt,title})` → `{text, cursorOffset}`。
- 2.2 `formatCtrl.ts`：`insertImagePlaceholder(instance, blockId, s, e)`（label = selected || '图片'）；`replaceImage(instance, blockId, s, e, img)`（tokenize 找 start/end 精确匹配的 image token，找不到返 null）；`editorInstance.ts` 加 `imageRange?`。
- Checkpoint-2 commit：`feat(editor): image placeholder insert/replace controllers via replaceImageRange`

### Phase 3：ImageEditTool 组件（与 Phase 4 并行）
- `ImageEditTool.tsx`：Props `{open, position, initialAlt, pickImage?, onConfirm({src,alt,title}), onCancel}`。Select：pickImage 非 null 直接 onConfirm；Link：src autoFocus+全选，alt/title 全模式，Enter/Embed trim 非空才确认，空 src 错误提示，Escape/× 取消。
- Checkpoint-3 commit：`feat(editor): ImageEditTool popover component`

### Phase 4：装配接线（useEditorActions → FloatingToolbar → EditorV2）
- 4.1 useEditorActions：`onInsertImage`/`onReplaceImage` → `applyBlockAction`。
- 4.2 FloatingToolbar：图片按钮 → `onInsertImage` + 记录 `imageEdit` + 立即隐藏；`[tree, imageEdit]` effect 锚定（token 序号 → `getBlockEl(blockId).querySelectorAll('.inline-image, .inline-image-empty')[n]` → rect clamp）；`interactionGuard` 合并 insertModal/imageEdit；onConfirm→`onReplaceImage`+关闭；onCancel→仅关闭。`InsertUrlModal`（link 路径）与单测零动。
- 4.3 EditorV2 透传 `onInsertImage/onReplaceImage/getBlockEl`。
- Checkpoint-4 commit：`feat(editor): two-step image insert wired through toolbar`

### Phase 5：样式
- `globals.css`：`.inline-image-empty { display:inline-block; min-width:2.5em; min-height:1.4em; border:1px dashed var(--border-color); border-radius:6px; color:var(--text-muted); padding:0 6px; cursor:pointer; }` + `::before { content:'🖼' }`（不落 textContent）。
- Checkpoint-5 commit：`style(editor): .inline-image-empty placeholder style`

### Phase 6：E2E 重写 + 全量门禁
- 重写 FT2-E6（Link Tab URL→渲染 img）、LINK-IMAGE-E3（Select 选本地→media:// 渲染/fallback）、LINK-IMAGE-E4（无效路径→fallback）；新增 IMG-E1（插入占位+光标括号内+弹层+工具栏隐藏+取消保留+往返）、IMG-E2（Embed URL→img 渲染）、IMG-E4（全模式 alt/title）。
- 全量：`npm test`、`npm run typecheck`、`npm run lint`、vite build、`npm run test:e2e`（按项目实际脚本）。
- Checkpoint-6 commit：`test(editor): rewrite image e2e to two-step flow + round-trip guard`

## 测试清单（RED→GREEN）

| 文件 | 用例 | 关键断言 |
|---|---|---|
| inlineLexer.test.ts | +3 | `![]()`/`![a]()` → image token（href 空/'a'）；`[a]()` → 无 link token |
| inlineRenderer.test.ts | +3 | `![]()` → 含 `.inline-image-empty` 且无 `<img`；textContent 剥离 md-syntax 后 === 源 |
| markdownRoundTrip.test.ts | +3 | `![]()`、`![a]()`、`![alt](src "title")` 往返恒等 |
| imageReplace.test.ts（新） | +6 | 基本替换；title；src 特殊字符 `<...>`；alt 空；cursorOffset===token 末；其余文本不动 |
| formatCtrl.test.ts | +4 | insert：`hello`→`![hello]()`+光标括号内+imageRange；默认占位 `图片`；replace 成功/无 token→null |
| imageEditTool.test.tsx（新） | +6 | 双 Tab；Select 直接 onConfirm；pickImage null 不应用；src 聚焦全选；全模式 alt/title；空 src 错误；Escape→onCancel |
| floatingToolbarV2.test.tsx | 适配旧+新增 | 图片→onInsertImage+工具栏隐藏+ImageEditTool 出现；确认→onReplaceImage；取消不 replace；无 pickImage 不崩溃；锚定 effect |
| ft2Css.test.ts | +1 | `.inline-image-empty` 声明 + dashed border |

## 风险与回退

| 阶段 | 失败模式 | 缓解 | 回退 |
|---|---|---|---|
| P1 | lexer 放行误伤 link/文本身份 | 空与非空分流；`[a]()` 断言钉死 D1 | 收窄为 `isImage && args===''` 特判 |
| P1 | 占位图标破坏 textContent 不变量 | 图标走 `::before`/背景 | 占位纯 alt 文本无图标 |
| P1 | `stripInlineSyntax` 对 `![]()` 从"删全部"变"剥成 alt"（无既有断言） | 记录，不动橡皮擦路径 | 维持现状 |
| P2 | replaceImageRange 序列化与 applyLinkOrImage 不一致 | 抽 `escapeMarkdownUrl` 单点 | 各自内联 |
| P3 | jsdom select() 差异 | `setSelectionRange` 断言 + act 包裹 | 聚焦全选降级仅 focus |
| P4 | 锚定时序陈旧 DOM | `[tree, imageEdit]` effect 二次查找 | 降级为 block-content 定位 |
| P4 | 工具栏隐藏后 selectionchange 重显 | `interactionGuard` 统一守卫 | ImageEditTool 挂 body 层 |
| P6 | e2e 重写破坏回归 | 仅改图片 3 条 + 新增；链接用例零动 | 保留旧 e2e skip |

## 质量门禁
`tsc --noEmit` 0 error → vitest 全绿 → eslint 无 error → vite build → playwright e2e 全绿。改动文件覆盖率 ≥ 80%（`@vitest/coverage-v8` 抽查）。

## 明确不做（范围控制）
快捷键 `⇧+⌘+I`；剪贴板粘贴/拖拽；上传器；路径自动补全；点击已插入图片的复用编辑；link 按钮改造；`applyLinkOrImage` 既有语义；`media://` 契约与预渲染面。