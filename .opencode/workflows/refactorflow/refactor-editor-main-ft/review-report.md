# 代码审查报告：refactor-editor-main-ft（U1–U23）

> 审查范围：`git log 7488ea9..HEAD`（26 提交 + M1 修复 = 27 提交）
> 审查方式：子代理逐文件对拍 + 全量回归 | 日期：2026-08-09

## 1. 结论摘要

- **Critical / High：0 项**
- **Medium：1 项（M1）已修复**
- **Low：2 项**（L1 提交粒度/信息重复、L2 exhaustive-deps warning）

**判定：可验收**。

| 门禁 | 结果 |
|---|---|
| `tsc --noEmit` | 0 error |
| `vitest run` | 32 文件 / 493 tests 全绿（基线一致，无漂移） |
| `eslint`（变更文件，无 --fix） | 0 error（8 warning 为既有模式） |

## 2. 问题清单

### Critical（0 项）
无。

### High（0 项）
无。

### Medium（1 项，已修复）

**M1 — U4 clamp 去重不完整：FloatingToolbar 保留本地 `clamp` 副本**
- 位置：`FloatingToolbar.tsx:124-126`（修复前）
- 问题：`shared.ts` 已提供 `clamp`，formatCtrl 已改用共享版，但 FloatingToolbar 本地副本未删。
- 修复：删除本地 `function clamp`，改 `import { clamp } from '../../../editor/controllers/shared';`（提交 `40e533b`）。typecheck 0 error、lint 干净、vitest 493/493 通过。

### Low（2 项）

**L1 — 提交粒度与声明不符（26→27 提交 vs 23 单元）**
- U1「unify zero-width strip」出现两条相同信息提交（LeafBlock+selection 部分、inputCtrl+selection 部分）；U6/U8 各拆两个提交。内容完整落地，仅历史可追溯性问题。
- 处理：交付总结如实说明；未做 rebase（避免破坏并行历史）。

**L2 — 8 条 react-hooks/exhaustive-deps warning**
- 位置：`useContentSync.ts:40,46`、`useEditorActions.ts:71,103,124,164,217,307`
- 根因：`instanceRef`（ref）/`setTree`（setter）为稳定引用，与重构前 EditorV2 既有模式一致，非本次引入。
- 处理：列入遗留清单，可接受。

## 3. 越界检查 ✅

- 18 个文件全部在范围内；kernel 仅新增 `export` 未改函数体；`controllers/index.ts`、`types.ts`、`editorInstance.ts`、其他组件/数据层、全部测试文件零改动。
- `shared.ts` 仅 import kernel 类型，无循环依赖；controllers/v2 均直连文件 import，未走 index.ts。
- 无密钥泄漏、无权限逻辑、无危险模式（L4 项为零）。

## 4. 坏味道消除核验表

| # | 坏味道 | 状态 |
|---|---|---|
| ① 重复 | 零宽剥离×3 → kernel 单点 | ✅ |
| ① 重复 | clamp×2 → shared.ts | ✅（M1 修复后） |
| ① 重复 | 父链解析×4 → getListContext/getQuoteContext | ✅ |
| ① 重复 | 空段落后置×4 → appendEmptyParagraph | ✅ |
| ① 重复 | 标记表×2 → MARKERS 导出复用 | ✅ |
| ① 重复 | 按钮 JSX×3 → ToolbarButton | ✅ |
| ① 重复 | rAF×2 → createRafThrottle | ✅ |
| ② 过长 | formatRange/exitListItem/handleEnter/handleKeyDown/onConvertBlock/handleInput 拆分 | ✅ |
| ③ 命名 | fade→delay-hide / applyAction→applyBlockAction / processInput→syncDomToModel | ✅ |
| ④ 上帝 | EditorV2 → 4 hooks（收敛 117 行） | ✅ |
| ⑤ 公共 | commitTree/getListContext/createRafThrottle/ToolbarButton/appendEmptyParagraph | ✅ |

**行为等价性重点核验**：formatRange 分支顺序与 cursorOffset 计算逐行保留；exitListItem 守卫并集经调用链上游保证等价；handleEnter early-return 顺序保留；handleKeyDown guard/modifier 保留；useEditorActions prevTree 比较 + commitTree 顺序保留；useFocusRestore layout effect 依赖 `[tree, getBlockEl]` 等价原 `[tree]`；rafThrottle schedule/flushNow/cancel 语义一致。

## 5. 剩余风险

- 交互密集路径（拖选末帧、聚焦恢复时序、工具栏驻留）依赖单测与 493 例回归覆盖；可选 Playwright e2e 未作为成功标准，如需更高信心可补跑 `e2e/floating-toolbar.spec.ts` / `e2e/cross-block-selection.spec.ts` / `e2e/drag-selection-markers.spec.ts`。
