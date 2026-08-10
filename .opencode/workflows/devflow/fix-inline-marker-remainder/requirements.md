# 需求文档：fix-inline-marker-remainder

> 任务名：fix-inline-marker-remainder
> 来源：DevFlow 阶段 1 grill-me 共识（Q1–Q4 全选 A）
> 日期：2026-08-09

## 1. 问题描述

浮动工具栏对不同语法符号**持续叠加**时，标记解析/渲染出现错误。复现路径：

1. 输入 `123`
2. 加粗 → `**123**` ✅
3. 对 `12` 斜体 → `***12*3**` ✅（open 三连拆分产物，现有测试覆盖）
4. 对 `3` 下划线 → `***12*<u>3</u>**` ❌
5. 期望富文本：`12`（粗斜体）+ `3`（粗体+下划线）
6. **实际富文本**：`12<u>3</u>` —— `<u>` 被当普通文本转义显示为字面量，斜体/粗体样式丢失

高亮（`==`）、删除线（`~~`）、行内代码（`` ` ``）等其他成对标记在 `***x*…**` 剩余区出现同样问题；数字越长、重复操作越多，问题越严重。

## 2. 根因（已查证）

`src/render/editor/kernel/inlineLexer.ts` `matchOpenTripleSplit`（L351-383）：

- 处理非对称三连（`***12*3**` → strong 外层 `**` + em 内层 `*`）。
- 手工构造的 strong token 的 `children` **只包含 em token**，覆盖区间 `[i+2, emClose+1)`。
- strong 的 `contentEnd = strongClose`，但 `emClose+1` 到 `strongClose` 之间的剩余内容（如 `<u>3</u>`）**没有被 `tokenizeInline` 递归**。
- 渲染器（`inlineRenderer.ts` `renderTokenList`）对未被 token 覆盖的间隙按普通文本转义 → `<u>` 显示为字面量。

**影响面**：`inlineRenderer` 与 `inlineStrip`（`stripSameStylePairs`/`stripInlineSyntax`，橡皮擦路径）共用 `inlineLexer` 的 token 路径，因此**橡皮擦/同风格去重对剩余区的成对标记同样无法识别**，可能残留标记或错误剥离。

## 3. 决策（grill-me 共识，全选 A）

| # | 决策 | 结论 |
|---|---|---|
| Q1 | 修复层面 | **A**：在 `matchOpenTripleSplit` 内把 strong 的 `children` 从 `[em]` 改为 `[em, ...tokenizeInline(text, emClose+1, strongClose)]`，剩余区间继续递归。单点最小改动。 |
| Q2 | 需求范围 | **A**：覆盖所有剩余区间形态（strike `~~` / highlight `==` / underline `<u>` / code `` ` `` / math `$`），同一根因同一行修复，统一补测试。 |
| Q3 | 测试策略 | **A**：TDD 三层测试——`inlineLexer.test.ts`（tokenize）、`inlineRenderer.test.ts`（渲染）、`formatCtrl.test.ts`（格式化/橡皮擦）。 |
| Q4 | 遗留边界 | **A**：纳入审查 `foldCrossStyleMarkers`（formatCtrl L72-96）；若 `***12*<u>3</u>**` 选区边界再叠加暴露遗漏则一并修复，以测试驱动暴露。 |

## 4. 目标

- 修复 open 三连拆分产物中**剩余内容未被递归 tokenize** 导致的渲染/清除缺陷。
- 保证 `***12*<u>3</u>**` 正确渲染为「12 粗斜体 + 3 粗体下划线」，且 `<u>` 不显示为字面量。
- 同一 token 路径下橡皮擦（`clearFormat`）、同风格去重（`stripSameStylePairs`）行为同步正确。

## 5. 范围

### 范围内
- `src/render/editor/kernel/inlineLexer.ts`：`matchOpenTripleSplit` 的 `children` 构造（最小改动）。
- `src/render/editor/kernel/inlineRenderer.ts`：仅验证，若渲染无缺陷则不改。
- `src/render/editor/kernel/inlineStrip.ts`：仅验证（共用 token 路径，可能无需改动）。
- `src/render/editor/controllers/formatCtrl.ts`：`foldCrossStyleMarkers` 审查（Q4-A，测试驱动，仅在暴露遗漏时修复）。
- 新增测试：`tests/editor/kernel/inlineLexer.test.ts`、`tests/editor/kernel/inlineRenderer.test.ts`、`tests/editor/controllers/formatCtrl.test.ts`。

### 范围外
- 非 open 三连形态的标记解析（如 `***x***` 标准三连、close run 拆分 AGT-B、`***a****` 四连边界）——已有测试覆盖，不改语义。
- kernel 其他文件、controllers 其他模块、渲染组件、数据层。
- 不新增功能、不修复范围外 bug、不改变既有测试的既有断言。

## 6. 成功标准

- [ ] 新增测试先行（RED）→ 最小修复（GREEN），逐层通过：
  - `inlineLexer.test.ts`：`tokenizeInline('***12*<u>3</u>**')` 产生 strong 内嵌 [em, underline]。
  - `inlineRenderer.test.ts`：渲染输出无字面 `<u>`，正确嵌套 `<strong><em>12</em><u>3</u></strong>` 形态。
  - `formatCtrl.test.ts`：对 `***12*3**` 的 `3` 点 underline → `***12*<u>3</u>**`，再渲染正确；橡皮擦对剩余区标记可清除。
- [ ] 既有 493 例全部保持全绿（无断言改动）。
- [ ] `npm run typecheck` 0 error；`npm run lint` 无 error。
- [ ] 范围外零改动（`git diff` 仅限上述范围内文件）。

## 7. 假设 / 约束

- 修复必须保持 `***12*3**`（无剩余内容）与 `***x***`（标准三连）的既有 token 形态不变（现有测试为护栏）。
- 新增测试数量不设上限但须针对真实缺陷，避免仅为覆盖率而测试。
- 风险等级：L3（内核渲染/清除共用路径），修改前简报，单点改动 + 全量回归。

## 8. 未决问题

- 无（Q1–Q4 已定）。
