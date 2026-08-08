# 浮动工具栏格式应用交互修正规范

> 规范编号：SPEC-EDIT-FT3 | 版本：v0.1（草稿，评审中）| 更新：2026-08-08
> 关联需求：REQUIREMENTS.md EDIT-04（实时格式化渲染）、EDIT-13（语法渲染对齐 marktext）
> 关联规范：[SPEC-EDIT-FT2](./floating-toolbar-ux-and-inline-format.md)（本规范修正其遗留问题）、
> [SPEC-EDIT-FT](./floating-toolbar-refactor.md)、[SPEC-EDIT-DSF](./drag-selection-flicker.md)、
> [SPEC-EDITOR-V2](./editor-v2-architecture.md)
> 参考实现：marktext/marktext（https://github.com/marktext/marktext，格式工具栏与行内格式化行为）
> 适用范围：Normal Mode 编辑主区；不改动块树数据模型、Markdown 双向转换、七类交互控制器、
> 撤销/重做、自动保存、查找替换、大纲导航等既有能力（回归约束见第 6 节）。

---

## 1. 背景与目标

用户实测反馈浮动工具栏行内格式化（加粗 / 斜体 / 下划线 / 删除线 / 行内代码 / 高亮 / 数学公式）
基本可用，但存在四组问题，本文档给出修正规范。

| 域 | 当前情况 | 问题 | 目标 |
| --- | -------- | ---- | ---- |
| 格式应用 | 行内格式化基本实现 | ① 同语法符号**持续叠加**：`123` 加粗 → `**123**`，再选中 `123**` 点加粗 → `****123****`（其它样式同样复现） | ① 选中渲染后的内容及其**部分语法符号**并赋予功能，不会导致语法符号持续叠加 |
| 语法符号 | `.md-syntax` 方案 B（默认隐藏、聚焦灰显） | ② 在问题①基础上，残留语法符号仍然出现 | ② 除灰度展示（聚焦灰显）外，语法符号正常情况不展示 |
| 工具栏驻留 | 应用格式后工具栏立即退出 | ③ 为某内容添加格式后工具栏自动关闭，需重新选中才出现 | ③ 应用格式后工具栏**不退出**，点击除工具栏外的任意位置才退出 |
| 工具栏尺寸 | 字号 14px、按钮 36×32px（FT2 G1 放大后） | ④ 工具栏太大 | ④ 适当缩小浮动工具栏 |

### 1.1 范围约束

- **本次只做**：格式应用的选区归一化（杜绝同语法叠加）、残留标记清理、工具栏驻留交互、
  工具栏尺寸缩小、相关样式与测试。
- **不改变**：块树结构与序列化不变量（`stateToMarkdown(markdownToState(M)) === M`）、
  六条退出规则、撤销/重做、自动保存、查找替换、大纲导航、跨块拖选、代码块独立编辑路径、
  键盘快捷键路径（`Ctrl+B` 等仍折叠光标，不触发工具栏驻留）。
- **不新增依赖**。

---

## 2. 现状与根因分析

### 2.1 问题①：同语法符号持续叠加

**根因**：`formatCtrl.formatRange`（formatCtrl.ts:52-105）的 toggle-off（`toggleOff`，formatCtrl.ts:113-142）
只支持两种形态：

- **形态 A**：标记在选区外——`before` 以 open 结尾 且 `after` 以 close 开头，且边界不可延伸；
- **形态 B**：选区恰好完整包裹**整块**文本（`s===0 && e===text.length`）。

用户「选中渲染后的内容及其**部分语法符号**」时，选区与标记边界重叠，两种形态均不命中：

| 场景 | 选区 | `toggleOff` 判定 | 结果 |
| ---- | ---- | ---------------- | ---- |
| `**123**`，选中 `123**` | `[2,7)` | `before=**` 以 open 结尾 ✓，`after=''` 不以 close 开头 ✗；非整块 ✗ → 不命中 | 走 Step 2 包裹 → `**123****`（叠加） |
| `**123**`，选中 `**123` | `[0,5)` | `before=''` 不以 open 结尾 ✗ → 不命中 | 走 Step 2 → `****123**`（叠加） |
| `**123**` 全选 | `[0,7)` | 形态 B：`s===0 && e===text.length` ✓ | 命中 → 解除 ✓（已覆盖） |
| `**123**`，选中 `123` | `[2,5)` | 形态 A ✓ | 命中 → 解除 ✓（已覆盖） |

即：**选区覆盖「content + 部分边界标记」时进入裸包裹分支，残留残体标记导致叠加**。
此场景在 FT2 被列为「部分重叠 / 混合边界保守处理」的已知限制（floating-toolbar-ux-and-inline-format.md §7/§9.5），
本次将其正式解决。

### 2.2 问题②：残留语法符号出现

**根因**：问题①的直接后果——`****123****` 的内层 `**` 在块聚焦灰显（方案 B，globals.css:1940-1945）
时可见。解决①后残留消失。语法符号隐藏机制本身（方案 B：`.md-syntax` 默认 `font-size:0; opacity:0`，
聚焦灰显 `opacity:0.55`）已满足「正常情况不展示、灰度展示」的目标，本次仅需**保持 + 断言守护**。

### 2.3 问题③：应用格式后工具栏自动退出

**根因**（两处叠加）：

1. **强隐**：`FloatingToolbar.tsx` 的 `handleFormat`（:346-361）、`handleClearFormat`（:363-367）、
   `handleBlockChange`（:369-377）末尾均调用 `setVisibleGuarded(false)`，点击后立即隐藏。
2. **软隐**：`onFormat` 经 `EditorV2.applyAction`（EditorV2.tsx:92-114）恢复**折叠光标**
   （`setCursorAtOffset`），selectionchange 触发 → `computeToolbarState` 判定 `isCollapsed`
   → `fade` → `scheduleHide(180)` 延迟隐藏。

### 2.4 问题④：工具栏太大

**根因**：FT2 阶段 2（globals.css:2028-2072）将尺寸放大：字号 14px、按钮 36×32px、
`gap:6px`、`padding:6px 8px`、下拉项 `padding:8px 12px`、菜单 `min-width:200px`、分隔线 1×20px。
对比 FT 阶段原始 `text-xs(12px)`/`w-8 h-7(32×28px)` 明显偏大，需在两者之间取适中值。

---

## 3. 目标与验收要点

| 编号 | 对应需求 | 目标 | 验收要点 |
| ---- | -------- | ---- | -------- |
| G1 | 目标① | 选中渲染后内容及其部分语法符号并赋予功能，**不产生同语法叠加** | 覆盖残体标记的选区（`123**`/`**123`/整标记）点格式 → 解除该格式；绝不产生 `****…****` 双层同标记 |
| G2 | 目标② | 除灰度展示外语法符号正常情况不展示 | 叠加场景修复后无残留；`.md-syntax` 非聚焦 `font-size:0`；聚焦灰显保留；DOM `textContent` 与源一致，往返不变量保持 |
| G3 | 目标③ | 应用格式后工具栏**不退出**，点击其它位置才退出 | 点格式按钮 → 工具栏保持可见且该格式 active 态正确；点击工具栏外区域 / 滚动 / Escape / 开始键入 → 隐藏；块类型下拉转换维持现状（转换后退出） |
| G4 | 目标④ | 适当缩小浮动工具栏 | E2E 计算样式断言：总高 ≤ 34px、按钮 32×28px（±）、字号 13px、按钮间距 4~5px |

---

## 4. 方案设计

### 4.1 格式应用：选区标记归一化（G1，杜绝同语法叠加）

在 `formatCtrl.formatRange` 的 Step 2（包裹）**之前**增加 Step 0「选区吸附 / 归一化」：
**当选区与同风格 token 相交且覆盖其边界标记时，视为该格式已应用 → 扩展选区为完整 token 并解除**。

```
Step 0 · 选区标记归一化（新增）：
  tokens = tokenizeInline(text)                    // 与渲染识别同一 lexer 路径
  找与 [s,e) 相交的同风格成对 token T
  （相交：T.start < e && T.end > s；同风格映射：bold↔strong、italic↔em、
   strike↔del、highlight↔mark、code↔code、underline↔underline、math↔math）

  case A：contentStart <= s && e <= contentEnd
      → 选区完全在 T 的内容内 → 形态 A 命中（现状 toggleOff），解除。
  case B：s < contentStart（选区含 open 尾部）或 e > contentEnd（选区含 close 前部）
      → 把选区扩展为 [T.start, T.end)（完整 token）→ 按「全选包裹区」解除
        newText = text 移除 T 的 open/close（剥离标记，保留 content）
        选区落回 content 区间。
  case C：无同风格 token 相交（含跨多个 token / 普通文本）
      → 现状：stripSameStylePairs + 包裹（case 中完整 token 仍去重）。
```

**要点**：

- **判定基于 lexer 而非字符串前后缀**：`tokenizeInline` 只在存在合法闭合 token 时才识别
  （如 `a**b` 中 `**` 无双数闭合 → 普通文本，不构成 token），故 case B 不会把普通文本中
  恰好以 `**` 结尾的片段误判为标记。
- **不可延伸规则复用** `isBoundedWrap` 的边界判定，避免 italic `*` 与 bold `**` 边界误判
  （`**a**` 不作 italic 处理）。
- 归一化命中后，**返回新的恢复选区**（见 4.3），保证光标/选区落回 content 区间。

**行为矩阵（写入单测）**：

| 原文 | 选区 | 期望 |
| ---- | ---- | ---- |
| `**123**` | `123**`（`[2,7)`） | 解除 → `123`（不叠加） |
| `**123**` | `**123`（`[0,5)`） | 解除 → `123` |
| `**123**` | `[0,7)`（整标记） | 解除 → `123` |
| `**123**` | `123`（`[2,5)`） | 解除 → `123` |
| `123` | `123` | 包裹 → `**123**` |
| `a **b** c` | `b** c`（跨 token） | case C 保守：包裹内完整 token 去重，残体保留（已知限制） |

> 各成对样式（`*`/`~~`/`==`/`` ` ``/`<u>`/`$`）同矩阵适配；link/image 不走 toggle（现状不变）。

### 4.2 语法符号隐藏保持（G2）

- **不修改** `.md-syntax` 方案 B 规则（globals.css:1933-1945）：默认隐藏、聚焦灰显即「灰度展示」。
- 解决问题①后，叠加残留消失；在测试中新增「叠加场景无残留 `.md-syntax`」断言守护。
- DOM `textContent` 与源一致、序列化往返不变量保持（既有约束，回归守护）。

### 4.3 工具栏驻留（G3）

目标行为：**应用格式后不退出；点击除工具栏外的任意位置才退出**。设计如下：

1. **移除强隐**：`FloatingToolbar.handleFormat` / `handleClearFormat` 末尾不再调用
   `setVisibleGuarded(false)`。`handleBlockChange`（块类型下拉）**维持现状退出**（块结构转换后
   工具栏不再适用，用户未要求其驻留）。
2. **格式化后恢复选区（保持选中）**：`formatRange` / `clearFormat` 返回的
   `EditorActionResult` 新增可选 `selection: { start: number; end: number }`（包裹/解除后
   content 区间的映射）；`EditorV2.applyAction` 检测到 `selection` 时改用**恢复选区**
   （新增 `kernel/selection.setRangeAtOffset(container, start, end)`），否则维持现状恢复折叠光标。
   `ContentBlock` 新增 pendingRange 恢复 effect（与 pendingOffset 并存）。
   - 保持选中 → selectionchange 自然触发 → `computeToolbarState` 判定非折叠 → 工具栏**驻留**，
     active 态按新文本 `anchorText` 更新（加粗后 B 高亮，语义正确）。
3. **退出条件**：
   - 点击工具栏外任意位置（空白 / 其它文本区域）→ `document` `mousedown` capture 监听，
     `target` 不在工具栏容器内 → 隐藏。工具栏自身按钮已有 `onMouseDown stopPropagation`，
     工具栏内点击不触发该监听（天然满足「点击工具栏不退出」）。
   - 滚动（现状 `container.scroll` → hide，不变）。
   - `Escape`（新增：工具栏可见时按 Escape → 隐藏）。
   - 开始键入（现状：选区折叠 → `fade → hide`，行为合理）。
4. **行为变更声明**：现状「点击其它文本 → 工具栏跟随到新选区」在**格式应用后**（sticky 语义）
   不再自动跟随，而是按 3 退出；**未应用格式**的普通选中行为不变。此变更列入回归关注。

### 4.4 工具栏尺寸缩小（G4）

`globals.css`（:2028-2072）取 FT（原始 12px/32×28px）与 FT2（14px/36×32px）之间的适中值：

| 元素 | FT2 现状 | 目标（缩小） |
| ---- | -------- | ------------ |
| 容器 | `gap:6px`、`padding:6px 8px`、字号 14px | `gap:4px`、`padding:3px 6px`、字号 13px（垂直 3px×2 + 按钮 28px = 总高 34px） |
| 格式按钮 `.ft-btn` | 36×32px、字号 14px | 32×28px、字号 13px |
| 块类型触发器 | `height:32px`、`padding:0 8px`、字号 14px | `height:28px`、`padding:0 6px`、字号 13px |
| 下拉项 `.block-type-option` | `padding:8px 12px`、字号 14px | `padding:6px 10px`、字号 13px |
| 下拉菜单 `.block-type-menu` | `min-width:200px` | `min-width:176px` |
| 分隔线 `.ft-divider` | 1×20px、`margin:0 4px` | 1×16px、`margin:0 2px` |

- 保持类名与 `[data-value]` 等选择器稳定（E2E 选择器零变化）。
- **同步回写 FT2 遗留断言**：FT2 阶段 5 的 E2E 计算样式断言（字号 ≥ 14px、间距 ≥ 6px、
  下拉项行距 ≥ 8px、总高 ≥ 40px）改为 G4 新区间（见 6.2）。

---

## 5. 改动文件清单（预估）

| 文件 | 改动 | 风险 |
| ---- | ---- | ---- |
| `src/render/editor/kernel/inlineLexer.ts` | 新增/导出「定位与吸附同风格 token」辅助（4.1 case B 判定） | 中 |
| `src/render/editor/controllers/formatCtrl.ts` | Step 0 选区归一化（4.1）；`EditorActionResult.selection?` 返回恢复区间（4.3） | 中 |
| `src/render/editor/editorInstance.ts` | `EditorActionResult` 类型扩展（`selection?: { start; end }`） | 低 |
| `src/render/editor/kernel/selection.ts` | 新增 `setRangeAtOffset(container, start, end)`（恢复选区） | 低 |
| `src/render/components/Editor/v2/EditorV2.tsx` | `applyAction` 按 `result.selection` 恢复选区（4.3） | 中 |
| `src/render/components/Editor/v2/blocks/ContentBlock.tsx` | pendingRange 恢复选区 effect（与 pendingOffset 并存） | 中 |
| `src/render/components/Editor/v2/FloatingToolbar.tsx` | 移除格式/清除后强隐；Escape 处理；保持块转换后退出 | 中 |
| `src/render/styles/globals.css` | 尺寸缩小（4.4） | 低 |
| `tests/`（见 6.1） | toggle 归一化矩阵 / 恢复选区 / 工具栏驻留单测 | — |
| `e2e/`（见 6.2） | 新增用例 + 回写 FT2 遗留尺寸断言 | — |
| `docs/`（见 8/9） | 本规范实施记录回写；FT2 §9.5 已知限制更新；modules/04、SUMMARY 同步 | — |

---

## 6. 测试策略与回归约束

### 6.1 Vitest 单元/组件测试

1. **Toggle 归一化矩阵**（formatCtrl，4.1 行为矩阵全量覆盖，各成对样式 × 场景）：
   `**123**` 选区 `123**`/`**123`/整标记/`123` → 均解除为 `123`；`123` 全选 → 包裹；
   italic `*` 不误判 bold `**`；跨 token（`a **b** c` 选 `b** c`）保守不叠加、无崩溃。
2. **恢复选区**：`formatRange` 包裹/解除后 `selection.start/end` 映射正确；
   `setRangeAtOffset` 恢复选区到 content 区间。
3. **工具栏驻留**（组件）：点击格式按钮后 `setVisibleGuarded(false)` 不再被调用；
   块类型转换后仍调用（维持现状退出）；Escape 触发隐藏。
4. **样式**：`.md-syntax` 非聚焦 `font-size:0` / 聚焦灰显不变；尺寸类（4.4）数值断言。

### 6.2 Playwright E2E（真实 Chromium）

| 用例 | 覆盖 |
| ---- | ---- |
| `**123**`：选中 `123**` 点加粗 → 文本 `123`，页面无 `****` 出现 | G1 |
| 应用加粗/斜体/下划线/删除线/代码/高亮/数学后，叠加场景 `.md-syntax` 计数为 0；`textContent` 与源一致 | G1/G2 |
| 选中 `123` → 点加粗 → 工具栏**保持可见**且 B 高亮；点击工具栏外空白 → 工具栏消失 | G3 |
| 工具栏计算样式：总高 ≤ 34px、按钮宽高 32×28px、字号 13px、按钮间距 ≥ 4px | G4 |
| **回写**：FT2 遗留断言（≥14px/≥6px/≥8px/≥40px）更新为 G4 区间 | G4 |
| 现有 `floating-toolbar.spec.ts` / `editor.spec.ts` / `marktext-rendering.spec.ts` 等不回归 | 回归 |

### 6.3 回归门禁

- `tsc --noEmit`、ESLint（0 error）、`vite build` 通过；
- `vitest run` 全量通过（存量 392 例 + 新增）；
- `npx playwright test` 全量通过（存量 38 例 + 新增）；
- 块树序列化/往返不变量、SPEC-EDIT-EXIT 六条退出规则、SPEC-EDIT-CBTP、SPEC-EDIT-FT、
  SPEC-EDIT-DSF、SPEC-EDIT-FT2 既有行为除本规范明示变更（4.3）外零变化。

---

## 7. 风险与回退

| 风险 | 缓解 |
| ---- | ---- |
| 归一化 case B 误判普通文本（如 `a**b`） | 判定基于 lexer token（合法闭合才识别），普通 `**` 不构成 token；单测矩阵覆盖 |
| 恢复选区链路（formatRange → EditorV2 → ContentBlock）改动面大 | 仅新增 `selection?` 可选字段与恢复 effect，既有折叠光标路径不变；键盘快捷键路径不回退 |
| 工具栏驻留改变「点击其它文本跟随」既有行为 | 仅「格式应用后」进入驻留语义；未应用格式的普通选中不变；E2E 明示断言 |
| 尺寸缩小破坏 FT2 遗留 E2E 断言 | 同步回写 FT2 断言（6.2），选择器零变化 |
| Escape / mousedown 监听与既有事件流冲突 | capture 阶段监听 + 工具栏内 stopPropagation；滚动/键入退出沿用现状 |
| 回退 | 改动集中在 formatCtrl、lexer 辅助、selection 工具、工具栏组件、CSS，均可整体还原；块树与序列化零改动 |

**已知限制**（实施后回写）：
- 跨多个同风格 token / 部分重叠的选区仍采用保守处理（case C），不保证语义级完美；
- 键盘快捷键（`Ctrl+B` 等）仍折叠光标，不触发工具栏驻留；
- display math（`$$…$$`）、图片粘贴、列表间互转等 FT2 既有范围外事项不变。

---

## 8. 验收标准

- G1：`**123**` 选区含部分/全部标记再点加粗 → 解除为 `123`，绝不出现 `****…****`（各成对样式同验）。
- G2：叠加场景无残留语法符号；`.md-syntax` 正常隐藏、聚焦灰显；`textContent` 与源一致，往返不变量保持。
- G3：点格式按钮 → 工具栏驻留且格式 active 态正确；点击工具栏外 / 滚动 / Escape / 键入 → 退出；
  块类型转换后退出（现状）。
- G4：工具栏总高 ≤ 34px、按钮 32×28px、字号 13px、间距 4~5px（E2E 计算样式断言）。
- 全量回归门禁（6.3）通过；存量 Vitest / E2E 不回归；`tsc` / `eslint` / `vite build` 全绿。

---

> 本规范为浮动工具栏格式应用交互修正的设计基线。评审确认后实施；实施中的偏差回到本规范
> 更新后执行（文档优先，避免编码错误）。实施风险等级：**L3**（编辑器核心交互修改），需人工确认后开工。

---

## 9. 实施记录

> 按里程碑回写（对照 SPEC-EDIT-FT2 §9 的格式）。实施证据待补（建议
> [docs/testing/spec-edit-ft3.tdd.md](../testing/spec-edit-ft3.tdd.md)）。

### 9.1 待实施

- （占位）Step 0 选区归一化、恢复选区链路、工具栏驻留、尺寸缩小、测试与 E2E 回写。
