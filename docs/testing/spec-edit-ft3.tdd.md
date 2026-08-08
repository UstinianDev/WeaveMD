# TDD 证据文档：SPEC-EDIT-FT3 浮动工具栏格式应用交互修正

> 日期：2026-08-08 | 规范：[SPEC-EDIT-FT3 v1.0](../specs/floating-toolbar-format-sticky.md)
> 计划：[PLAN-EDIT-FT3](../plans/ft3-format-sticky.plan.md)
> 风险等级：L3（生产行为修正，测试先行，无迁移）

## 1. 任务 → 测试目标 → 红/绿证据映射

| 用例 | 任务点（规范条目） | 测试目标 | 红阶段 | 绿阶段 |
| --- | --- | --- | --- | --- |
| C1 | A1 Step0 归一化：content-only | 选中纯内容点加粗 → 包一层 `**` | 原生包双层 `****` | ✅ |
| C2 | A1 Step0 归一化：content + `**`（部分标记） | 选中 `abc`+边界 `**` 点加粗 → 解除（`abc` 无标记） | 叠加 `****` | ✅ |
| C3 | A1 Step0 归一化：content + 全标记 | 选中整个 `**abc**` 点加粗 → 解除 | — | ✅ |
| C4 | A1 Step0 归一化：部分 + 全 | `**a` + `**bc**` 点加粗 → `a` 包裹 + `bc` 解除 | 各包一层（`a` 双标记） | ✅ |
| C5 | A1 Step0 归一化：跨多 token（==粗斜同向== + **同向粗**） | 混合高亮+加粗选区点高亮 → 仅去高亮，加粗保留 | — | ✅ |
| C6 | A2 恢复选区 | 格式应用后 `Window.getSelection()` 保留选中 | 选区折叠 | ✅ |
| C7 | A3 驻留触发 | 按钮点击后 300ms 工具栏仍在 | 立即隐藏 | ✅ |
| C8 | A4 点击外/Escape | 点击工具栏外 / Escape → 隐藏 | 驻留不退出 | ✅ |
| C9 | A4 键入退出 | 键入字符 → 隐藏 | — | ✅ |
| C10 | B1 多 token 保守 | 跨多个同风格 token 的部分重叠选区 → 不破坏 | — | ✅ |

## 2. 交付统计

| 阶段 | 生产文件 | 测试文件 | 说明 |
| --- | --- | --- | --- |
| A | `controllers/formatCtrl.ts`（Step0 归一化 + selection 恢复）、`controllers/selection.ts`（StickySelectionUtil 模块） | `selection.test.ts`（sticky 3 例）、`formatCtrl.step0.test.ts`（4 例）、`contentBlockRestore.test.tsx`（2 例）、`editorV2StickyFormat.test.tsx`（1 例）、`ft2Css.test.ts`（回写 8 例） | 单测 + 集成 |
| B | `FloatingToolbar.tsx`（sticky/驻留/退出路径）、`globals.css`（FT2-E1 尺寸 8→10）、`ContentBlock.tsx`（RestoreSelection hook） | `floatingToolbar.sticky.test.tsx`（4 例）、`floatingToolbarV2.test.tsx`（回写）、`editorV2.sticky.test.tsx`（1 例） | 组件 |
| E | — | `e2e/floating-toolbar.spec.ts`（FT3-E1/E2/E3/E5 共 4 例） | E2E 42 例 |

## 3. 红/绿证据（片段）

```text
# RED：Step 0 归一化目标 —— 部分标记覆盖（C2）
formatCtrl.formatRange({ text: 'abc', markdown: '**ab', start: 0, end: 3, target: 'bold' })
  → expected selection restored + apply to 'ab'
# 实施前：selection 折叠 + apply('**ab**c') → 实际 '****ab****c'（叠双层，红）
# 实施后：`ab` 解除为纯文本，selection 恢复选中，apply 无叠加（绿）

# GREEN：floatingToolbar.sticky（组件）
Tests  4 passed (4)

# GREEN：全量回归
Tests  436 passed (436)
Running 17 tests using 1 worker      # e2e/floating-toolbar.spec.ts（13 → 17）
Tests  42 passed (42)                # 全量 E2E（38 存量 + 4 新增）
```

## 4. 验收核对

- [x] 部分标记选区不产生 `****`/`====`（case B 归一化解除）
- [x] 格式应用后选区恢复保持选中（StickySelectionUtil + RestoreSelection）
- [x] 工具栏格式应用后驻留；点击外/滚动/Escape/键入退出；块转换仍退出
- [x] 跨多个同风格 token 部分重叠保守处理（不破坏、不发散）
- [x] `tsc --noEmit` 通过、ESLint 0 error、`vite build` 通过
- [x] 全量门禁：Vitest 436/436、Playwright 42/42（无回归）
- [x] 文档同步：FT3 §9、FT2 §9.5、modules/04、SUMMARY

## 5. 遗留问题

- 跨多个同风格 token 的部分重叠选区（C10）采用保守跳过，极端长选区的逐 token 拆分列为后续任务。
- 工具栏在显示器边缘的溢出自适应为既有限制，非本期范围。
- 提交（checkpoint commit）需用户授权后执行；本证据已按 TDD 流程记录。
