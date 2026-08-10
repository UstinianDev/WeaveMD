# 代码审查报告：fix-inline-marker-remainder

> 审查方式：sub-agent 独立审查 + 实测回归 | 日期：2026-08-09

## 结论

**Approved** — 单行修复直击根因（`inlineLexer.ts:381` children 追加递归），边界推导与回归均验证成立。Critical/High/Medium 均为 0，仅 Low（可选、非阻塞）。

## 问题清单

| 级别 | 位置 | 描述 | 处置 |
|---|---|---|---|
| Critical | — | 无 | — |
| High | — | 无 | — |
| Medium | — | 无 | — |
| Low | `inlineLexer.test.ts`（A 组） | 零长度剩余区（`***a*b**`）未显式断言 children；剩余区多连续 token / 转义文本 / 首字符空格无用例（结构可证安全） | 可选，不阻塞 |
| Low | `formatCtrl.test.ts`（D 组） | D 组为字符串级探针，不依赖 lexer children，修复前也绿；仅作"fold 无需修改"冒烟证据 | 定位说明即可 |

## 等价性验证（实测）

- `***12*3**`、`***12*34**`、`***12*3*4**` children 均为 `['em']` ✅
- `***x***` 走 L432-457 标准三连分支，不进入 matchOpenTripleSplit ✅
- 既有精确 HTML 断言（inlineRenderer.test.ts:212）保持通过 ✅
- 新 children 全部落在 strong (contentStart, contentEnd) 内；唯一 `start<contentStart` 为既有 em 几何 quirk（renderer 容错），非本次引入 ✅
- 共用路径（stripSameStylePairs/stripInlineSyntax/findIntersectingStyleTokens）按 children 泛递归自动受益，无既有断言破坏 ✅

## 回归结果

- 定向 vitest：4 文件 157 passed
- 全量 `npm test`：508 passed（493 既有零漂移 + 15 新增）
- `npm run typecheck`：0 error
- eslint（只读）：0 error

## 越界检查

git diff 仅 5 文件（inlineLexer.ts +1 行 + 4 测试 +179 行）；inlineRenderer/inlineStrip/controllers-formatCtrl 零改动；无敏感信息/权限变更。

## 剩余风险

- Low 覆盖空档（多连续 token、转义剩余区）经结构推导安全，可选补例。
- D 组定位 = fold 冒烟，非本修复护栏。