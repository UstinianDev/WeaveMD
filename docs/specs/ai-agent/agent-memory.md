# Agent 自动记忆系统规范（Agent Memory）

> 规范编号：SPEC-AGENT-MEM | 版本：v1.0（索引页 + 3 分册）| 更新：2026-10-01
> 关联需求：[agent-memory-optimize-2.req.md](../../requirements/agent-memory/agent-memory-optimize-2.req.md)（Q1~Q15 裁定与红线）、[agent-memory-optimize-3.req.md](../../requirements/agent-memory/agent-memory-optimize-3.req.md)（Q1~Q9 裁定与红线）
> 关联文档：[modules/11-AI代理面板-Agent.md](../../modules/11-AI代理面板-Agent.md)、[architecture/database.md](../../architecture/database.md)、[agent-prompt-context.md](./agent-prompt-context.md)

**分册（渐进式披露，按需加载）：**

| 文档 | 内容 |
|------|------|
| [agent-memory/01-storage-and-policy.md](./agent-memory/01-storage-and-policy.md) | 存储与策略：`agent_memory` 表结构与列演进、追加式迁移序列、DAO 写入契约、Policy（合并/驱逐/容量）与相似合并防线 |
| [agent-memory/02-tools-and-background.md](./agent-memory/02-tools-and-background.md) | 读写工具与后台提取：`memory_read`/`memory_write` 契约、memoryWriter 提取任务、IPC 安全口径与可见入口、向量写入接线 |
| [agent-memory/03-recall-and-injection.md](./agent-memory/03-recall-and-injection.md) | 召回与经验注入：加权 RRF 混合召回与分流、语义通道生产入口、Skill 轨迹提炼、经验块注入门控 |

> 本文档为 SPEC-AGENT-MEM **索引页**：保留 §1 概述、§2 数据模型总览、§3 关联文档，实现级行为契约按主题拆为分册。
> **与需求文档的分工**：req 管 Q 裁定与红线（为什么这样定），本规范管实现级行为契约（代码必须遵守什么）；同一事实两边只留一处，本文与分册用「裁定见 req Qx / 红线见 req §五」交叉引用，不复述裁定理由。
> **来源标记**（如〔plan-2 §6 B1〕）指提炼出处 `docs/plan/agent-memory-optimize-2.plan.md` / `agent-memory-optimize-3.plan.md` 的 §6 实施记录；plan 目录后续移除，门禁与变异等过程证据存 `docs/testing/agent-memory/agent-memory-optimize-{2,3}.tdd.md`。

## 1. 概述

自动记忆系统 = 单表事实存储 `agent_memory` + Agent 读写两工具 + 后台异步提取 + 策略层（合并/驱逐/容量）+ 混合召回 + Skill 轨迹提炼与经验注入，横跨 memory-2（第二批）与 memory-3（第三批）两批交付。

- **记忆分区**：`kind ∈ profile | fact | entity`，`source ∈ auto | manual`；Agent 侧写入一律 `source='auto'`（LLM 传入的 source 被忽略）。〔plan-2 §6 B1/C1〕
- **摘要层不属于本系统**：会话摘要继续复用 `ai_conversations.summary`，不进 `agent_memory`（选型裁定见 req-2 Q6）。〔req-2 §二 B1〕
- **铁律边界**：记忆/经验写入不经逐条确认（铁律一仅约束笔记写入），但必须有可见可删/可审核入口 —— 设置页「自动记忆」栏（列表 + 单条删除 + 相似合并建议三态）、Skill 草稿人工确认。〔req-2 红线 2、req-3 红线 2；入口实现见分册 02 §4、分册 03 §3〕
- **Ledger 语义**：自动清洗（合并/驱逐/容量）只置 `valid_to` 关闭不删行；用户在设置页显式单条删除 = 物理 `DELETE`（意图优先，且「删除后新会话不再注入」要求确定性）。〔plan-2 §6 B1/C3〕
- **不纳入范围**：摘要层与 `memory.md` 存储侧的过期、`agentToolPolicy` 接线（req-2 Q8）、记忆编辑（req-2 Q11 为只读 + 删除）。〔req-2 §四、req-3 §四〕

## 2. 数据模型总览

### 2.1 `agent_memory` 单表（Q6=B，DDL 冻结见 req-2 §二 B1）

11 列原始 DDL 随批次幂等补列，**列演进 11 → 13（D2 访问列）→ 14（D5 `merge_skip`）→ 16（D6 向量列）**〔plan-3 §6 D6 实测修正〕：

| 列 | 语义 | 引入 |
|---|---|---|
| `id` `user_id` `kind` `subject` `content` | 自增主键；用户隔离恒在 SQL 内；三分类；主题与正文 | 原始 11 列 |
| `source` | 默认 `auto`；`manual` 恒赢且免一切自动清洗 | 原始 11 列 |
| `conversation_id` `fingerprint` | 溯源会话；归一化 content 的 sha256（去重短路依据） | 原始 11 列 |
| `valid_from` `valid_to` | 双时间，`valid_to` NULL = 当前有效；置值 = Ledger 关闭 | 原始 11 列 |
| `written_at` | 系统写入时间；**不加 `created_at`**（`ai_messages.created_at` 秒/毫秒双格式并存，字典序不可靠） | 原始 11 列 |
| `access_count` `last_read_at` | 访问计数与最近读取（遗忘/LRU 依据） | D2 |
| `merge_skip` | 相似合并建议驳回标记（行级粘性，TEXT） | D5 |
| `vector` `embedding_model` | 向量 BLOB + 模型名（语义召回） | D6 |

- **索引**：4 个普通索引 —— `(user_id,kind,valid_to)` / `(user_id,subject)` / `(user_id,fingerprint)` + `(user_id,written_at)`（第 4 个随 D2 新增）；**不建向量索引**（排序键是 `vec_distance_cosine` 标量函数结果，B-Tree 用不上）。〔plan-2 §6 B3、plan-3 §6 D2/D6〕
- **FTS**：`agent_memory_fts`（fts5，`tokenize='trigram'`）只索引 `subject`+`content`，配 `ai/ad/au` 三触发器；第二批「不建 FTS」的原判已在 D5 改判。〔plan-3 §6 D5〕
- 字段命名 camelCase（行对象 `validTo` ↔ 列 `valid_to`），对齐既有 `AiConfigRow` 范式。〔plan-2 §6 B1 裁定 1〕

### 2.2 追加式迁移序列（`runMigrations` 内按序调用，共 5 个独立函数）

| # | 函数 | 增量 | 来源 |
|---|---|---|---|
| 1 | `addAgentMemoryTables` | 建表（11 列）+ 3 索引 | plan-2 §6 B3 |
| 2 | `addAgentMemoryAccessColumns` | `access_count`/`last_read_at` + `written_at` 索引 | plan-3 §6 D2 |
| 3 | `addAgentMemoryFts` | FTS 虚拟表 + 3 触发器 + 存量回填 | plan-3 §6 D5 |
| 4 | `addAgentMemoryVectorColumns` | `vector`/`embedding_model` | plan-3 §6 D6 |
| 5 | `addAgentMemoryMergeSkipColumn` | `merge_skip` | plan-3 §6 D5 |

硬约束：**迁移本体一律不许改** —— 新能力 = 新建独立函数 + `runMigrations` 内一行调用；不 DROP/DELETE/UPDATE，历史迁移零改动行，双路径（空库首建 / 上一版本升级）可重复执行（红线见 req-2 §五 4）。〔plan-2 §6 B3、plan-3 §6 D2/D6〕实现细节见分册 01 §2。

## 3. 关联文档

- **需求与裁定**：`docs/requirements/agent-memory/agent-memory-optimize-2.req.md`、`docs/requirements/agent-memory/agent-memory-optimize-3.req.md` —— Q 表、红线、事实核验以 req 为准，本规范不复述。
- **Prompt 组装**：`docs/specs/ai-agent/agent-prompt-context.md` —— 三文件块/画像块注入管线、front matter `intents` 解析契约。
- **架构与模块**：`docs/modules/11-AI代理面板-Agent.md`（面板与工具）、`docs/architecture/database.md`（表结构与 DAO）、`docs/architecture/ai-agent.md`（工具注册表）。
- **验证证据（过程记录）**：`docs/testing/agent-memory/agent-memory-optimize-2.tdd.md`、`docs/testing/agent-memory/agent-memory-optimize-3.tdd.md` —— 门禁、变异与覆盖率记录在彼处，不进本规范。
