---
name: agent-memory-optimize-2-b4-done
description: agent-memory-optimize-2 子批 B4（分层 Prompt 画像层）已完成未提交，实测五层 token 占比与下一任务
metadata:
  type: project
---

B4 于 2026-09-30 完成（未 commit，工作树含 4 个文件改动 + 总指挥并行改的 `docs/TODO.md`）。

**改动**：`src/main/ai/agent/agentPromptBuilder.ts`（`profileBlock?: string` 第 6 参 + `PROFILE_TOKEN_LIMIT=2000` +
通用 `truncateBlockWithMarker`）、`src/main/ai/agent/agentContext.ts`（`buildProfileBlock` 导出 + 私有
`readActiveProfileBlock(userId, db?)` + 三元两分支各传一次）、两个测试文件追加 32 例（B4 相关）。

**关键实现口径**（总指挥裁定落地）：
- 画像 db 来源 = `AgentLoopDeps.db`（生产只有 `agentTaskWorker.buildAgentDeps` 一处调用 `runAgentFlow`，恒注入
  `db: this.db`）；`deps.db` 缺失 → 不发起查询直接 `''`。
  **Why:** 导入 `@main/db/index` 会加载 better-sqlite3 原生模块，vitest 下 `ERR_DLOPEN_FAILED`，
  会连带打挂 `agentLoop.test.ts` / `agent-perf-benchmark.test.ts` 等所有 transitively 导入方。
- 画像块：`【用户画像】` 稳定标题 + `- subject：content` + 条数上限 40（`writtenAt` 新者优先、同刻 `id` 降序）+
  超限标注 `(画像超过 40 条，已省略 N 条较旧条目)`；空画像/查询抛错/无 db → 一律空串零噪音。
- A1/B4 护护栏（sha256 基线 + `toBe(buildChatSystemPrompt(...))`）全绿未动。

**五层 token 实测**（`estimateTokens`，agent 主提示无快照）：L1 核心规则 76(2.8%) / L2 个性化层 1246(46.3%,
其中三文件 258 + 画像 988，40 条典型画像) / L3 工作流与工具规则 1170(43.4%) / L4 角色与回复格式 181(6.7%) /
L5 注意力锚点(核心规则第 4 条) 21(0.8%)；合计 2693 token，64000 余量 61307。加请求期快照层(50 文件列表+10 本地文件+1 附件)
862 token → 3555，余量 60445。chat 主提示 1376（基线 131，个性化层增量 1245）。

**Why:** 下一批/Gate B 要引用这份实测表，重测成本高。
**How to apply:** 接 C1/C2/C3 前先看 [[agent-memory-optimize-2-b4-done]] 里的注入口径；改动 `buildAgentSystemPrompt`
参数时必须同时跑 `tests/main/ai/agentPromptBuilder.test.ts` 的 sha256 护栏。

**下一任务**：Gate B（L4，含真库 smoke）→ 子批 C（C1 两工具 → C2 后台写入 → C3 设置页可见入口 → C4 E2E）。
