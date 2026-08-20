# 编辑主区 v2 — 功能清单

> 从 SUMMARY.md §3 拆出，保留完整功能实现记录。架构细节见 [editor-v2-architecture.md](./editor-v2-architecture.md)，
> 实施进度见 [editor-v2-progress.md](./editor-v2-progress.md)。

## 核心架构

编辑主区已按 marktext/muya 架构完成深度重做（M1-M4 完成）：

- 不可变块树内核 + 无损双向转换；仅叶子内容块 contentEditable（按需重渲染、IME 守卫）
- 语法渲染对齐 marktext：标题 `#`×n 提示、深灰列表 marker、圆形任务复选框、引用绿色竖线，符号不可选中
- **v1 回退路径已退役（2026-08-06）**：v2 为唯一路径，`__EDITOR_V2__` 开关已移除

## 前缀转换与退出规则

- 前缀即时转换（`# `/`- `/`1. `/`- [ ] `/`> `/` ```lang `），退格在内容起点降级
- 六条退出规则 + 退格链：空列表项退格退出列表；空代码块退格一键删除、回车退出（保留）
- 代码块后空行 Backspace 受保护（删除代码块后可删）；删光标题内容后连续退格光标跳回上一行
- 代码块尾随保护空行持久化（SPEC-EDIT-CBTP）：`markdownToState` 解析期自动补尾随空段落，重载/模式切换后不丢失

## 分割线

- 分割线后自动空行保护（2026-08-19）：输入 `---` 转为 `thematic-break` 后自动创建尾随空行
- 空行受 Backspace 保护（不删除、不合并），只有分割线被删除后空行才恢复为普通段落
- 焦点自动移到尾随空行

## 浮动工具栏

- 选区触发且**仅单一语法类型显示**（h1+h2 不显示）
- 自定义块类型下拉（正文/H1-H6/代码块/引用/三类列表，`canConvertBlock` 矩阵置灰）
- 纯函数 `selectionSyntaxTypesConsistent` / `resolveSyntaxType` 在 kernel/syntaxType.ts 与 toolbarState.ts

## 行内格式化（SPEC-EDIT-FT2/FT3/FT4）

- inlineLexer 结构化 token 识别 + underline/math/image 渲染（KaTeX）
- `formatRange` 双形态 toggle（加粗两次回原文，永不产生 `****`）；橡皮擦清除选区全部标记
- Step 0 选区归一化（选中渲染内容及部分语法符号再点格式 → 解除，绝不叠加）
- 跨多个同风格 token 逐 token 拆分解除；跨风格三连 `***` 渲染/剥离
- 相邻混合强调（`**12*3***` → strong 内嵌 em，close run 拆分；`***12*3**` → open 三连拆分）
- 跨风格叠加：选区含异风格边界标记折叠到纯内容再叠加
- 删除/光标路径标记偏移安全：`snapSelectionToContent`/`deleteSelectionContent`/`snapOffsetInText`
- 根容器 `onDragStart` preventDefault 禁用原生拖拽移动选区

## 跨块拖选

- 跨块鼠标拖选（spec 13.13）：rAF 节流 + 反向显式交换端点 + 非内容区回退 + mouseup 末帧兜底/3 帧重放
- Backspace/Delete 走 `deleteLeafRange` 块树级删除
- Chromium 对跨编辑宿主 Selection.toString() 只返回 anchor 块内文本，拖选验证须用块 id + Backspace

## 拖选闪烁优化（SPEC-EDIT-DSF）

- `lastAppliedRangeRef` 端点级变化检测（端点全等跳过重建，静止不再 selection 风暴）
- `FloatingToolbar` selectionchange 改 rAF 合并（渲染 ≤ 每帧一次）
- `resolveSyntaxTypesInRange` 边枚举边比对短路 + 500 叶上限

## 图片

- 工具栏「图片」直选（`dialog.pickImage` 系统文件框，取消 no-op）
- `image-block` 原子块（`kernel/imageBlock.ts`，`<div align>` 包裹对齐）+ 点击选中 → 图片工具栏
- 本地图走 `media://` 协议（`src/main/media-protocol.ts`，非 standard scheme——盘符编码进 host 不被 Chromium 拒绝）
- 图片缩放（R1~R3）：四角手柄拖拽直改 `<img style.width>`（DOM-only），宽度落点在 `<img>` 自身
- 等比例拖拽 = 主轴向符号 × √(dx²+dy²)

## 链接

- `safeUrl` 放行裸域名 + `normalizeHref` 无协议链接自动补 `https://`
- 链接 hover tooltip `attr(data-href)` 显示完整 URL，Ctrl+Click 打开

## 跨块选区替换（2026-08-13）

- 字符输入/粘贴跨块选区时浏览器原生只改 DOM，`onInput` 仅同步焦点块模型 → 其余块"复活"
- ContentBlock 原生 `beforeinput`/`onPaste` 拦截 → `replaceLeafRange` 块树级删除+插入收敛单块

## 可编辑表格块（2026-08-16）

- table 保持叶子块（text 存规范多行 markdown，**不改内核** markdownToState/stateToMarkdown/syntaxType 语义）
- `kernel/tableCodec.ts` 纯函数 parseTableText/serializeTable（`\|` 转义/解义、对齐分隔容错）
- `TableBlock.tsx` 每格 `contenteditable="plaintext-only"`（单元格编辑、增删行列、Enter/Tab/Shift+Tab 跨格、IME 守卫）
- selection/AI 改写/outline 对 table 既有只读排除行为保持（T4 零破坏）

## 重构清理

- 删 `ImageToolbar.scheduleHide` 死代码
- `imageAnchor.ts` 收敛 ImageToolbar/ImageResizeBox 滚动重锚定重复
- `modalConstants.ts` 收敛双份 `EMPTY_URL_MESSAGE`
- 文件树切换保存修复：`saveCurrentDraftIfNeeded()` 统一保存前置
