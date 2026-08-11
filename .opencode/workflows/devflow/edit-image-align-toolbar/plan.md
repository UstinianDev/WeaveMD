# 实现计划：edit-image-align-toolbar（图片插入直选 + 图片工具栏对齐）

> 任务名：`edit-image-align-toolbar` | 日期：2026-08-11 | 状态：已规划
> 需求：`.opencode/workflows/devflow/edit-image-align-toolbar/requirements.md`（已确认）

## Overview

改造 v2 编辑器图片链路：(1) 浮动工具栏「图片」按钮改为直选文件并直接替换选中文本，取消无操作，废除占位中间态；(2) 修复 `toImgSrc` 对已含 `%20` 转义 markdown src 的二次编码 bug，使带空格/中文路径图片真实显示；(3) 新增 `image-block` 原子块类型与「点击图片 → 图片工具栏」（修改图片 / 内联图片 / 居左 / 居中 / 居右 / 移除图片），行内图对齐按钮置灰，对齐 = 源码 `<div align="...">` 包裹，源码模式原文往返不丢。

## 设计决策

### D1：新增 `image-block` 原子块类型（不激活通用 html-block）
- `types.ts` 新增叶子块类型 `image-block`（text 存原文），加入 `LEAF_BLOCK_TYPES`；`html-block` 保持备用不激活。理由：精确控制渲染/编辑/点击目标，避免通用 HTML 块的解析与安全面；表格块（`types.ts:33`）是同类先例。
- **解析规则**（`markdownToState.ts` 主循环，thematic-break 之后）：
  - 严格单行 `<div align="left|center|right">` + **单个** image token（`tokenizeInline(inner)` 恰好 1 个且 `start===0 && end===inner.length`）+ `</div>` → `image-block`（text = 整行原文，含 wrapper）。
  - 单行**裸图片语法**（整行即 `![alt](src)`，允许首尾空白/`\r` 容差）→ `image-block`。这是「独立成块」的解析侧定义。
  - 不满足（含其他内容、多行、非法 align、wrapper 不配对）→ 维持 paragraph 原文。
- **序列化**（`stateToMarkdown.ts`）：`case 'image-block'` → `[ctx.indent + text]` 原样输出，往返无损。
- **渲染**（`LeafBlock.tsx` + `renderBlockHtml`）：非编辑块 div（对齐时 `textAlign` 按 align），内层 `dangerouslySetInnerHTML = renderBlockHtml`（仅内层渲染，wrapper 不出现为转义文本）；img 带 `data-block-id`、`data-start`/`data-end`（绝对偏移）。

### D2：toImgSrc 单层解码修复
- `toImgSrc` 在 encodeURIComponent 前先对 markdown 转义做**单层解码**（`%XX` → 字符），保持主进程 `decodeURIComponent` 一次解码的契约对称。纯正则解码（不抛错）：
  ```
  decodeMarkdownEscapes(s) = s.replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  ```
- 边界：`%20` → 空格（修复 `%2520` 双重编码）；盘符 `C:` → `C%3A`、`/` 分隔符还原（既有契约）；UNC 天然往返；非法 `%XX` 字面保留不抛错；相对路径/网络 URL 分支原样返回。
- 已知限制（文档化）：文件名字面含 `%XX` 序列会被解码——单层契约固有歧义，需求已共识。
- 单测：`inlineRenderer.test.ts` 新增 toImgSrc describe（K1）。

### D3：图片点击选中机制（行内图与 image-block 统一）
- 渲染期 img 输出 `data-start`/`data-end`（token 绝对偏移，`renderInline(text, base=0)` 透传 base，image-block 用 `base=innerStart`）；点击时 EditorV2 `handleContainerClick` 读 `closest('img.inline-image')` 的属性 + `closest('[data-block-id]')` + `getBoundingClientRect()` → `imageSelection: { blockId, start, end, rect }` 状态；FloatingToolbar 渲染图片工具栏并压制文本工具栏。
- 关闭：点击工具栏外 / Escape / 任一操作执行后关闭（避免转换导致偏移漂移）；文本工具栏 selectionchange 竞争由 flushSelection 守卫（imageSelection 非空时直接 return）。
- 偏移一律来自 DOM data 属性（kernel 计算），不依赖 DOM 文本偏移换算。

### D4：对齐/内联/类型转换纯函数（kernel）+ 控制器
- 新模块 `kernel/imageBlock.ts`（纯函数）：
  - `parseImageBlockText(text)` → `{ align, inner, innerStart, innerEnd } | null`
  - `isStandaloneImageText(text)`（工具栏置灰判定）
  - `wrapImageAlign(text, align)`：已有 wrapper → 替换 align；裸图 → 包裹
  - `unwrapImageAlign(text)`：剥 wrapper
- `blockTree.ts` 新增 `changeBlockType(tree, id, type)`：保留 id/text/meta、清 inlineHtml。
- `formatCtrl.ts` 新增四控制器（K3）：`insertImageFromSelection` / `alignImage` / `makeImageInline` / `removeImage`；废除 `insertImagePlaceholder`（`.inline-image-empty` 渲染保留供手写 `![alt]()`）。
- **修改图片复用既有 `replaceImage`**：image-block 的 token 区间是绝对偏移（innerStart..innerEnd），`replaceImage` 的 `tokenizeInline(text).find(t => t.start===s && t.end===e)` 在含 wrapper 的全文上直接命中，包裹自动保留。

### D5：插入直选流程
- FloatingToolbar 图片按钮 → `await pickImage?.()` → 非空 → `onInsertImageFromSelection(blockId, start, end, path)`；空 → 纯 no-op。
- `formatCtrl.insertImageFromSelection`：`writtenSrc = escapeImagePathForMarkdown(src)`（空格 → `%20`，保留反斜杠与中文原文，再经 escapeMarkdownUrl 兜底括号）；选区替换为 `![sel](writtenSrc)`（空选区 → `![](writtenSrc)`）。
- 独立成块判定（`s===0 && e===text.length` 或原 text 为空）→ `changeBlockType` 转 image-block + 确保存在后续段落（无则 append 空段落）→ focus 下一段起点；否则行内插入 → focus = token 末端（图后）。
- 不自动弹出图片工具栏。ImageEditTool 仅由「修改图片」触发。

### D6：测试策略
- 单测：新增 `imageBlock.test.ts`；扩展 `inlineRenderer / imageReplace / formatCtrl / markdownRoundTrip / floatingToolbarV2 / imageEditTool`；新增图片工具栏组件测试。
- e2e：FT2-E6、LINK-IMAGE-E3/E4 重写为直选新流程；新增图片工具栏全链路用例（点击图 → 对齐 → 内联 → 修改 → 移除）与取消用例；pickImage mock 已有先例（`floating-toolbar.spec.ts:47`）。**不修改 `drag-selection-markers.spec.ts`**。

## 变更清单

| 类型 | 路径 | 职责 |
|---|---|---|
| 修改 | `src/render/editor/kernel/inlineRenderer.ts` | toImgSrc 单层解码；image 分支输出 data-start/data-end；renderInline base 参数；renderBlockHtml image-block 分支 |
| 修改 | `src/render/editor/kernel/types.ts` | BlockTypeV2 += `image-block`；LEAF_BLOCK_TYPES += `image-block` |
| 新增 | `src/render/editor/kernel/imageBlock.ts` | parseImageBlockText / isStandaloneImageText / wrapImageAlign / unwrapImageAlign |
| 修改 | `src/render/editor/kernel/imageReplace.ts` | 新增 `escapeImagePathForMarkdown` |
| 修改 | `src/render/editor/kernel/markdownToState.ts` | image-block 行解析（裸图 / div 包裹单图） |
| 修改 | `src/render/editor/kernel/stateToMarkdown.ts` | serializeBlock += image-block（原文输出） |
| 修改 | `src/render/editor/kernel/blockTree.ts` | 新增 `changeBlockType` |
| 修改 | `src/render/editor/kernel/index.ts` | export imageBlock |
| 修改 | `src/render/editor/controllers/formatCtrl.ts` | 新增 insertImageFromSelection / alignImage / makeImageInline / removeImage；删除 insertImagePlaceholder |
| 修改 | `src/render/components/Editor/v2/EditorV2.tsx` | imageSelection state；img 点击检测与锚点；透传 handler |
| 修改 | `src/render/components/Editor/v2/FloatingToolbar.tsx` | 图片按钮直选；删除两段式 imageEdit 状态与锚定 effect；图片工具栏 UI（6 按钮 + 置灰 + active + 关闭语义） |
| 修改 | `src/render/components/Editor/v2/ImageEditTool.tsx` | initialSrc/initialTitle 预填；标题「修改图片」 |
| 修改 | `src/render/components/Editor/v2/useEditorActions.ts` | 接线新控制器；移除 onInsertImage |
| 修改 | `src/render/components/Editor/v2/types.ts` | BlockHandlers 扩展 |
| 修改 | `src/render/components/Editor/v2/blocks/LeafBlock.tsx` | case 'image-block' 渲染（非编辑 div + textAlign） |
| 测试 | `tests/editor/kernel/imageBlock.test.ts`（新增） | 解析/包裹纯函数 |
| 测试 | `tests/editor/kernel/inlineRenderer.test.ts` / `imageReplace.test.ts` / `formatCtrl.test.ts` / `markdownRoundTrip.test.ts` / `blockTree.test.ts` | 见各 K |
| 测试 | `tests/components/floatingToolbarV2.test.tsx` / `imageEditTool.test.tsx` / `imageToolbarV2.test.tsx`（新增） | 组件交互 |
| e2e | `e2e/floating-toolbar.spec.ts` | FT2-E6 / LINK-IMAGE-E3/E4 重写 + 图片工具栏新增用例 |
| 不改 | `e2e/drag-selection-markers.spec.ts` | 既有 5 RED，勿动 |

## 分阶段实施顺序

### K1：toImgSrc 修复 + img data 属性（渲染层）——低风险
- RED：`tests/editor/kernel/inlineRenderer.test.ts` 新增 toImgSrc 解码边界（`%20`/中文/UNC/非法 `%2`/URL 原样）+ data-start/data-end 偏移（含混合文本）。
- GREEN：`inlineRenderer.ts` decodeMarkdownEscapes + toImgSrc 解码后编码；image 分支 data 属性；`renderInline(text, base=0)`。

### K2：image-block 内核模型（类型/解析/序列化/渲染/往返）
- RED：新增 `tests/editor/kernel/imageBlock.test.ts`（parse/wrap/unwrap/isStandalone 全矩阵）；`markdownRoundTrip.test.ts` 追加 image-block 往返（裸图、三向 wrapper、非规范 div 仍 paragraph、RT3 类型断言）；`inlineRenderer.test.ts` 追加 renderBlockHtml image-block 断言。
- GREEN：`types.ts`；`imageBlock.ts`；`markdownToState.ts`；`stateToMarkdown.ts`；`inlineRenderer.ts` renderBlockHtml 分支；`kernel/index.ts`；`LeafBlock.tsx` case 'image-block'。

### K3：块类型转换 + 图片操作控制器——中风险
- RED：`formatCtrl.test.ts` 追加 insertImageFromSelection（行内/空选区/整段→image-block+补空段+焦点）/ alignImage（wrap/换向/paragraph 独立图转块/行内图 null）/ makeImageInline / removeImage；`blockTree.test.ts` 追加 changeBlockType。
- GREEN：`blockTree.ts`；`formatCtrl.ts` 四控制器 + 删 insertImagePlaceholder；`imageReplace.ts` escapeImagePathForMarkdown。

### K4：图片点击选中 + 图片工具栏 UI——中风险（selection 竞争）
- RED：新增 `tests/components/imageToolbarV2.test.tsx`（6 按钮中文文案/文本工具栏不出现/行内图置灰/独立图对齐 active/内联/修改打开 ImageEditTool/移除/关闭）。
- GREEN：`EditorV2.tsx` imageSelection + img 点击检测；`FloatingToolbar.tsx` 图片工具栏分支 + flushSelection 守卫 + 置灰计算。

### K5：ImageEditTool「修改图片」模式（预填）
- RED：`tests/components/imageEditTool.test.tsx` 追加预填断言。
- GREEN：`ImageEditTool.tsx` initialSrc/initialTitle；`FloatingToolbar.tsx` 删旧两段式（imageEdit/imageEditPos/锚定 effect/handleReplaceImage 旧接线）→「修改图片」→ 确认走 onReplaceImage（复用 formatCtrl.replaceImage）。

### K6：插入直选流程接线——低风险
- RED：`floatingToolbarV2.test.tsx`：图片按钮 → pickImage → 非空触发 onInsertImageFromSelection；null → no-op；改写既有两段式用例。
- GREEN：`FloatingToolbar.tsx` image 分支 async pickImage；`useEditorActions.ts` 接线 + 移除 onInsertImage；`EditorV2.tsx` 透传；`types.ts` BlockHandlers。

### K7：e2e 重写与新增 + 全量门禁
- RED/改写：`e2e/floating-toolbar.spec.ts`：FT2-E6 重写（直选替换 + 无弹层 + textContent 断言 + media:// src 捕获 + fallback）；新增取消用例；LINK-IMAGE-E3/E4 重写；新增图片工具栏全链路（点击 → 对齐 → 内联 → 修改 → 移除）与行内图置灰用例。
- 门禁：vitest 全绿、tsc 0 error、eslint 0 error、vite build 通过、e2e 除 drag-selection-markers 既有 5 RED 外全绿。

## 依赖与风险

依赖链：K1 → K6；K2 → K3、K4；K4 → K5；K1..K6 → K7。K1 与 K2 同改 inlineRenderer.ts，合并执行；K4/K5/K6 同改 FloatingToolbar.tsx/EditorV2.tsx，合并执行。

| 风险 | 影响 | 缓解 |
|---|---|---|
| 块类型转换编辑回归（Enter/Backspace/删除跨块选区触碰 image-block） | 中 | image-block 非编辑块；K3 单测覆盖；K7 e2e「图后回车新建段、图前退格不吞图」；changeBlockType 保留 id |
| selection 偏移漂移（wrapper ±13 字符、data 属性口径） | 中 | 偏移来自渲染期 DOM data 属性；action 后关闭图片工具栏；K1 单测锁定 |
| 源码模式往返丢数据 | 低 | text 存原文 + stateToMarkdown 原样输出；K2 往返单测 |
| `%XX` 字面文件名歧义 | 低 | 需求已共识；文档化 |
| 既有用例回归面（RT3 树类型、两段式组件用例、FT2-E6/LINK-IMAGE-E3/E4） | 中 | 每 K RED→GREEN；K3/K6 显式改写；K7 全量门禁 |
| e2e renderer-only 无主进程 media handler | 低 | 既有约定；MutationObserver 捕获瞬时 src |

## 测试策略

- kernel 单测：imageBlock / inlineRenderer（toImgSrc + data 偏移 + image-block 渲染）/ imageReplace / formatCtrl / blockTree / markdownRoundTrip。
- 组件单测：imageToolbarV2（新）/ floatingToolbarV2（直选 + 取消）/ imageEditTool（预填）。
- 集成回归：editorV2* 既有测试。
- E2E：floating-toolbar.spec.ts 重写 + 新增。

## 成功标准

- [ ] 选中文本 → 点图片 → 选文件 → 文本被图片替换（alt=选中文本），无占位框残留，光标在图后；取消 = 无操作（K6/K7）
- [ ] 带空格/中文路径图片显示真实原图（K1）
- [ ] 点击图片 → 图片工具栏出现且文本工具栏隐藏；点击别处/Escape 关闭（K4/K7）
- [ ] 行内图对齐按钮置灰；独立成块可对齐；源码 `<div align="...">` 包裹原文；切源码模式往返不丢（K2/K3/K7）
- [ ] 移除图片（含包裹）正确；修改图片预填并替换成功、包裹保留（K4/K5/K7）
- [ ] 门禁：vitest 全绿、tsc 0 error、eslint 0 error、vite build 通过、e2e 既有 RED 之外全绿
- [ ] 硬约束：仅本任务范围；`drag-selection-markers.spec.ts` 未改动；`.inline-image-empty` 渲染保留
