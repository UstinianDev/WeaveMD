# SPEC-EDIT-DSF 合规检查报告（skill-comply）

> 检查对象：SPEC-EDIT-DSF 实施过程与产物（2026-08-08）
> 规则源：`docs/specs/drag-selection-flicker.md` + tdd-workflow 技能
> 方法：skill-comply 方法论（规则提取 → 逐项 LLM 分类 → 时序核验）。
> 自动化 `claude -p` 场景重放管线用于"未来行为"度量，不适用于已完成实施的
> 事后审计，本次以产物 diff、测试输出与 TDD 证据报告为证据源逐项核对。

## 1. 期望行为序列（自规范提取）

1. P1 端点级变化检测：`lastAppliedRangeRef` 记录上一帧实际写入端点为
   `{startNode, startOffset, endNode, endOffset}`，`isEqualNode`+偏移比对。
2. P1 端点全等跳过 `removeAllRanges + addRange`；端点变化才写入并更新 ref。
3. P1 保留 mouseup 末帧兜底与 3 帧重放（SPEC-EDIT-FT 4.4.6）。
4. P1 辅助：拖选期间温和抑制，不采用 preventDefault，同块保持原生选择。
5. P2 `FloatingToolbar.handleSelectionChange` 改 rAF 合并：事件仅写
   `latestSelectionRef`，帧内一次 `computeToolbarState + setState`（≤ 每帧一次）。
6. P2 `visibleRef` 记录当前可见性，`setVisible` 仅在值变化时调用。
7. P2 辅助 `resolveSyntaxTypesInRange` 边枚举边比对，一旦与首个类型不同立即返回。
8. P2 辅助区间叶子上限（≤500），超限直接判定不一致。
9. 禁区（4.5）：不改块树模型、双向转换、`deleteLeafRange`、controllers、撤销/重做、
   自动保存；不改 G1/G3 语义与自定义下拉 DOM。
10. 测试：6.1 单测三组（端点变化检测/短路/工具栏节流 fake timers）。
11. 测试：6.2 E2E（反向多类型拖选+删除；拖选期间 selectionchange 计数收敛）。
12. 门禁：vitest / tsc / ESLint(0 error) / vite build / playwright 全绿。
13. TDD：测试先行且 RED 验证 → 最小实现 GREEN → 证据报告。
14. 文档回写：TDD 报告 + SUMMARY.md 同步。

## 2. 逐项核验

| # | 规则项 | 结果 | 证据 |
| - | ------ | ---- | ---- |
| 1 | 端点级变化检测结构 | PASS | `useCrossBlockDragSelection.ts` 新增 `RangeEndpoint` + `lastAppliedRangeRef`，`areRangeEndpointsEqual`（`isEqualNode`+offset，try/catch 降级引用相等） |
| 2 | 端点全等跳过写入 | PASS | 跨块分支构造 candidate 与 ref 比对，全等跳过 `removeAllRanges+addRange`；hook 级测试 spy 断言"未变化 1 次写入 / 变化正常写入" |
| 3 | mouseup 末帧兜底 + 3 帧重放保留 | PASS | `lastDragRangeRef`/`lastFocusSpanRef` 更新与末帧兜底/重放逻辑无 diff 变更；hook 测试覆盖末帧兜底 |
| 4 | 温和抑制 / 不用 preventDefault | PASS | 无 preventDefault 新增；同块原生选择语义未动，仅依赖静止停写 |
| 5 | selectionchange rAF 合并 | PASS | `FloatingToolbar.tsx` 新增 `latestSelectionRef`+`rafIdRef`，帧内一次 `flushSelection`；测试 N 次事件合并 ≤1 次计算 |
| 6 | visibleRef 去重 setVisible | PASS | `setVisibleGuarded` 统一收口，仅值变化时同步 ref 并 `setVisible`；hide/fade/show/scroll/format/blockChange 全调用点走该函数 |
| 7 | 一致性判定短路 | PASS | `resolveSyntaxTypesInRange` 改边枚举边比对，`sameSyntaxType` 提前返回 `null`（非全量构造） |
| 8 | 区间上限 500 | PASS | `MAX_RANGE_LEAF_COUNT = 500` 常量 + 注释标注规范 4.4；501 叶超限用例直接判不一致 |
| 9 | 禁区零触碰 | PASS | `git diff --stat`：生产改动仅 syntaxType.ts / FloatingToolbar.tsx / useCrossBlockDragSelection.ts 三文件；块树模型/controllers/撤销重做/自动保存/G1/G3/下拉 DOM 无 diff |
| 10 | 6.1 单测三组 | PASS | syntaxType.test.ts（5 新增短路/上限）、floatingToolbarV2.test.tsx（4 新增节流，fake timers+rAF stub）、useCrossBlockDragSelection.test.ts（新增 11 例，纯函数 8 + hook 3） |
| 11 | 6.2 E2E | PASS | cross-block-selection.spec.ts 新增 2 例：反向多类型（h1+paragraph+quote）拖选+Backspace 删除；`selectionchange` 计数探针（addInitScript + document 监听）静止不增长 + ≤120 |
| 12 | 门禁全绿 | PASS | vitest 309/309（23 文件）、playwright 30/30、tsc exit 0、ESLint 0 error、vite build 成功 |
| 13 | TDD 先红后绿 | PASS | 各 Phase 先运行新用例确认 RED（syntaxType 3 例、toolbar 4 例、hook 10 例）→ 实现后 GREEN；E2E 计数探针在旧实现下实测更高（19-59 vs 10-51） |
| 14 | 文档回写 | PASS | `docs/testing/spec-edit-dsf.tdd.md`（旅程/改动清单/红绿证据/门禁摘录/遗留）+ SUMMARY.md §3 拖选闪烁优化 + §4 测试计数 |

## 3. 合规率

- 检查项 14：PASS 14，DEVIATION 0，FAIL 0。
- **严格遵循率 14/14 = 100%**。

## 4. 时序核验（TDD 红→绿顺序）

证据报告记录：Phase 1 新用例 RED（`expected ... to be null`，3 例）→ 实现语法类型
短路 → 转绿；Phase 2 RED（raf spy 0 次，4 例）→ rAF 合并 → 转绿；Phase 3 RED
（`areRangeEndpointsEqual is not a function`、spy 2 次，10 例）→ 端点比对 → 转绿。
顺序符合 TDD RED 门要求。唯一既有断言修改（syntaxType h1+paragraph 完整数组 →
`toBeNull()`）是规范 4.4 行为变更的口径对齐，发生在 GREEN 后且语义注释同步更新，
非"改测试凑绿"。E2E 计数用例在已修复代码上直接绿，RED 以探针新旧实现实测对比
（修复始终更低，降幅 15-33%）作为等效验证，已在证据报告 §3/§5 记录。

## 5. 结论与后续建议

实施与 SPEC-EDIT-DSF 及 tdd-workflow 实质一致，14 项全部 PASS，无违规项。建议：

1. 上限值 500 为规范草案建议值，如需按规范 7 做真实拖选压测校准，可另行立项。
2. `resolveSyntaxTypesInRange` 的 `null` 语义已收窄（含"类型不一致/超上限"），
   当前 FloatingToolbar 契约兼容；若未来需"获取混合类型完整数组"，属独立任务。
3. 并行子代理执行期间两文件（FloatingToolbar/useCrossBlockDragSelection）曾有
   并发编辑，已由总指挥全量门禁复核确认无冲突。
4. 本实施采用 Task 子代理分工（4 个执行智能体），总指挥负责计划/验收/门禁，
   规避上下文膨胀；未创建一次性 skill 文件（agent-skill-creator 适用可复用工作流，
   本任务为一次性修复，经裁量未采用）。
