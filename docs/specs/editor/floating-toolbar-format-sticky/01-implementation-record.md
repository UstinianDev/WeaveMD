# 浮动工具栏格式应用交互修正 — 实施记录（§9）

> 拆分自 [floating-toolbar-format-sticky.md](../floating-toolbar-format-sticky.md)，原 §9 实施记录（阶段 0~5、已知限制、C10/C12）；2026-09-27 按渐进式披露拆分，正文未改动。
> 返回索引：[floating-toolbar-format-sticky.md](../floating-toolbar-format-sticky.md)

---

## 9. 实施记录

> 按里程碑回写（对照 SPEC-EDIT-FT2 §9 的格式）。实施证据见
> [docs/testing/spec-edit/spec-edit-ft3.tdd.md](../../../testing/spec-edit/spec-edit-ft3.tdd.md)。

### 9.1 阶段 0 内核：Step 0 选区归一化（G1，2026-08-08）

- `kernel/inlineLexer.ts`：提升共享映射 `STYLE_TOKEN_TYPE`（bold↔strong、italic↔em、
  strike↔del、highlight↔mark、code↔code、underline↔underline、math↔math）；
  新增纯函数 `findIntersectingStyleToken(text, style, s, e)`（DFS 递归含 children 的同风格
  paired token，过滤相交 `t.start < e && t.end > s`，返回文档序第一个）。
- `kernel/inlineStrip.ts`：删除本地 `STYLE_TO_TOKEN`，改用共享映射（去重）。
- `formatCtrl`：`FormatRangeOptions` 增 `restoreSelection?: boolean`；Step 0 置于 Step 1 前——
  case B（`T.start <= s && e <= T.end` 且覆盖边界标记 `s < T.contentStart || e > T.contentEnd`）
  → 剥离 open/close 解除并返回 `selection`；toggleOff 形态 A/B、Step 2 包裹、link/image、
  `clearFormat` 均补充 `selection` 映射（仅 `restoreSelection` 时返回，键盘路径缺省折叠）。
- 行为矩阵落地：`**123**` 选区 `[2,7)`/`[0,5)`/`[0,7)`/`[2,5)` → 均解除为 `123`，绝不产生
  `****…****`；存量用例 `'a **already** c'` 选区 `[2,13)` 期望由「不变」改为「解除为
  `a already c`」（决议 4，明示行为变更）。

### 9.2 阶段 1 选区恢复内核（G3 基础，2026-08-08）

- `kernel/selection.ts`：抽取 `offsetToDomPoint(contentEl, offset)`（复用 TreeWalker 定位
  循环：remaining>0、零宽空格跳过、`.md-syntax` 标记字符计入偏移）；`setCursorAtOffset`
  基于它（collapse 单点，行为不变）；新增 `setRangeAtOffset(contentEl, start, end)`
  （focus + 两点定位 + addRange，反向/越界 clamp 不抛错）。
- `editorInstance.ts`：`EditorActionResult` 增 `selection?: { blockId; start; end }`
  （存在时优先于 `focus`）。

### 9.3 阶段 2 接线：恢复选区链路（G3，2026-08-08）

- `v2/types.ts`：`BlockHandlers.onFormat` 增第 6 参 `restoreSelection?: boolean`；
  `onClearFormat` 增第 4 参；新增 `getPendingRange?: () => { start; end } | null`。
- `EditorV2.tsx`：新增 `pendingRangeRef`；`applyAction` 检测 `result.selection` →
  树未变化立即 `setRangeAtOffset`，否则写 pendingRangeRef（恢复选区优先于折叠光标）；
  onFormat/onClearFormat 透传 `restoreSelection`；handlers 增 `getPendingRange`
  （读后即清空，消费一次）。
- `ContentBlock.tsx`：props 增 `getPendingRange?`，在无依赖 useLayoutEffect 中恢复选区。
  渲染链路零穿透（LeafBlock/CodeBlock 以 `{...handlers}` 展开）。

### 9.4 阶段 3 工具栏驻留（G3，2026-08-08）

- `FloatingToolbar.tsx`：`handleFormat`/`handleClearFormat` 移除末尾强隐、置 `stickyRef`、
  传 `restoreSelection: true`；`handleBlockChange` 维持退出（块转换后清理 sticky）；
  新增 `stickyRef`/`suppressSelectionRef` + `document mousedown(capture)`（sticky 且点工具栏外
  → 隐藏 + suppress）与 `keydown Escape` 监听（可见时隐藏）；`flushSelection` 顶部消费
  suppress（阻断「点击后 selectionchange 重显」竞态）；滚动隐藏顺带清 sticky。
- 非 sticky 的普通选中「跟随」行为不变（单测锁定）。

### 9.5 阶段 4 尺寸缩小（G4，2026-08-08）

- `globals.css` FT2 阶段 2 尺寸块更新：容器 gap 4px、padding 3px 6px、字号 13px；
  按钮 32×28px；trigger 高 28px px 6px；option padding 6px 10px；menu min-width 176px；
  divider 1×16px margin 0 2px。总高口径：按钮 28px + padding 3px×2 = 34px。
- 同步回写 `tests/styles/ft2Css.test.ts`（CS5/CS5b/CS5c）与 E2E `FT2-E1`
  （字号 13px、gap 4~5px、按钮 32×28、clientHeight ≤ 34）。

### 9.6 阶段 5 E2E 与文档（2026-08-08）

- `e2e/floating-toolbar.spec.ts`：新增 `selectTextRange` 辅助（TreeWalker 按 textContent
  偏移构造 Range，与 `kernel/selection` 同口径）与 FT3-E1（G1 部分标记不叠加）、
  FT3-E2（G2 高亮无残留）、FT3-E3（G3 驻留 + 点击外退出）、FT3-E5（Escape 退出）。
- 全量门禁：Vitest 436 例、Playwright 42 例（38 存量 + 4 新增用例 FT3-E1/E2/E3/E5）全绿；
  tsc/eslint/vite build 通过。

### 9.7 已知限制（回写）

- 选区与 token 相交但不覆盖其标记、也不完全落在内容区的极端部分重叠场景（case D）保守处理；
- 键盘快捷键（Ctrl+B 等）仍折叠光标，不触发工具栏驻留；
- display math（`$$…$$`）、图片粘贴、列表间互转等 FT2 范围外事项不变。

### 9.8 C10 跨多 token 逐 token 拆分（2026-08-08）

- `kernel/inlineLexer.ts`：新增 `findIntersectingStyleTokens`（复数，DFS 递归含 children，
  文档序返回全部与选区相交的同风格成对 token）；`findIntersectingStyleToken`（单数）改为复用之。
- `formatCtrl.ts` Step 0 归一化统一化：对每个相交 token，若覆盖 open/close 边界标记
  （`touchesOpen`/`touchesClose`）或选区完全落在内容区内（`insideContent`）→ 整 token 剥离。
  收集全部 open/close 标记区间，降序剥离文本；恢复选区经 `removedBefore(x)` 前缀剥离量映射。
- 行为矩阵扩展（G1 完整落地）：
  - `a **b** c` 选区 `[4,9)`（跨 token 覆盖 close）→ 解除为 `a b c`（原：保守包裹叠加）；
  - `a **b** c **d** e` 选区 `[4,13)` / `[4,12)`（跨两 token）→ 均解除为 `a b c d e`；
  - case A 补全：`**abc**` 选区 `[2,4)`（内容区内部分选区）→ 解除为 `abc`（原：叠加 `****`）。
- E2E 新增 FT3-E6：跨多 token 选区点加粗 → 两 token 均解除、无 `****`、`strong` 计数 0。
- 全量门禁：Vitest 447 例、Playwright 43 例全绿；tsc/eslint/vite build 通过。

### 9.9 C12 跨风格叠加（bold+italic 三连 `***`，2026-08-09）

- **问题**：对 `**a**`（strong）内内容点斜体，text 层正确生成 `***a***`（既有 toggle 叠加），
  但 lexer `matchEmphasis` 只识别 `*`/`**`，把三连星解析成 strong 包裹 `*a` 字面 → 斜体不渲染、星号异常。
- `kernel/inlineLexer.ts` `matchEmphasis`：新增三连 `***` / `___` 识别，解析为**外层 em（openLen 1）+ 内层 strong（openLen 2）**
  的嵌套 token（`contentStart=start+1` / `contentStart=start+3`），使渲染、strip、Step 0 按各风格逐层贯通：
  - 渲染：`renderInline('***a***')` → `<em>*<strong>**a**</strong>*</em>`（无字面残缺）；
  - 解除：`***a***` 全选点 bold → `*a*`；点 italic → `**a**`；选内容 `a` 点 bold/italic 同理（case A）；
  - 橡皮擦 / 去重：`stripInlineSyntax` / `stripSameStylePairs` 逐层剥离。
- 保守边界：四连开头（`****abc****`）与 close 后紧跟同字符（`***a****`）不闭合；紧邻前一字符为词字符时退化为既有
  double/单分支（避免 `a___b___c` intraword 行为变化）。
- 行为矩阵补充（跨风格，G1 延伸）：
  | 原文 | 选区 | 期望 |
  | ---- | ---- | ---- |
  | `**a**` | `a`（`[2,3)` 内容区） | 斜体叠加 → `***a***` |
  | `*a*` | 全选 | 加粗叠加 → `***a***` |
  | `***a***` | 全选 / 内容 `a` | 点 bold → `*a*`；点 italic → `**a**` |
- E2E 新增 FT3-E7：加粗后再斜体 → `***` 渲染 em 内嵌 strong、无字面 `*` 污染。
- 全量门禁：Vitest 460 例、Playwright 44 例全绿；tsc/eslint/vite build（render）通过。
- 遗留：`***` 选区全选时工具栏 B/I active 高亮判定（`isBoundedWrap` 不可延伸规则）不显示双高亮，交互面后续处理。
