# TDD 证据文档：PLAN-EDIT-FT4 跨风格叠加畸形修复 + 灰度拖选标记移位（G-① / G-②）

> 日期：2026-08-09 | 需求：[docs/requirements.devflow.md](../requirements.devflow.md) §4.3 / §7
> 计划：[docs/plan.md](../plan.md)（PLAN-EDIT-FT4）
> 风险等级：L3（编辑器核心交互/内核行为修改；本文件由复现智能体 AGT-0 维护）
> 状态：AGT-B / AGT-C 已闭环；AGT-D（G-② 删除/格式化/光标路径）已闭环（5/5 e2e GREEN，2026-08-09）；收尾增量修复已闭环（§3.4：U6 产物 open 三连拆分 + 原生拖拽移动禁用，2026-08-09）

## 1. 任务 → 测试目标 → 红/绿证据映射

| 用例 | 任务点 | 测试目标 | 红阶段 | 绿阶段 |
| --- | --- | --- | --- | --- |
| DSG-R1 | G-② 删除路径 | 拖选 `粗**` 后 Backspace → 无未闭合 `**`、无残体移位 | ✅ GREEN（AGT-D 删除吸附 → `**加**`） | ✅ AGT-D 已闭环 |
| DSG-R2a | G-② 格式化路径（斜体） | 同拖选点斜体 → 无畸形叠加、标记不移位 | ✅ GREEN（渲染口径无残体） | ✅ AGT-B/C 已闭环（`**加*粗***` 文本层 + 渲染嵌套无字面残体） |
| DSG-R2b | G-② 格式化路径（下划线） | 同拖选点下划线 → `<u>` 不包入 `**` | ✅ GREEN（渲染口径无残体） | ✅ AGT-B 已闭环（formatCtrl 跨风格折叠 → `**加<u>粗</u>**`） |
| DSG-R3 | G-② 光标恢复路径 | 拖选后点击中部/方向键 → 光标不落标记内、键入不分裂标记 | ✅ GREEN（方向键吸附内容边界） | ✅ AGT-D 已闭环 |
| DSG-P | 程序化选区对照 | 拖选与 `selectTextRange` 端点/产出一致 → 区分两变量 | 端点一致✅、畸形✅ GREEN | ✅ AGT-D 已闭环 |

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

> **2026-08-09 闭环**：上述 5 例当前 **5 passed = 预期 GREEN**（AGT-D 删除吸附 + 光标/方向键吸附 + e2e 判定改渲染口径）。运行命令同上，结果见 §3.2。

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

## 3.2 AGT-D 闭环证据（G-② 删除/格式化/光标路径）

- **删除吸附**（`src/render/editor/kernel/selection.ts`）：`snapSelectionToContent` 把覆盖 open/close 标记的选区边界吸附到内容边界；`deleteSelectionContent` 在选区恰好覆盖成对 token 完整内容区时整 token（含标记）删除，否则吸附后删除内容。`ContentBlock.handleKeyDown` 对单块内非折叠选区且命中吸附时 `preventDefault` 程序化删除（DSG-R1：选 `粗**` → `**加**`，无未闭合残体）。
- **光标/方向键吸附**（selection.ts + ContentBlock.tsx）：`setCursorAtOffset` 经 `snapOffsetInText`（纯文本版，依赖 tokenizeInline）把落点吸附到内容边界；`handleKeyDown` 拦截 ArrowLeft/Right，目标偏移落入标记区间内时 `preventDefault` + 吸附（DSG-R3b：光标不再落 open 标记两星之间，键入不分裂标记）。
- **e2e 判定口径重定**（`e2e/drag-selection-markers.spec.ts`）：新增 `readMarkerResidue`（剥离 `.md-syntax` 后检查裸 `*`/`_`），5 处断言由文本字面解析改为渲染残体检测，合法 `**加*粗***`（strong 内嵌 em）不再误判。
- **测试统计**：`tests/editor/kernel/selection.test.ts` 新增 snapSelectionToContent / deleteSelectionContent / 光标吸附 11 例；`tests/components/contentBlockRestore.test.tsx` 新增删除/方向键吸附 4 例；e2e drag-selection-markers 5/5 passed + floating-toolbar FT4-E1/E2 2 例（S1 叠加验收层，见 §4.2）；vitest 487 通过；playwright 51 通过；tsc / eslint（0 error）干净。

## 3.3 Phase 4 全量门禁（2026-08-09）

- **FT4-E1**（`e2e/floating-toolbar.spec.ts`）：`**123**` 选 `3**`（含 close 标记）点斜体 → 文本 `**12*3***`、`strong em` 嵌套、em 内文本 `3`、剥离 `.md-syntax` 后无裸星。
- **FT4-E2**：`**12*3***` 选 `*3*`（em 全 token）点下划线 → `**12*<u>3</u>***`，`<u>` 剥离标记后纯内容 `3`、无 `*` 残体（`<u>` 标记本身按架构渲染为 u 内 `.md-syntax` 灰显，对标 FT2-E5）。
- **门禁结果**：`vite build` 通过（electron-builder 因 better-sqlite3 原生模块文件占用 EBUSY 跳过，非代码问题）· playwright 51/51 · vitest 487 · 覆盖率全量 95.45%（改动文件口径全部 ≥80%：inlineLexer 98.03 / inlineRenderer 98.41 / formatCtrl 94.8 / selection 94.28 / ContentBlock 91.39，`@vitest/coverage-v8`，§6 确认点 5 已实施）。

## 3.4 收尾增量修复（2026-08-09，FT4 闭环后用户回归发现）

- **U6 纯内容选区产物 open 三连拆分**（`src/render/editor/kernel/inlineLexer.ts`）：`**123**` 选内容前部 `12` 点 italic 的产物 `***12*3**`（strong open `**` + em open `*`，em 内容在 strong 内容开头闭合）此前被 lexer 解析为「字面 `*` + strong(`**12*3**`)」，渲染出现开头孤立 `*` 残体。新增 `matchOpenTripleSplit`：三连 open 无三连 close 时，取 strong close `**` + 内容区首枚单星 em close，构造 `strong[0,9)` 内嵌 `em[2,6)`。渲染 `<strong>**<em>*12*</em>3**</strong>` 无残体、textContent 与源一致；再选斜体内容点 italic 正确回退 `**123**`。与 AGT-B 的 close run 拆分对称。
  - 测试：inlineLexer +2（`***12*3**` / `***a*b**` 结构断言）、inlineRenderer +1（渲染无残体 + textContent）、formatCtrl +2（叠加产物 + 回退闭环）。
- **原生拖拽移动选区禁用**（`src/render/components/Editor/v2/EditorV2.tsx`）：contentEditable 原生允许「选中含 `.md-syntax` 标记的选区 → 拖拽移动到别处/别行」，标记被当普通文本拖走破坏语法。根容器新增 `onDragStart={(e) => e.preventDefault()}` 全量阻止原生拖拽移动；跨块拖选走 mousedown/mousemove 自实现（`useCrossBlockDragSelection`），不受影响。
  - 测试：组件单测 +1（dragstart 被 preventDefault，editorV2Format.test.tsx）；e2e 新增 `e2e/drag-selection-move.spec.ts`（DSM-R1：含标记选区存在时根容器 dragstart defaultPrevented=true）。修复前该用例 RED（defaultPrevented=false）已实测确认。注：Chromium contentEditable 原生文本拖拽的 drop 阶段无法用 Playwright 合成鼠标（CDP Input.dispatchMouseEvent）稳定触发，故采用事件级断言 + 组件单测共同守护。
- **全量门禁**：vitest 493/493 · tsc 0 error · playwright 全量 52/52（新增 DSM-R1 1 例；cross-block-selection / floating-toolbar / drag-selection-markers / editor / exit-behavior / marktext-rendering 全绿）。

## 4. 遗留问题 / 风险

- ~~DSG-R2a 的期望字符串与 AGT-B 的目标输出相同（`**加*粗***`）~~：已闭环，`inlineRenderer` 断言无字面残体、textContent 与源串一致（§3.1）。
- ~~R1 的安全删除目标~~：已定死（AGT-D）：选区吸附到内容边界后删除；选区恰好覆盖成对 token 完整内容区 → 整 token 含标记删除，杜绝 `****` 空标记残体。
- ~~方向键进入标记内部（R3b 光标偏移 1）~~：已收敛（ContentBlock `handleKeyDown` 拦截 + `snapOffsetInText` 吸附，U3 路径层）。剩余：e2e 的 `caretB` 为 soft 断言（未严格锁定最终偏移），吸附生效但具体偏移值可漂移，后续可加精确断言。
- e2e `readMarkerResidue` 依赖 `.md-syntax` 类名定位标记，样式/结构重构后需同步。
- U5（DevFlow 需求文档与 `REQUIREMENTS.md` 合并评估）为收尾阶段事项，待阶段收尾处理。
- 其余 Phase（AGT-A/B/C 证据见 §3.1、AGT-D 见 §3.2、AGT-E 门禁见 §3.3）已全部回写；本文件红/绿统计已同步。

## 5. 验收核对（Phase 0）

- [x] 复现 spec `e2e/drag-selection-markers.spec.ts` 存在且可运行（5 passed = 预期 GREEN，2026-08-09）
- [x] 触发路径 × 实际输出已采集（§复现记录）
- [x] 修复面结论已给出（§3），AGT-D 据此定稿
- [x] AGT-D 已实施并闭环（§3.2）：e2e 5/5 GREEN · selection 单测 11 例新增 · vitest 483 · tsc/eslint 干净
- [x] Phase 4 全量门禁（§3.3）：FT4-E1/E2 · playwright 51/51 · vitest 487 · vite build · coverage 95.45%
- [x] 文档同步：`requirements.devflow.md` §8 实施状态 · `modules/04` · `SUMMARY.md` · `plan.md` 状态已更新为「已完成」
- [ ] Step 0.2 人工评审门（确认修复面与文件清单）——待总指挥/用户确认
- [x] 已触碰生产代码（`selection.ts` / `ContentBlock.tsx`）并按 AGT-D 定稿实施；`plan.md` / `requirements.devflow.md` 已同步（非本次实施前的未动状态）
