# Implementation Plan: PLAN-EDIT-FT4 跨风格叠加畸形修复 + 灰度拖选标记移位（G-① / G-②）

> 计划编号：**PLAN-EDIT-FT4** | 状态：**待评审（需用户批准后开工）** | 更新：2026-08-09
> 关联需求：[docs/requirements.devflow.md](requirements.devflow.md)（阶段 1 需求定稿，决策 U1-U5 已确认）
> 关联规范：SPEC-EDIT-FT3（C10/C11/C12）、SPEC-EDIT-FT2、SPEC-EDIT-FT、SPEC-EDIT-DSF
> 执行引擎：TDD 红绿循环（tdd-workflow）｜风险等级：**L3**（需人工确认）

---

## 1. 范围与边界

### 本次 In（仅规划以下，其余不动）
- `formatCtrl` Step 0 归一化扩展为**跨风格**（G-①，U1 叠加语义）。
- `inlineLexer` 相邻混合强调解析扩展（**U2 → B：全部行内风格两两组合**），超范围保守回退字面量、不抛错。
- **纯内容部分选区（U6，已决策纳入范围）**：`**abc**` 选 `ab`（纯内容、不覆盖标记）点异风格 → 同样归一化，包裹时与相邻异风格标记正确合并、不产生畸形序列。
- 灰度模式下选区/拖选涉及 `.md-syntax` 标记字符的偏移安全（G-②，U3 路径层修复）——**修复面以 Phase 0 复现结论为准**。
- 新增/修改 Vitest 单测与 Playwright E2E（含 G-② 拖选复现用例）。
- 文档同步：需求/规范、`modules/04`、`SUMMARY.md`、TDD 证据（`docs/testing/spec-edit-ft4.tdd.md`）。

### 范围外（Out，明确不处理）
- `.md-syntax` 灰度显示规则本身（方案 B：非聚焦隐藏、聚焦灰显）——保持，除非用户另行确认。
- 块级语法（列表 marker、任务复选框、标题 `::before`、引用竖线）——contenteditable=false 装饰，独立机制。
- 工具栏驻留 / 尺寸 / 块转换矩阵（FT3 已定，零变化）。
- display math `$$…$$`、图片粘贴、列表互转等既有范围外事项。
- 键盘快捷键路径（`Ctrl+B` 等）——共用 formatCtrl，需回归确认，**不改其折叠光标语义**。
- 不新增第三方运行时依赖（覆盖率工具为 devDependency，见 §6 确认点）。

---

## 2. 任务分解与依赖图

| 子任务 | 阶段 | 生产文件 | 测试文件 | 依赖 | 并行性 |
| --- | --- | --- | --- | --- | --- |
| AGT-0 G-② 拖选复现（决策 U4） | 0 | —（仅 E2E） | `e2e/drag-selection-markers.spec.ts`（新增） | 无 | Wave 0 先行 |
| AGT-A inlineLexer 相邻混合强调（U2→B） | 1 | `kernel/inlineLexer.ts` | `kernel/inlineLexer.test.ts`（扩） | 无 | Wave 1 并行（与 0 无依赖） |
| AGT-B formatCtrl Step 0 跨风格折叠（G-①） | 2 | `controllers/formatCtrl.ts`、`kernel/inlineLexer.ts`（新增纯函数 `foldSelectionToContent`） | `controllers/formatCtrl.test.ts`（扩） | A | Wave 2 串行 |
| AGT-C 渲染断言（两两组合，S2 口径） | 2b | —（仅测试） | `kernel/inlineRenderer.test.ts`（扩） | A | Wave 2 并行 |
| AGT-D G-② 标记偏移安全（U3 路径层） | 3 | `kernel/selection.ts`、`blocks/ContentBlock.tsx`、`v2/EditorV2.tsx`、`kernel/blockTree.ts`（视复现） | `kernel/selection.test.ts`（扩）、`components/editorV2Format.test.tsx`（扩）、`controllers.test.ts`（扩） | **0 复现结论** + B | Wave 3 串行 |
| AGT-E E2E 验收 + 全量回归 | 4 | —（文档为主） | `e2e/floating-toolbar.spec.ts`（FT4-E1/E2）、`e2e/drag-selection-markers.spec.ts`（转正） | A~D | Wave 4 串行 |
| AGT-F 文档同步 + 收尾门禁 | 4 | —（文档） | docs 回写 + 覆盖率报告 | E | Wave 4 串行 |

```
Wave 0（先行，必须最先）：AGT-0   G-② 拖选复现 → 产出复现证据（RED 确认移位触发路径）
Wave 1（并行）：AGT-A（lexer 内核，与复现无依赖，可同步启动）
Wave 2（并行）：AGT-B（Step 0 跨风格，依赖 A）∥ AGT-C（渲染断言，依赖 A）
Wave 3（串行）：AGT-D（G-② 修复，依赖 Wave 0 复现结论 + B 的 foldSelectionToContent 复用）
Wave 4（串行）：AGT-E（E2E 转正 + 新增 FT4 用例）→ AGT-F（全量门禁 + 文档）
```

> **关键纪律**：AGT-0 复现未产出结论前，**禁止**进入 AGT-D 的实现设计（避免在猜测上修复）。AGT-A/B/C（G-① 线）不依赖复现，可与复现并行推进。

---

## 3. 阶段计划

### Phase 0：G-② 拖选复现前置任务（决策 U4）——【必须最先】

**目标**：用 Playwright 真实 Chromium 确认"移位"的具体触发路径（删除 / 格式化 / 光标恢复），产出可复现证据，再定修复面。**只写测试与证据，不改生产代码。**

**Step 0.1 新建拖选复现 spec**（文件：`e2e/drag-selection-markers.spec.ts`，新增）
- Action：新建 spec，复用 `mockApi`/`openEditor` 模式（对标 `cross-block-selection.spec.ts`）。新增辅助：
  - `focusBlock(page)`：点击块内容使块聚焦（`.md-syntax` 灰显占位、占真实宽度）；
  - `dragSelectMarkers(page, text)`：用 `mouse.down/move/up` 真实鼠标拖选**含标记字符的区间**（先 `focusBlock` 再取 `.md-syntax` 的 boundingBox 定位标记坐标，从内容字符拖到 close 标记上，steps≈10）；
  - `readSerialized(page)`：读取 `.editor-content-area` 的 textContent（去零宽）与 `getMarkdown` 等价序列化结果。
- 三个复现用例（**预期当前 RED——确认移位现象**）：
  - **DSG-R1（删除路径）**：输入 `**加粗**` → 聚焦 → 鼠标拖选 `粗**`（内容尾 + close 标记）→ 按 `Backspace`/`Delete` → 断言序列化文本无畸形（无未闭合 `**`、无残体 `*` 移位）。
  - **DSG-R2（格式化路径）**：同拖选 → 点工具栏斜体/下划线 → 断言无标记移位、无畸形叠加。
  - **DSG-R3（光标恢复路径）**：拖选含标记后点击内容中部 / 按方向键 → 断言光标落点与序列化文本无异常。
  - 另附**程序化选区对照**（复用 `selectTextRange` 式辅助选 `[s,e)` 含标记区间）→ 区分"拖选本身"与"选区含标记"两个变量（DSF 已有 `useCrossBlockDragSelection` 端点检测，需确认其不放大问题）。
- Why：决策 U4；根因 4.3 显示 `getCursorOffsets`/`offsetInBlock` 将标记计入偏移，但**具体触发路径未实测**，必须先复现再设计。
- Dependencies：无
- Risk：低（仅新增 E2E，不改生产）
- 验收产出：复现证据写入 `docs/testing/spec-edit-ft4.tdd.md`（§复现记录：触发路径 × 实际输出），并给出**修复面结论**（AGT-D 方案据此定稿）。

**Step 0.2 复现结论评审（人工决策门）**
- Action：汇总 DSG-R1/R2/R3 结果，确认：
  - 移位是否由 `selection.ts` 偏移映射引起（U3 路径层）？
  - 是否还需覆盖 `useCrossBlockDragSelection.ts`（拖选端点落在标记字符上时 `dragStart.startOffset` 的计数口径）？
- 产出：复现结论更新到本计划（或 TDD 文档），AGT-D 的具体文件清单与改动面据此锁定。

---

### Phase 1：inlineLexer 相邻混合强调解析扩展（U2 → B 全部两两组合）——【L3 中高风险】

**目标**：`**12*3***`、`**12***3***`、`**12*<u>3</u>***` 等相邻/嵌套混合强调可干净解析为结构化 token；`*`/`_` delimiter 支持 run 拆分（一 run 多语义）；超范围保守回退字面量、不抛错。token 结构契约（`openLen/closeLen/contentStart/contentEnd/children`）保持兼容，确保 strip / Step 0 / 渲染三路径零语义回退。

**Step 1.1（TDD RED）写入解析矩阵单测**（文件：`tests/editor/kernel/inlineLexer.test.ts`，新增 describe「相邻混合强调（PLAN-EDIT-FT4）」）
- Action：先写失败用例，覆盖：
  - `**12*3***` → strong `[0,9)`（contentEnd=7），children 含 em `[4,7)`（content `3`）；
  - `**12***3***` → strong + 相邻 em(strong) 组合的结构断言（具体结构以实施验证为准，单测锁定）；
  - `__12_3__` / `___` 系下划线相邻混合；
  - 两两组合解析矩阵（bold/italic/underline/strike/highlight/code/math 任两组合，对标 S2）：
    - `**~~x~~**`、`~~**x**~~`、`==**x**==`、`**==x==**`、`**`x`**`、`**$x$**`、`$**x**$`、`<u>*x*</u>`、`*<u>x</u>*`、`*==x==*` 等（含嵌套顺序正反两种）；
  - 保守回退：`**x`、`a**b`、`***x`、孤立 `*`、无法配对的 run → **不抛错**、按字面文本（无 token 或仅 escape）；
  - 回归锚点：三连 `***a***` → em(strong) 结构不变、四连 `****abc****` 降级、intraword `foo_bar_baz` 不识别、`\*` 转义。
- Why：U2 → B；根因 4.2（`matchEmphasis` 只支持 `*`/`**`/整体 `***`）。
- Dependencies：无
- Risk：L3（lexer 是渲染/strip/Step 0 共用层，改动面大）

**Step 1.2（TDD GREEN）实现 delimiter 栈式强调解析**（文件：`src/render/editor/kernel/inlineLexer.ts`）
- Action：
  1. 将 `matchEmphasis` 单点匹配改造为 **delimiter run 扫描 + 配对**：收集 `*`/`_` 连续 run（含 canOpen/canClose 判定：前后字符、intraword `_` 规则、空格边界），按配对规则生成 em/strong token；
  2. **run 拆分**：一个 run 可拆为「strong-close + em-open」或「em-close + strong-close」等（支撑 `**12*3***` 的 em close 与 strong close 相邻、`***` 三连与嵌套）；
  3. 嵌套 children 递归沿用 `tokenizeInline`；
  4. 无法配对的 run → 字面量（**绝不 throw**）；
  5. 保持既有导出与 token 契约不变（`STYLE_TOKEN_TYPE`、`findIntersectingStyleTokens` 等签名零变化）。
- Why：支撑 G-① 叠加产物干净解析（S1/S2），且 strip/Step 0 共用同一识别路径。
- Dependencies：Step 1.1
- Risk：L3——需重点回归「嵌套 / 三连 / 四连降级 / intraword / 转义」既有行为（FT3 C11/C12 单测即回归锚点）。

**Step 1.3（TDD REFACTOR）**：消除重复 run 扫描逻辑、补充边界用例（marker 与内容紧邻、run 长度 ≥4 的拆分优先级）。

---

### Phase 2：formatCtrl Step 0 跨风格归一化（G-①）——【L3 中高风险】

**目标**：选区含**异风格** token 边界标记时，先折叠选区到纯内容，再按叠加语义应用目标格式；选区映射（`restoreSelection`）正确。

**Step 2.1（TDD RED）写入 formatCtrl 跨风格矩阵单测**（文件：`tests/editor/controllers/formatCtrl.test.ts`，新增 describe「Step 0 跨风格折叠（PLAN-EDIT-FT4）」）
- 行动：先写失败用例，覆盖：
  - `**123**` 选区 `[4,7)`（`3**`，含 close 标记）点 italic → `**12*3***`（叠加，加粗保留），且 `renderInline` 无字面 `*`；
  - `**123**` 选区 `[0,5)`（`**123`，含 open 标记）点 italic → `***123***`（三连叠加）；
  - `**12*3***` 选区 `[4,7)`（`*3*`，em 全 token）点 underline → `**12*<u>3</u>***`（em 标记保留在 `<u>` 外）；
  - **U6 纯内容部分选区**：`**abc**` 选区 `[2,4)`（纯内容 `ab`，不覆盖标记）点 italic → `***ab**c**`（三连合并，无畸形）；`**abc**` 选区 `[3,4)`（`b`）点 italic → `**a*<em>b</em>c**`（单字符内部包裹）；
  - 各风格两两叠加矩阵（bold×italic / bold×strike / italic×highlight / underline×strike / bold×math / bold×code 等）；
  - 折叠后 `restoreSelection` 映射断言（原选区 `[s,e)` → 新文本内容区间，含折叠掉的标记字符偏移修正）；
  - 保守：选区折叠后为空（纯标记选区）→ 不抛错、落到最近内容边界；
  - 回归锚点：FT3 C10（跨多 token 逐 token 拆分）、C11/C12（`***` 三连解除/叠加）全部原断言不变。
- Why：根因 4.2（Step 0 按 `STYLE_TOKEN_TYPE[style]` 单类型过滤，异风格时 toStrip 空 → 裸包裹）。
- Dependencies：Phase 1（Step 0 判定基于 tokenizeInline，lexer 变化先行合入）

**Step 2.2（TDD GREEN）实现 `foldSelectionToContent` 纯函数**（文件：`src/render/editor/kernel/inlineLexer.ts`）
- Action：新增导出纯函数（供 formatCtrl 与 selection 复用）：
  ```
  foldSelectionToContent(text, style, s, e): { start; end } | null
  // 对每个与选区相交的【异风格】成对 token T：
  //   s' = max(s, T.contentStart)   当 s < T.contentStart（选区伸入 open 标记）
  //   e' = min(e, T.contentEnd)     当 e > T.contentEnd（选区伸入 close 标记）
  // 多 token 逐 token 折叠；s'>=e' 时保守回退到最近内容边界；不抛错。
  ```
- Why：U1 叠加语义——"选区折叠到纯内容后应用新格式，格式共存不覆盖"。
- Dependencies：Step 2.1

**Step 2.3（TDD GREEN）formatCtrl Step 0' 接线**（文件：`src/render/editor/controllers/formatCtrl.ts`）
- Action：在现有 Step 0（同风格解除）之后、Step 1/Step 2 之前插入跨风格折叠分支：
  1. 同风格相交 token 命中 → 维持 FT3 现状（case A/B/C + C10 逐 token 解除）；
  2. 否则调用 `foldSelectionToContent`：若选区被折叠（`s'/e'` ≠ 原值）→ 用折叠后选区执行 Step 1 toggle-off / Step 2 包裹（`stripSameStylePairs` 作用于折叠后 selected）；
  3. **U6 纯内容部分选区**：选区本就在内容内但紧邻异风格标记（如 `**abc**` 选 `ab`）时，包裹插入点与相邻标记正确合并（`ab` → `***ab**`，即三连与既有 strong close 合并），不得产生 `**ab***c**` 式畸形序列——补充包裹插入点选择逻辑（与相邻异风格 delimiter 合并/调整 close 长度）；
  4. 恢复选区映射：包裹插入 open/close 于 `s'`，按 `removedBefore` 思路把新选区映射回含标记偏移的文本坐标系（`restoreSelection` 路径）；
  5. `clearFormat` 路径同步核对（橡皮擦对含标记选区应整 token 剥离，已由 `stripInlineSyntax` 覆盖，仅补回归断言）。
- Why：消除裸包裹产生畸形/残体（S1）。
- Dependencies：Step 2.2
- Risk：L3——行为变更（新增叠加路径），必须回归 FT3 C10-C12 与键盘路径折叠语义。

---

### Phase 3：G-② 标记偏移安全（U3 路径层，方案以 Phase 0 复现结论定稿）——【L3 中高风险】

**目标**：拖选/选区含 `.md-syntax` 标记字符时，后续操作（格式化/删除/光标恢复）不把标记当内容、标记不移位。**修复面严格以 DSG-R1/R2/R3 复现结论为准**（下文为基线设计，复现后可裁剪）。

**Step 3.1（TDD RED）selection 标记感知映射单测**（文件：`tests/editor/kernel/selection.test.ts`，新增）
- Action：先写失败用例：
  - `mapSelectionToContent(text, s, e)`：`**123**` 选区 `[4,7)` → `{4,5}`（内容 `3`）；`**12*3***` 选区 `[4,7)` → `{5,6}`；
  - 反向映射 `mapContentToSelection`：内容区间 → 含标记偏移区间（供恢复选区/光标）；
  - 与 `foldSelectionToContent` 结果一致（复用同一内核函数）。
- Why：根因 4.3（`getCursorOffsets`/`offsetInBlock` 将标记计入偏移）。
- Dependencies：Phase 2（复用 `foldSelectionToContent`）；**Phase 0 复现结论**

**Step 3.2（TDD GREEN）selection.ts 标记安全映射**（文件：`src/render/editor/kernel/selection.ts`）
- Action：新增 `mapSelectionToContent` / `mapContentToSelection` 纯函数（基于 `tokenizeInline` + `foldSelectionToContent`），文档化「偏移含标记字符」契约；`offsetInBlock`/`getCursorOffsets` 保持现有口径（textContent 一致），**仅操作路径映射**。
- Why：U3 A 路径层修复——不做 DOM 层禁止选中，修复选区/偏移映射对标记安全。

**Step 3.3（TDD GREEN）删除路径标记安全**（文件：`src/render/components/Editor/v2/blocks/ContentBlock.tsx`；`src/render/components/Editor/v2/EditorV2.tsx`；`src/render/editor/kernel/blockTree.ts` 视复现）
- Action（基线）：
  1. `ContentBlock.handleKeyDown`：Backspace/Delete 且为**单块内选区**时，先经 `mapSelectionToContent` 检测选区是否含标记字符；若含 → `preventDefault` → 新增 `onDeleteRange`（同块两参形式或新回调）走**程序化删除**（映射后 `setBlockText` + `renderBlock` + 恢复光标），不再依赖浏览器原生删除（原生会把标记字符当内容删掉）；
  2. 跨块删除（`getCrossBlockSelection` + `deleteLeafRange`）：入参偏移先经 `mapSelectionToContent` 映射（EditorV2.onDeleteRange 内做映射）；
  3. 光标恢复路径：若复现确认光标落在标记字符中间导致异常，`setCursorAtOffset`/`offsetToDomPoint` 增加「标记字符吸附到内容边界」的收敛（保守，不改变既有 textContent 口径）。
- Why：S4——拖选含标记执行格式/删除 → 标记不移位、序列化文本无异常。
- Dependencies：Step 3.1/3.2 + Phase 0 复现结论
- Risk：L3——改动键盘/删除主路径，须回归「跨块 Backspace 块树级删除（cross-block-selection 全量）」「六条退出规则」「backspaceCtrl 合并/降级」既有行为。

**Step 3.4（TDD REFACTOR）**：删除路径与格式化路径的映射逻辑收敛为同一内核函数（`selection.ts` 提供），避免双实现漂移。

---

### Phase 4：渲染断言、E2E 转正、全量回归与文档

**Step 4.1（TDD RED/GREEN）两两组合渲染断言**（文件：`tests/editor/kernel/inlineRenderer.test.ts`，新增 describe「两两组合渲染（S2）」）
- Action：`renderInline` 断言：`**12*3***` → 无字面 `*` 污染（对标 FT3-E7 断言方式：`em strong` 内文本纯净）；两两组合渲染（`**~~x~~**`、`==*x*==`、`<u>**x**</u>`、`**$x$**` 等）无 `.md-syntax` 外字面语法字符；`textContent` 与源一致。
- Why：S2 验收口径（渲染层无字面污染）。

**Step 4.2（E2E 转正 + 新增）**（文件：`e2e/drag-selection-markers.spec.ts` 转正；`e2e/floating-toolbar.spec.ts` 扩展）
- Action：
  - Phase 0 复现用例（DSG-R1/R2/R3）转正为验收用例（GREEN）：拖选含标记 → 删除/格式化/光标恢复均无移位、无畸形；
  - 新增 **FT4-E1**：`**123**` 选 `3**` 点斜体 → `em strong` 嵌套、无字面 `*`（对标 FT3-E7 断言方式）；
  - 新增 **FT4-E2**：`**12*3***` 选 `*3*` 点下划线 → `<u>` 内纯内容、`u` 内无 `.md-syntax` 标记字符；
  - 新增 **FT4-E3**（可选，视复现）：聚焦灰显下 `.md-syntax` 拖选可选（user-select:none 失效）行为守护。
- Why：S1/S2/S4 的 E2E 验收层。

**Step 4.3 全量回归门禁**
- Action：`npm test`（Vitest 全量）＋ `tsc --noEmit` ＋ ESLint 0 error ＋ `vite build` ＋ `npx playwright test` 全量；覆盖率报告（见 §6 确认点）。
- Why：S3/S5。

**Step 4.4 文档同步**（文件：`docs/requirements.devflow.md`、`docs/modules/04-编辑主区-Editor.md`、`docs/SUMMARY.md`、新建 `docs/testing/spec-edit-ft4.tdd.md`，可选新建 `docs/specs/floating-toolbar-cross-style-overlay.md`）
- Action：按 §7 完成标准同步状态、证据、遗留问题与下一任务；U5 决策评估需求文档与 `REQUIREMENTS.md` 合并方案（收尾阶段）。

---

## 4. 测试策略（TDD：RED → GREEN → REFACTOR）

### 4.1 原则
- 每个生产改动前先写失败用例（RED），实现（GREEN），收敛重构（REFACTOR）；每阶段可独立验收（命令见 §8）。
- 内核纯函数优先（inlineLexer / formatCtrl / selection），组件层最小化；E2E 覆盖真实 Chromium 交互路径。
- 覆盖率目标 **≥80%**（改动文件口径；全量按 vitest coverage 报告为准）。

### 4.2 新增/修改 Vitest 用例清单（基线 460 例，预计新增 ≈50–60 例 → ≈510–520 例）

| 文件 | 新增 describe | 用例数 | 覆盖 |
| --- | --- | --- | --- |
| `tests/editor/kernel/inlineLexer.test.ts` | 相邻混合强调 / 两两组合矩阵 / 保守回退 | ≈18–22 | `**12*3***`、`**12***3***`、`__`-系、7 风格两两组合解析、孤立 run 字面回退、不抛错 |
| `tests/editor/kernel/inlineRenderer.test.ts` | 两两组合渲染（S2） | ≈10–14 | `renderInline` 无字面污染、组合渲染断言（对标 FT3-E7） |
| `tests/editor/controllers/formatCtrl.test.ts` | Step 0 跨风格折叠 / 叠加矩阵 / selection 映射 | ≈10–12 | G-① 矩阵（`3**`/`**123`/`*3*`）、各风格叠加、折叠映射、保守空选区 |
| `tests/editor/kernel/selection.test.ts` | 标记感知映射 | ≈6–8 | `mapSelectionToContent` / 反向映射 / 与 foldSelectionToContent 一致性 |
| `tests/components/editorV2Format.test.tsx` | 跨风格叠加组件级 | ≈3–5 | 叠加后 DOM 渲染、删除含标记选区（keydown 模拟）、onDeleteRange 映射 |
| `tests/editor/controllers.test.ts` | 删除含标记选区（输入/删除路径） | ≈3–5 | 程序化删除不产生未闭合标记 |
| `tests/components/useCrossBlockDragSelection.test.ts` | （视复现）拖选端点落在标记上的映射 | ≈0–3 | 纯函数断言（jsdom 限制，仅逻辑层） |

### 4.3 新增/修改 E2E 用例清单（基线 44 例，预计新增 5–6 例 → ≈49–50 例）

| 文件 | 用例 | 覆盖 | 阶段 |
| --- | --- | --- | --- |
| `e2e/drag-selection-markers.spec.ts`（新增） | DSG-R1/R2/R3 复现 → 转正 | 拖选含标记 → 删除/格式化/光标恢复无移位（S4） | Phase 0 写（RED）→ Phase 4 转正（GREEN） |
| `e2e/floating-toolbar.spec.ts`（扩展） | FT4-E1 / FT4-E2 /（可选 FT4-E3） | 异风格叠加渲染无字面污染（S1/S2） | Phase 4 |

### 4.4 回归清单（S3：FT3 C10-C12 / E1-E7 不回归 + 存量全绿）
- **Vitest 回归锚点**：`formatCtrl.test.ts` 全量（Step 0 归一化矩阵、C10 跨 token、C11/C12 三连、selection 契约）；`inlineLexer.test.ts` 全量（三连、四连降级、intraword、嵌套、转义、findIntersectingStyleTokens）；`inlineRenderer.test.ts` 全量；`selection.test.ts`；`useCrossBlockDragSelection.test.ts`（DSF）；`editorV2StickyFormat/editorV2Format/editorV2Convert/editorV2Input`；`ft2Css.test.ts`。
- **E2E 回归锚点**：`floating-toolbar.spec.ts` 全量（含 FT3-E1/E2/E3/E5/E6/E7、FT2-E1~E8）；`cross-block-selection.spec.ts` 全量（含 P1/P2/P3 拖选闪烁收敛、反向跨类型拖选 + Backspace 块树级删除）；`editor.spec.ts`、`exit-behavior.spec.ts`、`marktext-rendering.spec.ts` 全量。
- **门禁**：`tsc --noEmit`、ESLint 0 error、`vite build`、`vitest run` 全量、`npx playwright test` 全量。

---

## 5. 风险清单与缓解（含 L3 项）

| # | 风险 | 等级 | 缓解 |
| --- | --- | --- | --- |
| R1 | **`inlineLexer` delimiter 栈化重写**：影响渲染/strip/Step 0 共用路径，回归面最大 | **L3** | token 契约（openLen/closeLen/contentStart/contentEnd/children）零变化；Phase 1 先锁回归锚点单测再实现；保守回退字面量、不抛错（U2） |
| R2 | **`formatCtrl` Step 0 跨风格折叠**：行为变更（新增叠加路径），可能误伤同风格解除 | **L3** | 同风格分支保持 FT3 原逻辑不变；折叠仅作用于异风格 token；C10-C12 全量回归 + E2E FT3-E1/E2/E6/E7 |
| R3 | **删除/光标路径拦截**（ContentBlock keydown + 映射）：改动键盘主路径，可能影响跨块删除/六条退出规则 | **L3** | 仅对「选区含标记字符」分支拦截，其余路径零变化；cross-block-selection / exit-behavior 全量回归 |
| R4 | delimiter 栈对既有边界（四连/`a**b`/intraword/转义）行为漂移 | 中 | 回归锚点单测先行；任何漂移以「保守回退字面量」兜底 |
| R5 | 折叠后选区为空（纯标记选区）的边缘态 | 中 | 保守回退最近内容边界、不抛错；单测覆盖 |
| R6 | 拖选复现（Phase 0）可能揭示 `useCrossBlockDragSelection` 端点计数问题，扩大修复面 | 中 | 复现先行（U4）；结论评审门后再定 AGT-D 文件清单 |
| R7 | 覆盖率 ≥80% 需新增覆盖率工具（devDependency） | 低 | 见 §6 确认点 5；不新增运行时依赖 |
| R8 | 键盘快捷键路径（Ctrl+B 等）共用 formatCtrl，折叠光标语义被波及 | 中 | `restoreSelection` 缺省 false 契约不变（既有测试锁定）；仅工具栏路径传 true |

**回退**：改动集中在 formatCtrl / inlineLexer / selection / ContentBlock 四处，均为单文件可控范围，可整体还原；块树数据模型与 Markdown 双向转换零改动。

---

## 6. 需用户确认 / 批准的点

1. **【L3 批准】** Phase 1 `inlineLexer` delimiter 栈式重写（R1）。
2. **【L3 批准】** Phase 2 `formatCtrl` Step 0 跨风格折叠（R2，行为变更）。
3. **【L3 批准】** Phase 3 删除/光标路径标记安全拦截（R3；具体文件清单以 Phase 0 复现结论定稿后再次确认）。
4. **【决策门】** Phase 0 复现结论评审：确认触发路径与 AGT-D 修复面。
5. **【依赖批准】** 覆盖率 ≥80% 需在 devDependencies 新增覆盖率工具（如 `@vitest/coverage-v8`）并在 `vitest.config.ts` 增加 `coverage` 配置（当前无 coverage 配置）——是否批准新增 devDependency？
6. **【文档范围】** 是否新建 `docs/specs/floating-toolbar-cross-style-overlay.md`（SPEC-EDIT-FT4 规范基线），还是仅以 `requirements.devflow.md` 为基线、只回写既有文档？（现有 FT3 模式为 requirements → specs → plans → tdd 四件套）
7. **【边界已确认 → 纳入范围】** `**abc**` 选 `ab`（纯内容部分选区，不覆盖标记）点异风格同样归一化处理（决策 U6），包裹与相邻异风格标记正确合并。

---

## 7. 成功标准映射

| 需求编号 | 验收口径 | 计划落点 |
| --- | --- | --- |
| S1 | 选区含异风格标记点格式 → 无未闭合/重叠标记、无字面残体 | Phase 2（Step 0 跨风格折叠）+ Phase 1（lexer 干净解析）+ Phase 4 FT4-E1/E2 |
| S2 | 叠加后相邻混合强调全部两两组合渲染正确、无字面 `*` 污染 | Phase 1（U2→B 矩阵）+ Phase 4 渲染断言 + E2E |
| S3 | 同风格零回归（FT3 C10/C11/C12、FT3-E1/E2/E6/E7、460 Vitest / 44 E2E） | §4.4 回归门禁 |
| S4 | 灰度拖选含标记 → 格式/删除无移位、序列化无异常 | Phase 0 复现（U4）+ Phase 3（U3 路径层）+ DSG 转正用例 |
| S5 | `tsc --noEmit`、ESLint 0 error、`vite build` 通过 | Phase 4 门禁 |

---

## 8. 阶段验收命令

- **P0**：`npx playwright test e2e/drag-selection-markers.spec.ts`（复现用例记录 RED 证据；不要求通过）
- **P1**：`npx vitest run tests/editor/kernel/inlineLexer.test.ts tests/editor/kernel/inlineRenderer.test.ts` + typecheck
- **P2**：`npx vitest run tests/editor/controllers/formatCtrl.test.ts tests/editor/kernel/inlineRenderer.test.ts` + typecheck
- **P3**：`npx vitest run tests/editor/kernel/selection.test.ts tests/components/editorV2Format.test.tsx tests/editor/controllers.test.ts` + typecheck
- **P4**：全量 `npm test` + typecheck + eslint + `npx vite build` + `npx playwright test` + `npx vitest run --coverage`（覆盖率 ≥80%）
