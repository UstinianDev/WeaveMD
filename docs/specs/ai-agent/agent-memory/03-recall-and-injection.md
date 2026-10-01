# Agent 自动记忆 — 召回与经验注入（SPEC-AGENT-MEM 分册 3/3）

> 规范编号：SPEC-AGENT-MEM-03 | 更新：2026-10-01
> 承载 [agent-memory.md](../agent-memory.md) 的召回与经验注入实现级行为契约（混合召回、轨迹提炼、经验注入）；返回索引：[agent-memory.md](../agent-memory.md)
> 关联需求：[agent-memory-optimize-3.req.md](../../../requirements/agent-memory-optimize-3.req.md)（Q4/Q5/Q8/Q9）；Prompt 组装管线与 front matter `intents` 解析契约见 [agent-prompt-context.md](../agent-prompt-context.md)
> 来源标记：〔plan-3〕= `docs/plan/agent-memory-optimize-3.plan.md` §6；过程证据见 `docs/testing/agent-memory-optimize-3.tdd.md`

---

## 1. 向量混合召回（`searchMemories`，D6）

### 1.1 融合算法：加权 RRF

- **RRF 理由**：trigram FTS 的窗口计数与向量余弦相似度**量纲不可比**，RRF 只用名次排序、无需跨量纲标定（与笔记侧 `rrfFusion` 同思路）。〔plan-3 §6 D6〕
- 融合公式：`score = FTS_WEIGHT/(RRF_K + ftsRank) + VEC_WEIGHT/(RRF_K + vecRank)`。〔plan-3 §6 D6〕

### 1.2 常量（7 个，全部无实测数据、待校准）〔plan-3 §6 D6〕

| 常量 | 值 | 语义 |
|---|---|---|
| `MEMORY_SEARCH_RRF_K` | 60 | RRF 平滑常量 |
| `MEMORY_SEARCH_FTS_WEIGHT` | 1 | FTS 通道权重 |
| `MEMORY_SEARCH_VEC_WEIGHT` | 1 | 向量通道权重 |
| `MEMORY_SEARCH_VEC_SCORE_THRESHOLD` | 0.2 | 向量相似度准入下限 |
| `MEMORY_SEARCH_CANDIDATE_MULTIPLIER` | 4 | 候选放大倍数（`limit × 4`） |
| `MEMORY_SEARCH_DEFAULT_LIMIT` | 20 | 缺省返回条数 |
| `MEMORY_SEARCH_MAX_LIMIT` | 100 | 返回条数上限 |

### 1.3 分流与过滤口径〔plan-3 §6 D6/D6.1〕

- **有 `queryVector`** → FTS5 + 向量双通道 RRF；**无向量 / sqlite-vec 缺失 / 向量列未迁移 / 全 NULL** → **只走 D5 的 trigram FTS5，不报错不抛**（未配置 embedding 的降级行为可预期）。
- 两条通道**都带 `user_id = ?` 与 `valid_to IS NULL`**（隔离与 active 过滤恒在 SQL 内）。
- **`merge_skip` 不参与过滤**：该标记只禁自动合并，被否的是合并动作不是记忆本身；过滤会让有效记忆从召回消失。
- **不按 `embedding_model` 过滤**：切换模型靠回填按 `embedding_model IS NOT ?` 重算，查询侧过滤会让切换瞬间召回归零。
- **相似度 = `1 − distance`**（真库实测 `vec_distance_cosine` = 1 − cos）；**笔记侧为 `1 − distance/2`，两边口径不同**（笔记侧按红线不动）。
- 与笔记检索完全隔离：不进 `filterKbEgressResults`、不复用笔记 `threshold`/`topK`，拒答 0.6 / 置顶 ×1.5 / searchMode 三模式零影响（红线见 req-3 §五 3）。〔req-3 §二 D6〕
- 语义路径返回的 `total` = DAO 内部 top-N 条数（与既有「过滤后总数」口径略有差异，测试注释已标明）。〔plan-3 §6 D6 残余风险 ③〕

### 1.4 语义通道的生产入口

`memory_read` 的 `hyde` opt-in 是 `queryVector` 的**唯一生产入口**（参数三与触发、降级与缓存契约见分册 02 §1.4；D6 首版交付后曾因无人生成查询向量而成死代码，由 D6.1/Q9 补上）；召回侧只消费 `queryVector`，不关心其来源。〔plan-3 §6 D6 残余风险 ①、D6.1〕

## 2. Skill 轨迹提炼（D3，半自动）

### 2.1 存储：纯文件系统，不建表〔plan-3 §6 D3〕

- 布局：`userData/skills/_auto/`（生效技能）+ `userData/skills/_auto/_drafts/`（草稿）；front matter `status: draft|active` + `source: auto`。
- **半自动（Q4）**：LLM 只写**草稿态**，设置页人工确认后才生效 —— 与记忆侧「AI 写入必经可见/可审核入口」同一红线（req-3 红线 2）。
- IPC 三通道 `ai:skilldraft:list` / `:approve` / `:reject`（确认 = 草稿移入 `_auto/<name>.md` 置 `status: active` 即刻生效；驳回 = 删除草稿文件），鉴权照抄 C3 四条（见分册 02 §4.1）。〔plan-3 §6 D3〕

### 2.2 三重防线（草稿绝不生效）〔plan-3 §6 D3〕

1. `_drafts/` 子目录不参与技能扫描（`skillLoader` 只读 `_auto/` 自身 `.md`，不递归）；
2. `_auto/` 内加载时必须 `status: active`（`skillLoader` 过滤 `status !== 'draft'`）；
3. **任意位置 `status: draft` 一律不加载** —— 未确认草稿不进 `ctx.skills` / `list_skills` / `runSkill` / 任何 prompt。

- **双闸**：`AUTO_SKILL_NAME_RE = /^auto_[a-z0-9_]{1,60}$/` + `isPathInside` 前缀校验（防目录穿越），路径推导只认两闸全过的目标。〔plan-3 §6 D3〕
- 防线 1（目录排除）与防线 2（status 过滤）互为独立冗余，回归用例须保留跨层组合覆盖（单层用例发现不了组合缺口）。〔plan-3 §6 D3 残余风险 ③〕

### 2.3 轨迹源与分页〔plan-3 §6 D3〕

- **轨迹源 = `ai_messages`**（含 `tool_calls` 快照，可还原有序 user/assistant/tool）；**不建表、不走 `agent_run_events`**（chunk 噪声）。
- 分页 = `getConversationMessagesPage` 走隐式 **rowid 数字游标**（`ai_messages.id` 是 TEXT 主键）：`WHERE conversation_id = ? AND user_id = ? AND rowid < ?`；**`getRecentMessagesByRounds` 及调用点零改动**。
- 成败筛选 = `hasCompletedAgentTask` 联查 `agent_task_queue`，权威成功终态枚举值是 **`completed`**（`pending/running/completed/failed/cancelled/superseded`；初稿误写 `done` 已修正）。

### 2.4 提炼任务契约〔plan-3 §6 D3〕

- 队列类型 `skill_distill`；`maybeEnqueueSkillDistillation` **同步返回、绝不抛、不在此调 LLM**（节流 + pending 去重；同会话任意 pending 即跳过 —— 提炼给 `memory_extract` 让位，规避队列 supersede 互相顶掉）。
- `runSkillDistillJob` **永不 reject**，失败 `console.error` + `done('failed')` **不重试**；`parseSkillDrafts` 严格校验（name 正则 / description 1~200 / instructions 1~4000 / 条数 ≤ 3，**任一项不合法整批抛错零落盘**，超限整批拒绝不截断）；**只写草稿目录**。
- 常量（均无实测数据、待校准）：`SKILL_DISTILL_MIN_ROUND_GAP = 4`、`SKILL_DISTILL_TIMEOUT_MS = 60000`、`SKILL_DISTILL_TRAJECTORY_LIMIT = 60`（轨迹条数）、`SKILL_DISTILL_TRAJECTORY_MAX_CHARS = 6000`、`MAX_SKILL_DRAFTS_PER_RUN = 3`。
- **必修 3 处无参 `loadSkills()`**（`agentContext.ts:485`、`skillManager.ts:24/35/48`，改传 `getDefaultSkillDirs()`）—— 不修则 `runSkill`/`list_skills` 调不到 `_auto` 技能，提炼等于白做（Q5 裁定见 req-3 §六）；内置 3 个 core skill 行为零改动，同名冲突 `console.warn` 跳过（内置优先）。〔plan-3 §6 D3〕

## 3. 经验注入（D4）

### 3.1 注入通道与位置

- `buildAgentSystemPrompt` **第 7 参** / `buildChatSystemPrompt` **第 3 参**，经验块插**画像块之后、`## 工作流` 之前**（chat 侧 → 注意力锚点前，锚点仍居末）；`agentContext` 读一次两分支各传一次，全仓唯一调用点对。〔plan-3 §6 D4〕
- 缺省参数：不传时输出与改动前逐字一致；未命中或无经验 → 空串，**零占位噪音**。完整块序、三块统一截断与组装契约见 [agent-prompt-context.md](../agent-prompt-context.md) §2/§3，本文不重复。

### 3.2 门控：5 意图白名单，`chat` 一律不注入〔plan-3 §6 D4〕

- `EXPERIENCE_INTENTS = ['rewrite', 'kbQa', 'tech', 'web', 'create']`（定义在 `agentPromptBuilder.ts`，**唯一口径**，注入侧与技能侧三方共用）。
- `chat` 不在白名单：它是 `intentRouter` 的无规则 fallback（`scores.size===0` 即落 chat），**无法区分「闲聊」与「未知任务类型」**，故一律不注入绕开歧义 —— 生产上 `buildChatSystemPrompt` 第 3 参恒收 `''`（待 intentRouter 能区分后即生效，记 TODO）。
- 白名单拦截、显式命中不回落推断、老技能推断匹配与排序、front matter `intents` 解析/校验契约 → 见 [agent-prompt-context.md](../agent-prompt-context.md) §4，本文不重复。

### 3.3 Token 预算〔plan-3 §6 D4〕

- `EXPERIENCE_TOKEN_LIMIT = 2000`（`agentPromptBuilder.ts`），超限走 `truncateBlockWithMarker` 截断 + 块尾标注；与三文件块/画像块同一 2000 刻度，三层个性化块合计 ≤ 6000 token（≈ 9.4% 窗口）。
- 取值按 `CONTEXT_WINDOW = 64000` 实测调优（典型提炼技能 ≈ 188 token、单条极限 4000 字 ≈ 2521 token），**非照抄外部资料**（红线见 req-3 §五 7）；单次会话匹配条数分布无线上数据 —— **[待校准]**，超限统一走截断 + 标注。

### 3.4 经验载体 = `_auto/*.md` 生效技能

经验存储**不复用 `agent_memory`**（表无顺序列，分组键 `kind+subject`，有序流程会被 `mergeConflicts` 合并破坏 —— 裁定见 req-3 §七）；载体 = D3 的 `_auto/<name>.md` 生效技能正文（instructions markdown 步骤天然有序），与 D6 向量库无关。〔plan-3 §6 D4、req-3 §七〕

## 4. 已知边界

- 单次会话匹配到的技能条数分布、经验块叠加体量无线上实测数据（`EXPERIENCE_TOKEN_LIMIT` 标待校准）。〔plan-3 §6 D4 残余风险〕
- `approveDraftSkill` 对全非法 `intents` 返回 `parse_error` 且提示不具体（草稿不合法不让生效，错误文案可细化，记 TODO）。〔plan-3 §6 D4 裁定 4〕
- 内置 3 个 core skill 也参与推断注入（约 +75 token，量级可忽略；排除需扩 `CoreSkill.source` 字段 = 超范围）。〔plan-3 §6 D4 裁定 2〕
- `agentPromptBuilder` 工具提示词未为 `memory_read` 追加 hyde 引导，目前仅靠工具 schema 的 `description` 传达（记 TODO）。〔plan-3 §6 D6.1 残余风险 ①〕
- HyDE 缓存与 `searchKB` 共享 → `cacheMonitor` 的 hyde 命中统计口径含 `memory_read` 调用。〔plan-3 §6 D6.1 残余风险 ②〕
- 草稿不按 `user_id` 分目录（纯文件系统选型固有结果，单机桌面可接受，IPC 已按 C3 鉴权，记 TODO）。〔plan-3 §6 D3 残余风险 ②〕
