# 跨块拖选光标闪烁优化规范（Drag Selection Flicker）

> 规范编号：SPEC-EDIT-DSF | 版本：v0.1（草案，待评审后实施）| 更新：2026-08-08
> 关联需求：REQUIREMENTS.md EDIT-02（跨块选择）
> 关联规范：[SPEC-EDIT-FT](./floating-toolbar-refactor.md)（G2 跨块拖选已修功能）、
> [SPEC-EDITOR-V2](./editor-v2-architecture.md)（13.13 跨块拖选）
> 关联模块：[docs/modules/04-编辑主区-Editor.md](../modules/04-编辑主区-Editor.md)

---

## 1. 背景与目标

SPEC-EDIT-FT v1.0 之后，编辑区**从下至上**跨块拖选（反向，跨多种不同语法类型内容）
功能可用，但用户实测仍有体验缺陷：

| 现状 | 问题 |
| ---- | ---- |
| 从下至上可选中多种不同语法类型内容（G2 已达成） | 选中过程**光标闪烁频率极快且不规律**，渲染太频繁，页面卡顿 |

**目标**：在**不改变跨块选中能力、不影响其它功能**的前提下，消除反向跨块拖选期间的
光标闪烁与渲染风暴，使选中过程平滑。

---

## 2. 现状与根因分析

### 2.1 拖选期间的"selection 双写入者"竞争

- Chromium 原生拖选在 `mousemove` **同步逐像素**更新 selection（内容块内智能选区）；
- `useCrossBlockDragSelection.ts:108-114` 每 `requestAnimationFrame` 帧
  `removeAllRanges + addRange` 覆盖一次。
- 两个写入者高频交替 → 选区边界（光标）每帧跳动，且节奏随鼠标速度变化而**不规律**。

### 2.2 无"无变化跳过"，静止帧仍重建选区

- SPEC-EDIT-FT 移除了"按 focus 块去重"（会丢失同块内 offset 精度，`useCrossBlockDragSelection.ts:102-103`），
  但**没有补充端点级变化检测**：即使鼠标静止、选区端点与上一帧完全相同，仍每帧重建
  selection → 持续触发 `selectionchange` → 浏览器持续重绘光标/选区高亮。

### 2.3 selectionchange 风暴驱动渲染（FloatingToolbar.tsx:234-254）

- `FloatingToolbar` 监听 `selectionchange`，每次（拖选期间 ≈ 每帧）执行：
  1. `computeToolbarState`：`nearestContentSpan` ×2 → 跨块时 `selectionSyntaxTypesConsistent`
     做**全区间叶子枚举**（`resolveSyntaxTypesInRange` 先构造数组再 `every`，O(N) 且不可短路，
     `syntaxType.ts:84-104`）→ `getBoundingClientRect()` 强制同步布局；
  2. `setState`（selection/position/visible）→ **同类型内拖选时工具栏每帧重渲染**；
     跨类型拖选虽 hide，但 `computeToolbarState` 全量计算与事件回调本身仍每帧执行（CPU/布局抖动）。
- 反向跨块拖选跨多种类型时，一致性判定每帧 O(区间块数)，长文档大选区成本线性放大。

### 2.4 结论

闪烁与卡顿来自三层叠加：**selection 重建无变化检测**（2.2）＋**原生拖选竞争**（2.1）＋
**selectionchange 事件每帧驱动 DOM 遍历与 React 渲染**（2.3）。修复应三层同步收敛。

---

## 3. 目标与验收要点

| 编号 | 目标 | 验收要点 |
| ---- | ---- | -------- |
| P1 | 反向跨块拖选期间光标不频繁闪烁 | 鼠标静止时 selection 不再被反复重建（无 `selectionchange` 风暴）；拖选过程视觉平滑 |
| P2 | 渲染/计算频率收敛 | 拖选期间 `computeToolbarState` 执行次数 ≤ rAF 帧数；同类型内拖选工具栏渲染不再逐事件触发 |
| P3 | 跨块选中能力零回归 | 正反向跨块拖选、Backspace 块树级删除（SPEC-EDIT-FT G2）行为不变 |

---

## 4. 方案设计

### 4.1 端点级变化检测（P1 核心，修改 useCrossBlockDragSelection.ts）

- 新增 `lastAppliedRangeRef`：记录**上一帧实际写入 selection** 的端点
  （`{ startNode, startOffset, endNode, endOffset }`，用 `isEqualNode` + 偏移比对）。
- rAF 帧内计算目标 `next` 后，与 `lastAppliedRangeRef` 比对：
  - **端点全等** → 跳过 `removeAllRanges + addRange`（保留 SPEC-EDIT-FT 移除按块去重后
    应有的 offset 精度，仅去掉"无变化"重建）；
  - **端点变化** → 写入并更新 `lastAppliedRangeRef`。
- 保留 mouseup 末帧兜底与 3 帧重放（SPEC-EDIT-FT 4.4.6），逻辑不受影响。

### 4.2 原生拖选竞争的温和抑制（P1 辅助，同文件）

- 拖选期间（`dragMovedRef` 为 true）对 `mousedown` 起点块之后的原生选区变化不做对抗性
  覆盖以外的动作；依赖 4.1 的"端点比对"保证**鼠标静止时彻底停写**（不再与原生竞争），
  鼠标移动时写入收敛到每帧一次。
- 不采用 `preventDefault`（会破坏原生文本选择与块内拖选），维持现有"同块由浏览器原生
  选择"语义。

### 4.3 工具栏渲染节流（P2，修改 FloatingToolbar.tsx）

- `handleSelectionChange` 改为 **rAF 合并**：事件仅写入 `latestSelectionRef`，rAF 帧内
  执行一次 `computeToolbarState + setState`（与鼠标事件频率解耦，渲染 ≤ 每帧一次）。
- 用 `visibleRef` 记录当前可见性：`setVisible` 仅在值变化时调用，避免拖选期间每帧重复
  `setVisible(false)` 的 churn（React 虽 bail out，但回调本身仍有成本）。

### 4.4 一致性判定短路与上限（P2 辅助，修改 kernel/syntaxType.ts）

- `selectionSyntaxTypesConsistent` / `resolveSyntaxTypesInRange` 改为**边枚举边比对**：
  一旦出现与首个类型不同的叶子立即返回 `false`，不再构造完整数组（反向跨多类型场景
  通常首尾即不一致，O(1) 即可判定）。
- 区间叶子数上限（如 500 块）：超过直接判定不一致返回，避免极端大选区每帧 O(N) 遍历。

### 4.5 明确不动项（回归边界）

- 不改块树模型、双向转换、`deleteLeafRange`、controllers、撤销/重做、自动保存；
- 不改 G1 显示条件与 G3 转换矩阵语义；不改自定义下拉 DOM 结构。

---

## 5. 改动文件清单（预估）

| 文件 | 改动 | 风险 |
| ---- | ---- | ---- |
| `src/render/components/Editor/v2/useCrossBlockDragSelection.ts` | 4.1 端点级变化检测 + 4.2 停写策略 | 中 |
| `src/render/components/Editor/v2/FloatingToolbar.tsx` | 4.3 selectionchange rAF 节流 + visibleRef | 低 |
| `src/render/editor/kernel/syntaxType.ts` | 4.4 一致性判定短路 + 区间上限 | 低 |
| `tests/components/floatingToolbarV2.test.tsx` | 节流与短路单元测试（见 6.1） | — |
| `e2e/cross-block-selection.spec.ts` | 新增拖选期间事件节流断言（见 6.2） | — |

---

## 6. 测试策略与回归约束

### 6.1 单元测试（Vitest）

1. 变化检测：相同端点跳过 / 端点不同写入（可导出的纯函数判定）；
2. `resolveSyntaxTypesInRange` 短路：`[heading+paragraph]` 区间立即返回不一致，不构造全量；
3. FloatingToolbar 节流（fake timers）：N 次 selectionchange 合并为 ≤1 次计算/渲染。

### 6.2 Playwright E2E（真实 Chromium）

| 用例 | 覆盖 |
| ---- | ---- |
| 反向跨块拖选（多类型）仍成立 + Backspace 块树级删除（存量 G2 不回归） | P3 |
| 拖选期间 `selectionchange` 事件计数 ≤ 帧数上限（页面内计数器探针） | P1/P2 |
| 现有 floating-toolbar 5 例 + cross-block-selection 2 例 + 全量存量不回归 | 回归 |

### 6.3 回归门禁

- `vitest run` 全量（含存量 289 例）通过；
- `tsc --noEmit`、ESLint（0 error）、`vite build` 通过；
- `npx playwright test` 存量 28 例 + 新增用例全部通过；
- SPEC-EDIT-FT G1/G3、六条退出规则、SPEC-EDIT-CBTP 行为零变化。

---

## 7. 风险与回退

| 风险 | 缓解 |
| ---- | ---- |
| 端点比对漏写导致反向选区不完整 | mouseup 末帧兜底 + 3 帧重放保留；比对仅用于"静止帧跳过" |
| 节流后工具栏出现/隐藏延迟 | 合并窗口 ≤ 1 帧（rAF），感知延迟 < 16ms；hide 仍由事件兜底 |
| 大选区上限误伤合法场景 | 上限值从规范实测校准；现有 G1 E2E 覆盖常规场景 |
| 回退 | 改动集中于两个组件 + 一个内核纯函数，可整体还原 |

---

## 8. 验收标准

- P1：反向跨块拖选（含跨多种类型）过程，鼠标静止时无 `selectionchange` 风暴、光标不闪烁。
- P2：拖选期间工具栏计算/渲染 ≤ 每帧一次；长选区一致性判定短路生效。
- P3：正反向跨块拖选、Backspace 块树级删除与 SPEC-EDIT-FT 全部验收不回归。
- 回归门禁（6.3）全绿。

---

> 本规范为跨块拖选性能/视觉缺陷的修复基线。评审确认后实施；实施偏差回到本规范更新后
> 执行（文档优先）。实施风险等级：**L3**（编辑器核心交互修改），需人工确认后开工。
