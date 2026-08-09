# TDD 证据文档：PLAN-EDIT-FT4 跨风格叠加畸形修复 + 灰度拖选标记移位（G-① / G-②）

> 日期：2026-08-09 | 需求：[docs/requirements.devflow.md](../requirements.devflow.md) §4.3 / §7
> 计划：[docs/plan.md](../plan.md)（PLAN-EDIT-FT4）
> 风险等级：L3（编辑器核心交互/内核行为修改；本文件由复现智能体 AGT-0 维护）
> 状态：AGT-B（lexer 相邻混合强调 + formatCtrl 跨风格折叠）与 AGT-C（渲染断言）已闭环；AGT-D（G-② 删除/光标路径）待做

## 1. 任务 → 测试目标 → 红/绿证据映射

| 用例 | 任务点 | 测试目标 | 红阶段 | 绿阶段 |
| --- | --- | --- | --- | --- |
| DSG-R1 | G-② 删除路径 | 拖选 `粗**` 后 Backspace → 无未闭合 `**`、无残体移位 | ❌ RED（见 §复现记录） | 待 AGT-D |
| DSG-R2a | G-② 格式化路径（斜体） | 同拖选点斜体 → 无畸形叠加、标记不移位 | ❌ RED（见 §复现记录） | ✅ AGT-B/C 已闭环（`**加*粗***` 文本层 + 渲染嵌套无字面残体） |
| DSG-R2b | G-② 格式化路径（下划线） | 同拖选点下划线 → `<u>` 不包入 `**` | ❌ RED（见 §复现记录） | ✅ AGT-B 已闭环（formatCtrl 跨风格折叠 → `**加<u>粗</u>**`） |
| DSG-R3 | G-② 光标恢复路径 | 拖选后点击中部/方向键 → 光标不落标记内、键入不分裂标记 | ❌ RED（见 §复现记录） | 待 AGT-D |
| DSG-P | 程序化选区对照 | 拖选与 `selectTextRange` 端点/产出一致 → 区分两变量 | 端点一致✅、畸形❌ RED | 待 AGT-D |

## 2. 复现记录（Phase 0，Step 0.1；触发路径 × 实际输出）

复现 spec：`e2e/drag-selection-markers.spec.ts`（5 例，当前 **5 failed = 预期 RED**）。
运行命令：`npx playwright test e2e/drag-selection-markers.spec.ts`
前置条件全部满足：真实拖选选区文本 = `粗**`（`user-select:none` 在 contentEditable 内失效，标记可选中）。

| 用例 | 操作序列 | 实际输出（序列化文本） | 期望（安全口径） | 结论 |
| --- | --- | --- | --- | --- |
| DSG-R1 | 输入 `**加粗**` → 拖选 `粗**` → `Backspace` | `"**加"` | `**加**` 或 `加`（无未闭合 `**`） | **未闭合标记残体**：close 标记 `**` 被当作内容删除 |
| DSG-R2a | 同拖选 → 点斜体 | `"**加*粗***"` | 斜体干净包裹 `粗`、加粗标记原位（U1 叠加语义） | **畸形混合叠加**：`*` 插入与 close 标记交错，渲染字面 `*` 残体（对标 4.1 `**12*3***`） |
| DSG-R2b | 同拖选 → 点下划线 | `"**加<u>粗**</u>"` | `<u>` 内不得出现字面 `**` | **`<u>` 把 close 标记当内容包入**，产生字面残体 |
| DSG-R3(a) | 拖选 → 点击内容中部 | 光标偏移 = 3，文本 `**加粗**` | 同左 | ✅ 内容中部点击正常（未复现） |
| DSG-R3(b) | 拖选 → `ArrowLeft`×3 → 键入 `X` | 光标偏移 = **1**（open 标记两星之间）；键入后 `"*X*加粗**"` | 光标吸附内容边界（0/2），键入不分裂标记 | **光标落入标记内部 → 键入分裂标记**成残体 |
| DSG-P | 拖选 vs `selectTextRange(3,6)` 点斜体 | 两者均 `"**加*粗***"`，端点 {3,6} 一致 | 两变量等产出；产出无畸形 | **拖选与程序化选区产出完全一致 → 问题源于「选区含标记」而非「拖选本身」** |

## 3. 修复面结论（供 AGT-D Phase 3 定稿）

1. **三条路径全部触发移位/畸形**：删除（R1，原生 Backspace 把 close 标记当内容删掉 → `**加`）、格式化（R2a/R2b，`getCursorOffsets` 读到的 `[3,6)` 含 close 标记 → Step 2 裸包裹 → `**加*粗***`/`**加<u>粗**</u>`）、光标恢复（R3b，箭头导航光标进入 `.md-syntax` 标记文本内部 → 键入分裂标记）。R3a（点击内容中部）未复现问题。
2. **根因 = `selection.ts` 偏移映射**（U3 路径层成立）：`getCursorOffsets`/`offsetInBlock`（selection.ts:13-33、102-107）把 `.md-syntax` 标记字符计入文本偏移；格式化路径（FloatingToolbar `computeToolbarState` → `getCursorOffsets`）与删除路径（`getCursorOffsets`/`getCrossBlockSelection`→`offsetInBlock`）均以含标记偏移操作。
3. **`useCrossBlockDragSelection` 不放大问题**：同块拖选 `startSpan === endSpan` 时不写入选区（useCrossBlockDragSelection.ts:154），拖选由浏览器原生完成，端点与程序化 `selectTextRange(3,6)` 完全一致（DSG-P 端点断言通过）。无需在该 hook 增加端点计数修正。
4. **AGT-D（Phase 3）建议改动文件**（基线）：
   - `kernel/selection.ts`：新增 `mapSelectionToContent` / `mapContentToSelection` 标记感知映射（复用 `foldSelectionToContent`）。
   - `blocks/ContentBlock.tsx`：`handleKeyDown` Backspace/Delete 单块内选区含标记时拦截 → 程序化删除（映射后 `setBlockText`+`renderBlock`）；`setCursorAtOffset`/`offsetToDomPoint` 光标吸附内容边界。
   - `components/Editor/v2/EditorV2.tsx`：`onDeleteRange` 入参偏移映射；块强制同步 DOM 路径核对。
   - 与 G-① 关联：R2a 的 `**加*粗***` 文本层正确性依赖 AGT-B（`formatCtrl` Step 0 跨风格折叠 + lexer 相邻混合强调）。**AGT-B 与 AGT-C 已完成（见 §3.1），Phase 3 依赖解除。**

## 3.1 AGT-B / AGT-C 闭环证据（G-① 跨风格叠加畸形）

- **lexer 相邻混合强调**（`src/render/editor/kernel/inlineLexer.ts`）：`matchEmphasis` 新增 close run 拆分——当 close 处为连续 run 且内容区存在待闭合内层强调时，本 token close 取 run 后缀、前缀留给内层。`**12*3***` → `strong[0,9)` 内嵌 `em[4,7)`；`****abc****`（无内层待闭合）保持既有 close 前缀语义。新增 `countMarkerRun` / `hasPendingInnerEmphasis`。
- **formatCtrl 跨风格折叠**（`src/render/editor/controllers/formatCtrl.ts`）：Step 2 包裹前 `foldCrossStyleMarkers` 把选区首尾他风格成对标记移出选区（尾部 close 需 `before` 含配对 open、头部 open 需 `after` 含配对 close；core 空时回退）。`**ab**` 选 `b**` 点 underline → `**a<u>b</u>**`。
- **渲染断言**（`tests/editor/kernel/inlineRenderer.test.ts`）：`**加*粗***` / `**12*3***` 渲染嵌套 strong+em，textContent 与源串一致；两两风格组合无残体。
- **测试统计**：inlineLexer 44 · inlineRenderer 29 · formatCtrl 6（新增）· 全量 vitest 474 通过，eslint / tsc 干净。

## 4. 遗留问题 / 风险

- ~~DSG-R2a 的期望字符串与 AGT-B 的目标输出相同（`**加*粗***`）~~：已闭环，`inlineRenderer` 断言无字面残体、textContent 与源串一致（§3.1）。
- R1 的安全删除目标（`**加**` 保留标记 或 `加` 整 token 删除）在 S4 语义下未定死，AGT-D 需明确「选中含标记 → 删除后标记处置」的决策口径。
- 方向键进入标记内部（R3b 光标偏移 1）的 Chromium 原生行为无法经 CSS 阻止，只能靠操作路径吸附收敛（U3 路径层，非 DOM 层）。
- 其余 Phase（AGT-A/B/C/E/F）的证据待对应智能体补充；本文件为骨架，各阶段完成后回写红/绿统计。

## 5. 验收核对（Phase 0）

- [x] 复现 spec `e2e/drag-selection-markers.spec.ts` 存在且可运行（5 failed = 预期 RED）
- [x] 触发路径 × 实际输出已采集（§复现记录）
- [x] 修复面结论已给出（§3），AGT-D 据此定稿
- [ ] Step 0.2 人工评审门（确认修复面与文件清单）——待总指挥/用户确认
- [ ] 未触碰任何生产代码；未修改 `docs/plan.md` / `docs/requirements.devflow.md`
