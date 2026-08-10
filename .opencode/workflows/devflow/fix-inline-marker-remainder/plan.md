# 实现计划：fix-inline-marker-remainder（open 三连拆分剩余区未递归 tokenize 缺陷）

> 来源：DevFlow 阶段 2 @planner | 需求：requirements.md | 日期：2026-08-09

## Overview

`inlineLexer.ts` `matchOpenTripleSplit` 处理非对称三连 `***12*3**`（strong `**` + em `*`）时，手工构造的 strong token 的 `children` 只含 em，导致 `emClose+1` 到 `strongClose` 之间的剩余内容（如 `***12*<u>3</u>**` 的 `<u>3</u>`）未被 `tokenizeInline` 递归，渲染器按普通文本转义 → 显示字面量 `12<u>3</u>`、样式丢失。**唯一源码改动**：children 追加剩余区递归结果。

## 架构结论（已逐行推演）

- 修复仅追加 children：`[em, ...tokenizeInline(text, emClose + 1, strongClose)]`；em 字段、strong 其余字段一字不动。
- `***12*3**` 剩余区为纯文本 → `tokenizeInline` 返回 `[]` → 形态不变（护栏）。
- `***x***` 走 L431-457 标准三连分支，`matchOpenTripleSplit` 不进入（护栏）。
- 五种成对标记（`~~`/`==`/`<u>`/`` ` ``/`$`）剩余区均被各自 matcher 命中，token.end ≤ strongClose（findMarker 有界）。
- 递归有界：子区间严格短于 strong 内容区。
- `inlineRenderer.ts` `renderTokenList` 的 `while (i < token.start)` 对 `token.start < from` 已有容错（em 的 start=2 < contentStart=3 既有几何 quirk），新 children 行为正确 → **不修改**。
- `inlineStrip.ts` 非目标 token 分支递归 children，剩余区标记自动可剥离（橡皮擦/去重同步修复）→ **不修改**。
- `foldCrossStyleMarkers`（formatCtrl L72-96）：探针测试驱动（D 组），预推演 italic/strike 边界折叠均正确，**预计零改动**；RED 才修（修前等待确认）。

## 实施步骤

### Phase 0：基线确认（L2）
- `npm test` 确认既有 493 例全绿。

### Phase 1：RED —— 三层测试先行（L2，纯测试新增，不改既有用例）
1. `tests/editor/kernel/inlineLexer.test.ts` 追加 describe（A 组）：
   - A1 旗舰：`tokenizeInline('***12*<u>3</u>**')` → strong(0,16,openLen2)，children types `['em','underline']`，underline(6,14,cs9,ce10)。
   - A2 护栏：`***12*3**` children 仍 `['em']`。
   - A3 护栏：`***12*34**` children 仍 `['em']`。
   - A4 五种成对标记 [del/mark/underline/code/math] 逐一识别（start=6、内容区间断言）。
   - A5 嵌套：`***12*~~<u>3</u>~~**` del 内嵌 underline。
2. `tests/editor/kernel/inlineRenderer.test.ts` 追加 describe（B 组）：
   - B1 旗舰：`renderInline('***12*<u>3</u>**')` 精确 HTML（strong>em+u 嵌套）、无字面 `&lt;u&gt;3&lt;/u&gt;`、textContent 往返一致。
   - B2 五种标记各渲染出目标标签 + 往返一致。
   - B3 嵌套 `***12*~~<u>3</u>~~**` 含 `<del>` 与 `<u>`。
3. `tests/editor/controllers/formatCtrl.test.ts` 追加 describe（C 组）+ 顶部 import renderInline：
   - C1 对 `***12*3**` 选 `3`(6,7) apply underline → 文本 `***12*<u>3</u>**`，renderInline 含 `<u>` 嵌套、无字面 `&lt;u&gt;3&lt;/u&gt;`。
   - C2 其余风格叠加文本级守卫（strike/highlight/code/math）。
   - C3 橡皮擦整块：`clearFormat(0,16)` → `123`。
   - C4 橡皮擦区域：`stripInlineSyntax('***12*<u>3</u>**', 9, 10)` → `*12*3` 无 `<u>` 残留。
4. `tests/editor/kernel/formatCtrl.test.ts` 追加 describe（D 组，fold 审查探针）：
   - D1 `applyFormat(...,'italic',9,14)` → `***12*<u>*3*</u>**`
   - D2 `applyFormat(...,'italic',6,10)` → `***12*<u>*3*</u>**`
   - D3 `applyFormat(...,'strike',9,14)` → `***12*<u>~~3~~</u>**`

### Phase 2：GREEN —— 单点修复（L3）
5. `inlineLexer.ts` `matchOpenTripleSplit` children 改为：
```ts
children: [
  { type:'em', start:i+2, end:emClose+1, openLen:1, closeLen:1, contentStart:searchFrom, contentEnd:emClose,
    children: tokenizeInline(text, searchFrom, emClose) },
  ...tokenizeInline(text, emClose + 1, strongClose),
],
```
   验证：三个定向测试文件全绿（新用例 GREEN、既有全绿）。

### Phase 3：回归与收尾
6. `npm test`（493+约15 新增全绿）→ `npm run typecheck`（0 error）→ `npm run lint`（无 error；跑后审查 git diff 防 --fix 噪音）。
7. **条件分支**：D 组探针 RED 才动 `foldCrossStyleMarkers`（修前人工确认，限该函数最小修复）；全绿则记录"无需修改"。
8. `git diff` 确认仅 `inlineLexer.ts` + 4 测试文件，`inlineRenderer.ts`/`inlineStrip.ts`/`formatCtrl.ts`（若探针绿）零改动。

## 测试命令

- 定向：`npx vitest run tests/editor/kernel/inlineLexer.test.ts tests/editor/kernel/inlineRenderer.test.ts tests/editor/controllers/formatCtrl.test.ts tests/editor/kernel/formatCtrl.test.ts`
- 全量：`npm test`
- 静态：`npm run typecheck`、`npm run lint`

## 风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 破坏 `***12*3**`/`***x***` 既有形态 | A2/A3 护栏 + 现有测试 + 全量回归 |
| R2 | 共用路径行为变化（expect 修复） | grep 确认无既有断言依赖旧行为 |
| R3 | 剩余区 token start<contentStart 边界 | renderTokenList/stripTokens 已容错，现有用例护栏 |
| R4 | 探针 RED 外溢 lexer 歧义 | 限定 foldCrossStyleMarkers 最小修复；lexer 歧义判范围外 |
| R5 | lint --fix 噪音 | diff 审查联动 |

## 成功标准

- [ ] RED：A/B/C 新用例失败、既有全绿
- [ ] GREEN：A1 得 `['em','underline']`、B1 精确 HTML 无字面 `<u>`
- [ ] `***12*3**`/`***x***` 形态不变
- [ ] 橡皮擦 `stripInlineSyntax(...,9,10)` → `*12*3` 无残留；`clearFormat` 整块 → `123`
- [ ] D 组探针全绿（fold 无需修改）；若 RED，最小修复后全绿
- [ ] 既有 493 全绿、typecheck 0 error、lint 无 error
- [ ] git diff 仅限 inlineLexer.ts + 4 测试文件

## 风险等级

- **L3**：Step 5（inlineLexer 内核修改）——单点 + 全量回归；已获 grill-me Q1-A 共识批准。
- **L3（条件）**：Step 7 foldCrossStyleMarkers 修改——仅探针 RED 时，修前人工确认。
- **L4**：无。

## 遗留（范围外不处理）

- 非 open 三连形态、close run 拆分、四连边界：既有覆盖不改。
- `stripSameStylePairs` 对 open 三连文本非目标风格剥离时的 `****` 几何 quirk：既存现象不引入不修复。
- fold 若遇 lexer 歧义根因：判范围外，单独任务。