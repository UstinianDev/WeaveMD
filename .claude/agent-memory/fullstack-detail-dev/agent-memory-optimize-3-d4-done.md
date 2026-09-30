---
name: agent-memory-optimize-3-d4-done
description: D4（六.2 经验结构化存储 + 任务类型注入）交付要点：EXPERIENCE_INTENTS 单一口径落点、prompt 护栏实现细节、覆盖/门禁实测与测试环境坑
metadata:
  type: project
---

# agent-memory-optimize-3 / D4 交付（2026-09-30，未提交）

**Why**：Gate E 第二项（方向文档六.2）。经验复用 D3 的 `_auto/` 技能文件正文，**不建表不新建存储**；
D4 只做 front matter `intents` 字段 + 按意图注入经验块。

**How to apply**：后续 D5（六.3 防膨胀）与 Gate F（三.3 向量经验库）都会碰到同一套口径与坑。

## 关键架构事实

- **`EXPERIENCE_INTENTS`（5 个显式规则意图，无 chat）定义在 `agentPromptBuilder.ts`**，
  被 `skillLoader` / `skillAutoStore` 跨层引用 —— 理由是**同一白名单不能有两份口径**，
  且 `agentPromptBuilder` **没有任何测试 mock 它**（而 `skillLoader` 被 5 个测试文件
  `vi.mock` 成只含 `loadSkills` 的部分工厂 → 若常量放 skillLoader，agentContext 取到 undefined）。
  新增「注入侧 + 技能侧共用的常量」优先放 agentPromptBuilder，不要放 skillLoader。
- **`buildAgentSystemPrompt` 的数组是 `...[].filter(Boolean).join('\n')`** —— 空串 `''`
  会被 filter 掉，所以 `...(cond ? [block, ''] : [])` 里的 `''` 是无效占位；
  **空块 = 逐字不变**靠「条件展开」实现，不是靠空串。
  **`buildChatSystemPrompt` 则没有 filter**（`parts.join('\n')`），`''` 真会产生空行 —— 两分支
  语义不同，改任一侧都要按各自口径写。
- `buildExperienceBlock` 在 `agentContext.ts`（与 `buildProfileBlock` 同侧），
  推断路径**复用 `classifyIntent(label, { hasHistory: true })`** 而非复制 intentRouter 关键词表
  （RULES 未 export，且红线禁止改 intentRouter 判定逻辑）。
- 未标 `intents` 的技能 → 推断；标了但全非法 → `[]`（**不回落推断**）；字段缺失 → `undefined`。

## 实测数字（estimateTokens，CJK 0.75 token/字）

主提示分层（三文件默认内容 + 40 条画像 + 典型单技能经验）：
核心规则 76 / 三文件 258 / 画像 1142 / **经验 188** / 工作流与工具规则 1286 /
角色与回复格式 181 / 注意力锚点 21 → **合计 3150 = 4.92% of 64000，余量 60850**；
无三块基线 1563；三块顶格最坏 7562 = 11.82%，余量 56438。
chat 基线 131 → 满载 1719。4000 字极限技能 2521 token（2000 上限截断保留 79%）。
`EXPERIENCE_TOKEN_LIMIT = 2000`（与 A1/B4 同刻度，三层合计 ≤6000 = 9.4%）。

## 门禁与测试基线

- 全量：**180 文件 / 4350 例**（D3 基线 180/4315 → +35 例，D4 新增测试全在 4 个既有测试文件内）。
- 改动行覆盖 **1069/1107 = 96.6%**；文件级 Stmts：agentPromptBuilder 95.22 / agentContext 92.13 /
  skillAutoStore 91.47 / skillDistiller 98.64 / skillLoader 98.68。
- eslint `0 errors, 108 warnings` = 基线（`no-console` 只对 `console.log` 报警，`console.warn/error` 放行）。

## 坑（复用价值）

- **vitest coverage 报告只在测试全绿时写出**（`coverage.reportOnFailure` 默认 false）——
  既知 flaky `ab-test djb2` 红一次就整个报告目录只剩 `.tmp`，需重跑到全绿才有
  `coverage-final.json`。
- `git diff` 统计改动行时，**未跟踪新文件（D3 新建的 skillAutoStore/skillDistiller）在
  `git diff` 里为空**，必须按整文件算，否则覆盖率虚高。
- 既知 flaky `ab-test djb2` 单跑 3 轮 = 绿·红·绿，与被测代码无关，**不要改被测代码**。

相关：[[agent-memory-optimize-3-d3-done]]、[[weavemd-test-env-pitfalls]]
