# SPEC-EDIT-FT TDD 实施证据报告

> 规范：docs/specs/floating-toolbar-refactor.md（SPEC-EDIT-FT v1.0）
> 日期：2026-08-08 | 运行器：Vitest 1.x + Playwright | 环境：Windows PowerShell
> 检查点说明：本次实施**未做任何 git commit**（用户未授权提交），以本报告作为阶段检查点证据。

---

## 1. 用户旅程（缺陷复现 → 修复验证）

| 缺陷 | 修复前 | 修复后（本实施） |
| ---- | ------ | ---------------- |
| G1 选中 h1+h2 也弹工具栏 | `computeToolbarState` 只校验"选区非折叠 + 在 block-content 内" | 新增 `selectionSyntaxTypesConsistent`（区间叶子块逐一 `resolveSyntaxType` 判等）；跨类型隐藏 |
| G2 反向跨块拖选选不中 | `mousemove` 同步无节流（卡顿）；反向 `setEnd` 塌陷致选区折叠为空 | rAF 节流 + 反向显式交换端点 + 非内容区回退 + mouseup 末帧兜底/多帧重放 |
| G3① 下拉打不开 | `<select>` 上 `onMouseDown={preventDefault}` 拦截展开 | 自定义下拉面板，`onMouseDown={stopPropagation}` |
| G3② 下拉始终显示"正文" | `currentType` 仅对 heading 返回 `h{n}`，其余一律 paragraph | `resolveSyntaxType` 映射 + `syntaxTypeToOption`；`canConvertBlock` 矩阵置灰不可转项 |

## 2. 改动清单

| 文件 | 改动摘要 | 性质 |
| ---- | -------- | ---- |
| `src/render/editor/kernel/syntaxType.ts`（新增） | `SyntaxType` + `resolveSyntaxType`（沿父链聚合，heading 优先自身） | 生产 |
| `src/render/editor/kernel/index.ts` | 导出 syntaxType | 生产 |
| `src/render/components/Editor/v2/types.ts` | `BlockTypeOption` 扩至 12 种、`BLOCK_TYPE_OPTIONS`、`canConvertBlock` 转换矩阵 | 生产 |
| `src/render/components/Editor/v2/FloatingToolbar.tsx` | 导出 `syntaxTypeToOption`/`selectionSyntaxTypesConsistent`；`computeToolbarState` 增 tree 参数做 G1 校验；自定义块类型下拉 | 生产 |
| `src/render/components/Editor/v2/EditorV2.tsx` | `onConvertBlock` 重写：`canConvertBlock + resolveSyntaxType` 前置校验分发（含 code-block 只读） | 生产 |
| `src/render/hooks/useCrossBlockDragSelection.ts` | rAF 节流 + 反向交换端点 + 非内容区回退 + mouseup 末帧兜底 + 多帧重放 | 生产 |
| `tests/editor/kernel/syntaxType.test.ts` | 21 例判定矩阵 | 测试 |
| `tests/components/FloatingToolbarV2.test.tsx` | 22 例：G1 显示条件、G3① 下拉展开/选择、G3② 映射、矩阵禁用 | 测试 |
| `tests/components/EditorV2Convert.test.tsx` | 8 例：`onConvertBlock` 转换矩阵分发 | 测试 |
| `e2e/floating-toolbar.spec.ts` | 5 例：自定义下拉选择器、G1 拖选 h1+h2 不显示、G3② 代码块只读 | 测试 |
| `e2e/cross-block-selection.spec.ts` | 2 例：正向跨块删除（存量）+ 反向跨块（G2） | 测试 |

未改动（规范禁区确认）：块树内核模型、双向转换、controllers/*、撤销/重做、自动保存。

## 3. 红/绿证据要点

| 阶段 | 内容 | 结果 |
| ---- | ---- | ---- |
| Phase 1 | `syntaxType.test.ts` 判定矩阵 21/21 | 绿 |
| Phase 2 | `FloatingToolbarV2.test.tsx` 22/22 + `floating-toolbar.spec.ts` 5/5 | 绿 |
| Phase 3 | `EditorV2Convert.test.tsx` 8/8 | 绿 |
| Phase 4 红 | 反向 G2：选区跨块但 `sel.toString()===''`，Backspace 只删部分 | 红 |
| Phase 4 绿 | 根因：Chromium 跨编辑宿主 `toString()` 仅返回 anchor 块内文本（Range 边界保留跨块）→ G2 改为与正向对称的 Backspace 块树级删除验证；修复 mouseup 末帧丢失与原生收尾覆盖 | 绿 |

## 4. 回归门禁（全绿）

```text
$ npx vitest run            Test Files 22 passed | Tests 289 passed
$ npx tsc --noEmit          通过
$ npx eslint <改动文件>      0 error
$ npx vite build            构建成功
$ npx playwright test       28 passed（含新增 floating-toolbar 2、cross-block-selection 2）
```

## 5. 遗留说明

- 列表间互转（bullet→task 等）、heading→列表/引用/代码块转换：`canConvertBlock` 置灰，
  列为后续任务（spec 4.3.3 边界内）。
- Chromium 对跨编辑宿主 Selection 的 `toString()` 裁剪为浏览器限制，非本实现缺陷；
  编辑器块树级操作（删除/转换）不依赖该文本，按 Range 边界正常工作。
