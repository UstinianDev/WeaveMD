---
name: agent-memory-a-a-done
description: agent-memory-optimize 批 A-a（P0-2 文案）完成与措辞取舍——统一句落位、规则 3/4 填充理由、摘要前缀不含防串题条款
metadata:
  type: project
---

2026-09-28，devflow 阶段 3 批 A 步骤 A-a（P0-2 文案改写）完成，改动限于 4 个文件（`src/main/ai/agent/agentPromptBuilder.ts`、`src/main/ai/contextManager.ts` + 两个同名测试），**未提交**（与并行子代理共享工作树，见 [[devflow-batch-parallel-subagents]]）。

**Why:** P0-2 要求四处同批去掉反上下文指令，但「保持原有条目编号/结构」与「删除整个条目」互相冲突，必须做取舍并留下理由，否则后续 review 会当成随意改动。

**How to apply:**
- 统一句（三处原文一致）：`历史与摘要仅用于理解当前问题中的指代与上下文，不要延续上一轮未完成的作答`；`agentContext.ts:449` 由并行 A-b 子代理写入同句（前缀 `【重要】请只回答最后一条用户消息。`）。
- 核心规则 / CHAT 的 **规则 3 被填成**「用户消息中的指代词（如“它”“这个”）结合历史与摘要理解所指对象」——被删的原文整条都是反上下文，为保住 1/2/3/4 编号不空档，用 req P0-2「边界：合法指代允许沿用历史」的正向表述填充；CHAT 规则 4 改为「与当前问题无关的历史话题不主动展开」。
- `contextManager` 摘要前缀**含统一句但不含「必须且只能回答」**：`buildCompressed` 收到的 `history` 不含 system prompt，防串题由主 system prompt（CHAT/Agent 两版规则 1）承载，往摘要行里塞是重复计费。验收若按「四处均 toContain」机械断言会误报，按此口径解释。
- `SUMMARY_USAGE_NOTE` 已 export，后续若要消除字符串重复可从 `contextManager` 引用，**不要**反向让 `contextManager` 引 `agentPromptBuilder`（会把 llmClient 图拉进纯字符串模块的测试）。
