# 编辑主区 v2 实施记录 — 分册 3（13.14~13.15：行内格式与图片）

> 拆分自 [editor-v2-progress.md](../editor-v2-progress.md)，原 §13.14~§13.15；2026-09-27 按渐进式披露拆分，正文未改动。
> 返回索引：[editor-v2-progress.md](../editor-v2-progress.md)

---

### 13.14 行内格式化增强（SPEC-EDIT-FT2，2026-08-08）

**内核**：

- 新增 `kernel/inlineLexer.ts`：`InlineToken` 结构化识别（strong/em/underline/strike/mark/
  code/link/image/autolink/escape/math），`inlineRenderer.renderFragment` 改消费 lexer
  （输出逐字节不变，存量金标准测试守护）；`isBoundedWrap` 供 activeTest 与 toggle-off 共享。
- 新增 `kernel/katex.ts`（`renderMath`，KaTeX + `.math-inline` 包装，失败回退字面量）、
  `kernel/inlineStrip.ts`（`stripSameStylePairs`/`stripInlineSyntax`）。
- `formatCtrl`：`InlineFormatStyle` 扩至 9 种；`formatRange` 双形态 toggle（形态 A 选区外
  标记、形态 B 全选包裹区），永不产生 `****`；新增 `clearFormat`；image 走 `![alt](url)`。
- `$` 入 `ESCAPABLE_CHARS`；math 打开/闭合判定严格化。

**组件/CSS**：

- FloatingToolbar 分组：字符格式（B/I/U/S/</>/H）→ 对象插入（🔗/🖼/∑）→ 橡皮擦（⌫）；
  activeTest 用 `isBoundedWrap`；image/link 弹 prompt；橡皮擦 `onClearFormat`。
- `types.ts`/`ContentBlock`/`EditorV2`：`onFormat` 补 `url?`、新增 `onClearFormat`、
  Ctrl+U / Ctrl+Shift+M 快捷键。
- globals.css：`.md-syntax` 方案 B（默认隐藏、聚焦灰显）、mark 黄色主题变量（5 主题块）、
  工具栏尺寸类（`.floating-toolbar-v2`/`.ft-btn`/`.block-type-*`/`.ft-divider`）、
  `.inline-image`/`.math-inline`。

**验证**：`vitest run` 392 例（新增 inlineLexer/katex/inlineStrip/formatCtrl toggle+
clearFormat/ft2Css/EditorV2Format 等）、Playwright E2E 38/38（含 FT2 新增 8 例）、
`tsc --noEmit`、ESLint（0 error）、`vite build` 全部通过。

### 13.15 图片选中框 + 四角缩放 + 宽度模型（SPEC-EDIT-IMG-W, 2026-08-12）

图片块（image-block）新增**宽度维度**与**可视化缩放交互**，点击图片显示四角缩放手柄，
拖拽实时缩放并提交（独立图持久化到块文本；行内图写会话运行时 map）。不改变
`stateToMarkdown` 序列化（往返不变量保持）。

#### 13.15.1 文本层宽度模型（`kernel/imageBlock.ts`）

`parseImageBlockText` 的返回结构新增 `width` 字段，解析独立图文本中可选的
`style="width:Npx"`（对齐包裹 `<div align="X" style="width:Npx">`）。配套纯函数：

- `wrapImageWidth(text, width|null)`：写入/清除宽度。width 已存在 wrapper → 更新 open tag
  的 style 段内 `width` 值（保留其余属性）；裸图 → 产出 `<div align="left" style="width:Npx">`；
  width null → 剥 style 回到裸 align wrapper（保留 align）。非独立图 / 非法值 → null。
- `wrapImageAlign` 保留 style width（换向不丢 width）。
- **往返不变量**：宽度写进 `block.text` 后经 `stateToMarkdown` 逐字序列化，重载后
  `markdownToState` 重新解析出同一 `width`（`<div align>` 包裹兼容宽度属性）。

#### 13.15.2 独立图宽度提交（`controllers/imageWidthCtrl.ts setImageWidth`）

独立成块图片的宽度持久化到文本：`wrapImageWidth` 重写 `block.text`，段落独立图自动转
image-block，focus 于文本末尾。经 `stateToMarkdown` 同步到磁盘内容。

#### 13.15.3 行内图运行时宽度（会话 map + `applyRuntimeWidths`）

行内（非独立）图片无 `block.text` 内嵌宽度位，改为**会话级运行时 map**
（`BlockWidthMap`：`blockId → { [data-start]:[data-end] → px }`）注入渲染：

- `kernel/inlineRenderer.ts`：`applyRuntimeWidths(html, widthMap)` 按 `data-start/data-end`
  命中 map 的 `<img>` 追加 `style="width:Npx"`（img 已带 style 则合并覆盖 width）；
  注入核心抽为 `applyImgWidth(html, width)`，**独立图渲染 `renderImageBlock` 复用同一注入**
  ——宽度一律落点在 `<img>` 自身（R3，2026-08-13），wrapper div 仅负责对齐。
- EditorV2 持有 `blockWidthMap`（仅会话生效，重载/重建块自然清理，无泄漏）；
  点击选中读 `mapWidth ?? parsed?.width` 作为缩放起点。

#### 13.15.4 选中框与缩放手柄（`components/Editor/v2/ImageResizeBox.tsx` + `resizeMath.ts`）

- 点击独立图或行内图 → 显示 `.image-resize-box`（fixed 覆盖层，`z-[90]` 低于工具栏
  `z-[100]`，`pointer-events:none`，1.5px accent 外轮廓）+ 4 个角手柄
  （`.image-resize-handle`，`data-handle=nw/ne/sw/se`，`pointer-events:auto`，cursor 对角）。
- **手柄角对齐**：手柄定位 `off = -6`，四个角统一用负偏移（west/north `left/top:-6`，
  east/south `right/bottom:-6`）使手柄中心精确落在图片角上。旧实现 east/south 用了正
  `right/bottom`（内缩一个手柄宽 ~9.5px，仅 NW 近似对齐）+ 未补偿 1.5px 边框——已修复
  （E2E 断言四角偏差 ≤1.5px）。
- **拖拽生命周期**（`ImageResizeBox`）：mousedown 手柄记录起始宽与角 → document mousemove
  实时改 `<img style.width>` **并同步直改选中框 DOM**（`boxRef`，`left/top/width/height`
  一次 `getBoundingClientRect` 读取）——**全程不触发 React setState/重渲染**，快速拖拽
  选中框与图片零滞后（height auto 保宽高比）→ mouseup 提交并把 state 同步到最终盒。
- **宽度算术**（`resizeMath.computeResizeWidth(startWidth, dx, dy, corner, min, max)`）：
  横向 east+1 / west-1、纵向 south+1 / north-1，**增量 = 指针位移长度 `√(dx²+dy²)`**
  （方向取主轴向符号）——斜向按对角距离顺滑增长、纯横/纵行为不变，无主轴向切换跳变
  （R1，2026-08-13；旧版取 `max(|dx|,|dy|)`，拖 `(100,50)` 与 `(100,100)` 增量相同，斜向"迟钝"）；
  钳制 `[32px, 容器内容宽]`，非有限输入回落 min。
- **提交/重渲染后重锚定**（R2，2026-08-13）：`ImageResizeBox` 新增 `useLayoutEffect`
  （每次渲染完成、非拖拽期）重查 img 最新 rect，直改 `boxRef` DOM + 变化守卫 `setRect`，
  兜住提交（`setTree`/`setBlockWidthMap`）重渲染后 img 尺寸/位置变化——修复"框比图小/
  框停在旧位置"；滚动重锚定（对齐 ImageToolbar Bug-B 模式）保留。
- **提交分流**：standalone → `onResizeStandalone`（`setImageWidth` 持久化文本）；
  inline → `onResizeInline`（写会话 map 触发重渲染注入）。

#### 13.15.5 工具栏捕获守卫

`FloatingToolbar` 的 document capture mousedown 对 `.image-resize-box` 目标直接放行
（`handleMouseDown` 首段返回），缩放手柄拖拽不被工具栏"点击外部关闭"逻辑中断。

**验证**：`ImageResizeBox` 组件测试（拖拽期同步直改 DOM + R2 提交后重锚定断言）+
`resizeMath` 纯函数单测（欧氏距离对角/钳制/角方向/取整/防御）+ `renderBlockHtml`
宽度注入测试 + E2E `R1·E7` 手柄四角对齐回归、`R1·E8` 对角拖拽按对角距离放大、
`R1·E9` 居中/居右对齐（含带宽度图）、`R1·E10` 松手提交后框与图尺寸/位置一致
（小图放大不回弹）；全量 `vitest run` / Playwright E2E（真实 Chromium）门禁通过。
