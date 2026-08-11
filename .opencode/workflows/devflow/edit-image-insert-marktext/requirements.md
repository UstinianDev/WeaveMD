# 需求文档 — 浮动工具栏插入图片功能重做（深度照搬 marktext）

> 任务名：`edit-image-insert-marktext`
> 日期：2026-08-11
> 状态：已与用户确认（第一轮需求拷问全部按推荐）

## 1. 目标

重做 WeaveMD 浮动工具栏（FloatingToolbar）的图片插入功能，交互与实现深度照搬 marktext（develop 分支）浮动工具栏中插入图片的链路：

`浮动工具栏图片按钮 → block.format('image') 立即写入空 src 占位 → 渲染 `.mu-inline-image.mu-empty-image` 空图占位 → 锚定占位弹出 ImageEditTool（双 Tab 选择器）→ 选图/填链接确认后 replaceImage 更新 token → 重渲染 → 工具栏隐藏`。

## 2. 范围

### 2.1 范围内

- 浮动工具栏图片按钮的**两段式交互**（marktext 式）：
  1. 点击图片按钮 → 立即在光标/选区处插入 `![选中文本]()`（空 src）占位，光标置于 `()` 之间；
  2. 渲染空图占位（`.inline-image-empty`，对标 marktext `.mu-inline-image.mu-empty-image`）；
  3. 弹出**锚定占位图**的图片选择器（替换现有 `InsertUrlModal` 路径），src 输入自动聚焦全选。
- 图片选择器照搬 marktext ImageEditTool 结构：
  - 双 Tab：**Select（本地选择）/ Embed link（输入链接或本地路径）**；
  - Select Tab：「Choose Image」按钮 → 原生文件对话框（复用现有 `dialog.pickImage` IPC）→ 选中后**直接应用**（marktext 行为：跳过二次确认）；
  - Link Tab：src 输入框（自动聚焦全选），简单模式仅 src，**全模式（full mode）**展开 alt + title 三个输入框；Enter 或「Embed」按钮确认；
  - 确认后更新占位 image token 的 src/alt/title 并重渲染。
- 内核支撑（WeaveMD 现状缺口）：
  - lexer 允许 **image token 空 href**（当前 `safeUrl('')` 返回 null，`![]()` 不解析为图片）；
  - inlineRenderer 对空 src 图片渲染 `.inline-image-empty` 占位（而非 broken img）；
  - 新增**替换 image token** 的纯函数（`replaceImageRange`，对标 marktext `block.replaceImage`）：给定 token 区间 + 新 alt/src/title → 新文本 + 光标落点。
- 工具栏在图片操作后**立即隐藏**（marktext `_selectItem` 对 link/image 的行为），不再驻留。
- 行为细节：取消/关闭弹层时 `![]()` 空占位**保留在文档**（marktext 行为）。

### 2.2 范围外（本期明确排除）

- 快捷键 `⇧+⌘+I` 插入图片；
- 剪贴板粘贴图片、拖拽图片入编辑器；
- 上传器（imageAction / imagePathAutoComplete 服务），WeaveMD 离线无此需求；
- src 路径自动补全（imagePathAutoComplete 浮层）；
- ImageEditTool 复用于"点击已插入图片 → 编辑 src/alt/title"（后续任务）；
- link 按钮的交互改造（保持现状，仅图片）。

## 3. 成功标准

- G1：选中文本点击图片按钮 → 立即插入 `![选中文本]()`，光标位于 `()` 间，空图占位渲染为 `.inline-image-empty`，弹层锚定占位打开。
- G2：Select Tab 选本地图 → 占位更新为 `![alt](本地路径)`，`img.inline-image` 经 `media://` 协议**渲染真实图片**；弹层关闭、工具栏隐藏。
- G3：Link Tab 输入 URL（Enter/Embed）→ 占位更新为 `![alt](url)` 并渲染图片。
- G4：全模式可编辑 alt/title，确认后写入 `![alt](src "title")`。
- G5：取消/关闭弹层 → `![]()` 空占位保留在文档，不破坏往返不变量（`stateToMarkdown(markdownToState(M)) === M`）。
- G6：空 src 图片渲染占位不产生 broken img；加载失败仍走既有 `.inline-image-fallback`。
- G7：内核新增函数有单测（RED→GREEN 证据）；E2E 覆盖插入→选图→渲染主链路。
- G8：既有 600+ vitest / 56 e2e 测试不回归。

## 4. 假设 / 约束

- 块树为唯一事实源，DOM 永不反向驱动模型；空图占位与光标偏移打通（UTF-16 code unit）。
- markdown 源存储原始路径/URL，渲染层 `toImgSrc` 转 `media://`；不改 `media://` 契约。
- `applyLinkOrImage`（formatCtrl）的既有 image/link 单步插入逻辑保留（供其他入口/测试），新交互走"占位 + 替换"路径。
- 弹层组件新建（如 `ImageEditTool.tsx`），保留 `InsertUrlModal`（链接按钮仍用）。

## 5. 未决问题

- 无（首轮拷问已全部确认）。

## 6. 参考实现（marktext develop）

- `packages/muya/src/ui/inlineFormatToolbar/index.ts`（`_selectItem`：link/image 后 hide）
- `packages/muya/src/ui/inlineFormatToolbar/config.ts`（image 按钮配置）
- `packages/muya/src/block/base/format.ts`（`format('image')`：`_addFormat` 写 `![alt]()`，光标入 `()`，rAF 定位 `.mu-empty-image` 锚点，emit `muya-image-selector`）
- `packages/muya/src/ui/imageEditTool/index.ts`（ImageEditTool：双 Tab、src 聚焦全选、全模式 alt/title、`_replaceImageAsync`/`_replaceImageDirect`/`_handleSelectButtonClick`）
