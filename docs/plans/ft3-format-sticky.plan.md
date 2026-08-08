# 实施计划：SPEC-EDIT-FT3 浮动工具栏格式应用交互修正

> 计划编号：PLAN-EDIT-FT3 | 状态：执行中 | 更新：2026-08-08
> 关联规范：[docs/specs/floating-toolbar-format-sticky.md](../specs/floating-toolbar-format-sticky.md)
> 执行引擎：TDD 红绿循环（tdd-workflow）；并行智能体见 `.opencode/agent/`

## 1. 任务分解与依赖图

| 子任务 | 阶段 | 生产文件 | 测试文件 | 依赖 | 并行性 |
| --- | --- | --- | --- | --- | --- |
| AGT-A 内核 Step0 归一化（G1） | A | inlineLexer/inlineStrip/formatCtrl/kernel.index | formatCtrl.test/inlineLexer.test | 无 | Wave1 并行 |
| AGT-B 选区工具与类型（G3 基础） | B | kernel/selection、editorInstance | selection.test（新增） | 无 | Wave1 并行 |
| AGT-C 恢复选区接线（G3） | C | v2/types、EditorV2、ContentBlock | contentBlockRestore.test + 存量回归 | A+B | Wave2 串行 |
| AGT-D 工具栏驻留（G3） | D | FloatingToolbar | floatingToolbarV2.test + editorV2StickyFormat.test | C | Wave3 |
| AGT-E 尺寸缩小（G4） | E | globals.css | ft2Css.test 回写 + FT2-E1 回写 | 无 | Wave1 并行 |
| AGT-F E2E + 文档 | F | —（文档） | floating-toolbar.spec.ts + docs 回写 | A~E | Wave4 串行 |

```
Wave 1（并行）：AGT-A ∥ AGT-B ∥ AGT-E
Wave 2（串行）：AGT-C（依赖 A+B 合入）
Wave 3（并行）：AGT-D ∥（E 若 Wave1 未完成）
Wave 4（串行）：AGT-F
```

## 2. 已确认决议（评审拍板，2026-08-08）

1. G4 尺寸：容器垂直 padding **3px**（`padding:3px 6px`）→ 按钮 28px + 3px×2 = **总高 34px**；E2E 断言 clientHeight ≤ 34。
2. 键盘路径（Ctrl+B 等）保持折叠光标：`FormatRangeOptions.restoreSelection` 缺省 false，工具栏传 true 才返回 `selection`。
3. case B 判定：需「选区在 token span 内」（T.start≤s 且 e≤T.end）+ 覆盖边界标记；越界 → case C 保守。
4. 存量用例变更：`'a **already** c'` 选区 `[2,13)` 期望改为**解除为 `a already c`**（G1 矩阵一致，明示行为变更）。
5. ContentBlock 恢复选区经 `BlockHandlers.getPendingRange`（消费一次）+ 无依赖 useLayoutEffect，无需穿透渲染管线。

## 3. 阶段验收命令

- A：`npx vitest run tests/editor/controllers/formatCtrl.test.ts tests/editor/kernel/inlineLexer.test.ts` + typecheck
- B：`npx vitest run tests/editor/kernel/selection.test.ts` + typecheck
- C：`npx vitest run tests/components/contentBlockRestore.test.tsx tests/components/editorV2Format.test.tsx` + typecheck
- D：`npx vitest run tests/components/floatingToolbarV2.test.tsx tests/components/editorV2StickyFormat.test.tsx` + typecheck + eslint
- E：`npx vitest run tests/styles/ft2Css.test.ts` + `npx playwright test e2e/floating-toolbar.spec.ts -g "FT2-E1"` + typecheck
- F：全量 `npm test` + typecheck + eslint + `npx vite build` + `npx playwright test`

## 4. 完成标准

- 规范 §8 验收：G1 矩阵（绝不 `****…****`）、G2 无残留且 textContent 一致、G3 驻留/退出（含 Escape）、G4 尺寸区间。
- 文档同步：FT3 §9、FT2 §9.5、docs/testing/spec-edit-ft3.tdd.md、modules/04、SUMMARY。
- git checkpoint 由总指挥按阶段统一提交（用户已授权，不推送远程）。
