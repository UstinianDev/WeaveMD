---
name: agent-memory-optimize-2-a1a2-done
description: 第二批子批 A 的 A1/A2 已完成（三文件注入 + 摘要先行词）；含 agentPromptBuilder filter(Boolean) 空行坑与基线 sha256 手法
metadata:
  type: project
---

agent-memory-optimize-2 子批 A 的 **A1 + A2** 于 2026-09-29 完成（未提交，由总指挥统一提交）。

- A1：`buildAgentSystemPrompt` 加第 5 个可选参 `globalFilesBlock?: string`，块插在【核心规则】与 `## 工作流` 之间，
  内部 `truncateGlobalFilesBlock` 按 `GLOBAL_FILES_TOKEN_LIMIT=2000`（`estimateTokens` 二分裁剪）+ 块尾
  `(已截断，完整内容见设置页)` 标注。I/O 全在 `agentContext.ts`（`buildGlobalAgentFilesBlock` 导出 +
  `readGlobalAgentFilesBlock` 吞异常），**读取提出来做一次，两个分支共用**。
- **追加裁定（用户，2026-09-29）：chat 也要注入** —— `CHAT_SYSTEM_PROMPT` 不改常量，拆成
  `CHAT_HEAD_LINES` + `CHAT_ANCHOR_LINE` + 导出常量 `CHAT_SYSTEM_PROMPT`（逐字不变，仍是既有 4 条护栏的对象）
  + 新导出 `buildChatSystemPrompt(globalFilesBlock?)`；块插在【核心规则】之后、**【注意力锚点】之前**
  （锚点必须留末行 = recency bias）。空块直接 `return CHAT_SYSTEM_PROMPT`。
  原报告把读取放进真分支让 chat 零 I/O，此裁定后改为三元外提读一次、两分支都传。
- A2：`contextManager.ts` 两处压缩 prompt 同改（路径 A 末尾 user 指令 + 路径 B 回退 system prompt），
  共享「指代先行词 / 用户已确认的决策 / 关键结论」三条款；阈值与轮次常量零改动。
- 交付数字：三测试文件 106→125→**131**；typecheck 0 错；eslint 0 error（106 条既有 warning，未新增）；
  改动文件覆盖率 contextManager 97.34% / agentPromptBuilder 92.30% / agentContext 85.82%。
  全量 4036 passed / 2 failed（`cacheMonitor` + `ab-test` 两条性能断言，单跑 59/59 全绿）。

**Why:** 后续子批（B4 分层 Prompt 走同一 `globalFilesBlock` 通道、C1 改工具规则段）会回来动这些文件，
先记下本轮的决策边界，避免重做或推翻。

**How to apply:** 动 `agentPromptBuilder` / `agentContext` / `contextManager` 前先读本条 + 需求
`docs/requirements/agent-memory-optimize-2.req.md` 的 Q2/Q3/Q4/Q5 裁定。

## 两个踩过的坑

1. **`buildAgentSystemPrompt` 数组末尾是 `.filter(Boolean).join('\n')`** —— 数组里手写的 `''`
   分隔项**会被整条滤掉**，根本不会产生空行；空行只来自元素自身内嵌的 `\n`（如 `clarificationPrefix` 结尾的 `\n`）。
   所以「核心规则」到「## 工作流」在产物里是**单个 `\n`**（`4. ...\n## 工作流`），不是 `\n\n`。
   **How to apply:** 任何断言该提示词「空行/结构」的测试都按单 `\n` 写；加可选块时用
   `...(x ? [x, ''] : [])` 也只是不影响基线（反正 `''` 会被滤掉），真正要保证的是不新增非空元素。
2. **「不传参输出逐字一致」用 sha256 基线断言**：TDD 前用 `npx esbuild --bundle --format=cjs` 把
   `agentPromptBuilder.ts` 打到临时目录跑一次，取 4 个变体的 sha256 写进测试常量。
   比贴 2858 字符全文快且精确。基线值见 `tests/main/ai/agentPromptBuilder.test.ts` 的 `BASELINE_SHA256`。

相关：[[project_fullsuite_flaky_perf_tests]]（全量跑时 cacheMonitor 性能用例并行必红、单跑必绿，
本次全量 4031 passed / 1 failed 即该条）、[[project_devflow_parallel_subagents]]（子批 A 三路并行，
kbSearch 的红/绿要按文件归属判）。
