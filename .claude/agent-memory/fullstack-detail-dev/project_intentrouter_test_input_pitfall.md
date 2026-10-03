---
name: intentrouter-test-input-pitfall
description: intentRouter.test.ts 造用例时必须手工推演关键词子串命中——create 的单字「写」会被「缩写/扩写」误命中，拉低 confidence
metadata:
  type: project
---

`src/main/ai/intentRouter.ts` 的 `RULES` 用 `lower.includes(kw)` 做**子串**匹配，且 confidence = topScore/total（总分含所有意图命中）。

**Why:** 造「confidence 落在 [0.7, 0.85)」这类边界用例时，我第一次用 `润色缩写扩写代码` 想要 3/4=0.75，实际 rewrite=3 + tech=1 + **create=1（因为「缩写/扩写」含单字「写」）** → 3/5=0.6，掉进 `confidence < 0.7` 无条件门，导致 RED/GREEN 断言写反、白跑一轮。

**How to apply:**
- 给该文件写边界用例前，先逐条 RULES 手工枚举命中（尤其 create 的单字 `写`、`新`、`给`、`要`；tech 的 `库`、`接口`）。
- 想测**长度门**独立生效，必须保证 `confidence >= 0.7`：推荐 `修改优化整理代码`（rewrite 3 + tech 1 = 0.75，长度 8，不含「写」）。
- 想测 `confidence < 0.7` 无条件门，用 `写一个 react 组件`（create 1 + tech 1 = 0.5）。
- `needsClarification` 为 false 时返回对象**不带该字段**（spread 条件展开），断言用 `res.needsClarification ?? false`。**例外**：零命中 chat 兜底分支返回**显式 `false`**（字面量，非 spread）——见 。
- 相关：[[devflow-batch-parallel-subagents]]。
