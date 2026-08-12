# SPEC-EDIT-DSF TDD 实施证据报告

> 规范：docs/specs/drag-selection-flicker.md（SPEC-EDIT-DSF v0.1）
> 日期：2026-08-08 | 运行器：Vitest 1.x + Playwright | 环境：Windows PowerShell
> 检查点说明：本次实施**未做任何 git commit**（用户未授权提交），以本报告作为阶段检查点证据。
> 执行方式：总指挥协调 + 4 个并行/串行执行智能体（Task 子代理）分工实施，规避上下文膨胀。

---

## 1. 用户旅程（缺陷复现 → 修复验证）

| 缺陷 | 修复前 | 修复后（本实施） |
| ---- | ------ | ---------------- |
| P1 反向跨块拖选光标闪烁/卡顿 | 拖选期间每 rAF 帧无条件 `removeAllRanges + addRange` 重建选区（`useCrossBlockDragSelection.ts:108-114`），与原生拖选双写入者竞争；鼠标静止时仍反复重建 → `selectionchange` 风暴 | 新增 `lastAppliedRangeRef` 端点级变化检测：端点全等跳过写入，仅变化时写入；`areRangeEndpointsEqual` 纯函数（`isEqualNode`+offset，不可用时降级引用相等）；mousedown/mouseup 重置 |
| P2 渲染/计算风暴 | `FloatingToolbar.handleSelectionChange` 每次事件同步 `computeToolbarState + setState`；`resolveSyntaxTypesInRange` 先构造完整数组再 `every`（O(N) 不可短路） | `handleSelectionChange` 改 rAF 合并（`latestSelectionRef` + `rafIdRef` 去重，渲染 ≤ 每帧一次）+ `visibleRef` 去重 `setVisible`；`resolveSyntaxTypesInRange` 改边枚举边比对，不一致/超上限（500）立即返回 `null` |
| P3 跨块选中能力 | —（存量 G2 已修） | 反向跨多种语法类型（标题+段落+引用）拖选 E2E + Backspace 块树级删除全绿，零回归 |

## 2. 改动清单

| 文件 | 改动摘要 | 性质 |
| ---- | -------- | ---- |
| `src/render/editor/kernel/syntaxType.ts` | `resolveSyntaxTypesInRange` 边枚举边比对短路 + `MAX_RANGE_LEAF_COUNT=500` 上限 + `sameSyntaxType`；不一致/超限/不可达统一返回 `null`（与 FloatingToolbar 既有 `null→false` 契约兼容） | 生产 |
| `src/render/components/Editor/v2/FloatingToolbar.tsx` | selectionchange rAF 合并（`latestSelectionRef`+`rafIdRef`）；`visibleRef` 镜像可见性，`setVisibleGuarded` 仅在值变化时 `setVisible`；卸载时 cancelAnimationFrame | 生产 |
| `src/render/hooks/useCrossBlockDragSelection.ts` | 新增 `RangeEndpoint` 类型 + `areRangeEndpointsEqual` 纯函数 + `lastAppliedRangeRef`；跨块写入分支端点比对，全等跳过写入；mousedown/mouseup 重置 | 生产 |
| `tests/editor/kernel/syntaxType.test.ts` | 更新 1 例断言（h1+paragraph 现返回 null）+ 新增 5 例短路/上限/边界 | 测试 |
| `tests/components/FloatingToolbarV2.test.tsx` | 新增 4 例 rAF 节流（合并/跨帧去重/最新覆盖/卸载清理）；共享夹具上提模块级 | 测试 |
| `tests/components/useCrossBlockDragSelection.test.ts`（新增） | 纯函数 8 例 + hook 级 3 例（端点未变跳过写入、mouseup 末帧兜底等） | 测试 |
| `tests/components/EditorV2Convert.test.tsx` | 顶部加同步 rAF stub（与 FloatingToolbarV2 一致），修复 Phase 2 节流后转换集成测试时序 | 测试 |
| `e2e/cross-block-selection.spec.ts` | 新增 2 例：反向跨多类型拖选+Backspace 删除（P3）；`selectionchange` 计数探针收敛（P1/P2） | 测试 |

未改动（规范 4.5 禁区确认）：块树模型、双向转换、`deleteLeafRange`、controllers、撤销/重做、自动保存、G1/G3 显示与转换矩阵语义、自定义下拉 DOM。

## 3. 红/绿证据要点

| 阶段 | 内容 | 结果 |
| ---- | ---- | ---- |
| Phase 0 | 基线审计：vitest 289/289、tsc 通过 | 绿 |
| Phase 1 | syntaxType 短路：5 例新用例 RED（`expected ... to be null`）→ 实现后 26/26 | 红→绿 |
| Phase 2 | FloatingToolbar 节流：4 例新用例 RED（raf spy 0 次）→ 26/26；syntaxType 26/26 无回归 | 红→绿 |
| Phase 3 | 端点变化检测：纯函数/hook 用例 RED（`areRangeEndpointsEqual is not a function`、spy 2 次）→ 11/11；EditorV2 抽测 25/25 | 红→绿 |
| 并发回归 | Phase 2 节流使 EditorV2Convert 8 例同步断言工具栏失败 → 测试顶部补同步 rAF stub | 红→绿 |
| Phase 5 | E2E 新增 2 例；旧实现计数 19-59 vs 修复实现 10-51（探针降低约 15-33%）；30/30 | 绿 |

## 4. 回归门禁（全绿）

```text
$ npx vitest run          Test Files 23 passed | Tests 309 passed（存量 289 + 新增 20）
$ npx tsc --noEmit        通过
$ npx eslint <改动文件>    0 error
$ npx vite build          构建成功
$ npx playwright test     30 passed（28 存量 + 2 新增）
```

## 5. 遗留说明

- **上限值 500 未压测校准**：为规范草案建议值，真实拖选压测校准留给后续（规范 7 风险表认可）。
- **`resolveSyntaxTypesInRange` 语义收窄**：`null` 含义扩展为「反向/不可达/类型不一致/超上限」，FloatingToolbar 既有 `null→false` 处理已覆盖；若未来需要「拿到混合类型完整数组」的能力，属独立后续任务。
- **E2E 计数阈值依赖环境帧率**：headless 合成事件无法复现真实高频鼠标流，探针断言以「静止后计数不再增长 + 总量 ≤ 120」为回归门禁，真实风暴判别主要由 Phase 1/2 的 Vitest 覆盖。
- **阶段执行采用子代理分工**：总指挥只负责计划、验收与门禁，实现细节在各执行智能体独立上下文中完成。
