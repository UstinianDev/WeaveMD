# Agent 自动记忆 — 存储与策略（SPEC-AGENT-MEM 分册 1/3）

> 规范编号：SPEC-AGENT-MEM-01 | 更新：2026-10-01
> 承载 [agent-memory.md](../agent-memory.md) 的存储与策略实现级行为契约（表结构、迁移、DAO、Policy）；返回索引：[agent-memory.md](../agent-memory.md)
> 关联需求：[agent-memory-optimize-2.req.md](../../../requirements/agent-memory/agent-memory-optimize-2.req.md)（Q6/Q10、红线 4）、[agent-memory-optimize-3.req.md](../../../requirements/agent-memory/agent-memory-optimize-3.req.md)（Q6/Q8、红线 4）
> 来源标记：〔plan-2〕= `docs/plan/agent-memory-optimize-2.plan.md` §6、〔plan-3〕= `agent-memory-optimize-3.plan.md` §6；过程证据见 `docs/testing/agent-memory/agent-memory-optimize-{2,3}.tdd.md`
> 溯源声明：来源标注中的 `docs/plan/*` 为过程计划文档，已随计划退役（历史见 git），仅留溯源线索。

---

## 1. 表结构与列演进

### 1.1 原始 DDL（11 列，req-2 §二 B1 冻结，实施期不得偏离）

```sql
CREATE TABLE IF NOT EXISTS agent_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,            -- 'profile' | 'fact' | 'entity'
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'auto',   -- 'auto'(Agent 写) | 'manual'(用户手写)
  conversation_id TEXT,
  fingerprint TEXT NOT NULL,     -- content 归一化 hash，去重短路依据
  valid_from TEXT NOT NULL DEFAULT (datetime('now')),
  valid_to TEXT,                 -- NULL = 当前有效；置值 = Ledger 关闭（不删行）
  written_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- + 3 个索引：(user_id,kind,valid_to) / (user_id,subject) / (user_id,fingerprint)
```

〔plan-2 §6 B3〕要点：

- **双时间**：`valid_from`/`valid_to` 为业务有效时间（NULL = 当前有效），`written_at` 为系统写入时间；「近 N 天」与「超龄驱逐」统一按 `written_at` 的 `YYYY-MM-DD HH:MM:SS` UTC 口径解析（`memoryNowStamp()`/`parseMemoryStamp()`）。〔plan-2 §6 B2〕
- **不加 `created_at`**：核查确认 `ai_messages.created_at` 存在 `datetime('now')` 秒级默认与 `toISOString()` 毫秒双格式并存，字典序跨格式不可靠（裁定见 req-2 §二 B1）。〔req-2 §二 B1〕
- 不建 SQL VIEW、不预留未使用 JSON 列（VIEW 走 DAO 查询函数，见 §4）。〔plan-2 §6 B1〕

### 1.2 列演进 11 → 13 → 14 → 16

| 批次 | 迁移函数 | 新增列/结构 | 来源 |
|---|---|---|---|
| memory-2 B3 | `addAgentMemoryTables` | 11 列 + 3 索引 | plan-2 §6 B3 |
| memory-3 D2 | `addAgentMemoryAccessColumns` | `access_count INTEGER DEFAULT 0` + `last_read_at TEXT` + `idx_agent_memory_user_written(user_id, written_at)` | plan-3 §6 D2 |
| memory-3 D5 | `addAgentMemoryFts` | `agent_memory_fts` 虚拟表 + `ai/ad/au` 三触发器 + 存量回填（`rowid NOT IN` 守卫） | plan-3 §6 D5 |
| memory-3 D5 | `addAgentMemoryMergeSkipColumn` | `merge_skip`（相似合并驳回标记） | plan-3 §6 D5 |
| memory-3 D6 | `addAgentMemoryVectorColumns` | `vector BLOB DEFAULT NULL` + `embedding_model TEXT` | plan-3 §6 D6 |

- 最终 **16 列**；smoke 按 16 列断言（任务书早先「11→13→15」漏算 D5，实施期已修正）。〔plan-3 §6 D6 实测修正 ①〕
- **不建向量索引** `idx_agent_memory_user_vector`：排序键是 `vec_distance_cosine` 标量函数结果，B-Tree 用不上；`user_id` 前缀已有 4 个索引可收敛单用户行集，再建只增 upsert 写放大。〔plan-3 §6 D6〕

### 1.3 FTS 虚拟表（D5）

- `CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_fts USING fts5(subject, content, tokenize='trigram')` —— **只索引 `subject`+`content`**，`user_id`/`kind` 靠普通条件过滤。〔plan-3 §6 D5 防线一〕
- **`tokenize='trigram'` 选型**：`unicode61` 对中文只产出 1 词（`用户偏好深色主题` 实测 → 中文相似度检索不可用）且大小写敏感；trigram 按 3 字窗口切分中英文通用，代价是大小写敏感，查询侧同时提交原文与小写两套。〔plan-3 §6 D5〕
- 触发器用标准 `DELETE FROM <fts> WHERE rowid = old.rowid`（**非 contentless 表专用的 `'delete'` 特殊命令**）；`ai`/`au`/`ad` 三触发器同步索引。〔plan-3 §6 D5/D7〕
- 第二批「不建 FTS」的原注释保留未删，其后追加改判说明（改判理由 = 仓内无 embedding 依赖的相似度设施，关键词重合度是唯一可行起点）。〔plan-3 §6 D5〕

## 2. 迁移序列与硬约束

`runMigrations` 内按序调用 5 个独立函数（序列见主文档 §2.2）。硬约束〔plan-2 §6 B3、plan-3 §6 D2/D6〕：

1. **迁移本体一律不许改**：`addAgentMemoryTables` 及后续各函数的函数体零改动；新能力 = 新建独立函数 + `runMigrations` 内一行调用。
2. `db/index.ts` 的 diff **只能是新增函数 / 新增调用 / `addColumnIfMissing` 新列**；不 DROP/DELETE/UPDATE。
3. 补列走 `addColumnIfMissing`（PRAGMA 探测缺列后逐列 `ADD`，兼容项目锁定的 better-sqlite3 其 `ADD COLUMN IF NOT EXISTS` 报错问题），重复执行幂等。〔plan-3 §6 D2/D6〕
4. 验收 = 迁移三态断言（空库首建 / 旧库升级 / 重复执行零 DDL）+ 真库 smoke `scripts/agent-memory-migration-smoke.cjs`（运行期从 `src/main/db/index.ts` 源码正则抽取 DDL 防漂移；CRLF 文件比对须先归一化换行）；证据落 tdd 文档。〔plan-2 §6 B3〕

## 3. DAO 写入契约（`src/main/db/agentMemory.ts`）

### 3.1 `upsertMemory` 优先级（req Q10 + C2 裁定 6）〔plan-2 §6 B1、plan-3 §6 C2〕

按序判定，先命中先返回：

1. **manual 恒赢**：同 `user+kind+subject` 存在 `source='manual'` 的 active 行 → 任何写入零落库，直接返回该行 id（manual 行的变更走设置页物理删除后重写）。
2. **fingerprint 短路**：`source='auto'` 且同 `user+kind+subject+fingerprint` 存在 active 行 → 零写入返回既有行 id（取 id 最大者，兼容规则上线前遗留重复行）；优先级在 manual 闸之后。
3. **manual 首次写入**：关同指纹 auto 行（置 `valid_to`，Ledger 不删行）+ 插 manual 行 —— 不得被第 2 条短路吞掉。
4. 无重复 → 直接插。

同 subject 不同 fingerprint 的并存矛盾**不在 DAO 清洗**，由 Policy「时间新者赢」收敛（§5）。配套约束：**Agent 侧写入一律 `source='auto'`**（C1 `memory_write` 忽略 LLM 传入的 source）。〔plan-2 §6 B1 裁定 2/C1〕

### 3.2 Ledger 与关闭语义

- 自动冲突清洗/时间驱逐/容量淘汰 = 旧行置 `valid_to` + 必要时插新行，**不 UPDATE 事实内容、不 DELETE**；`closeMemory` 带 `AND valid_to IS NULL` 幂等闸（重复 close 返回 false 不覆盖时间）。〔plan-2 §6 B2 裁定 1〕
- 用户在设置页显式单条删除 = 物理 `DELETE`（带 `user_id` 条件，跨用户删除被挡住）。〔plan-2 §6 C3〕
- 字段命名 camelCase：`AgentMemoryRow.validTo` ↔ 列 `valid_to`（对齐 `AiConfigRow` 范式）。〔plan-2 §6 B1 裁定 1〕

### 3.3 访问计数（D2 遗忘机制的读侧）〔plan-3 §6 D2〕

- `markAccessed` 自增 `access_count` + 刷 `last_read_at`，**只对实际返回的行**计数。
- **计数接口**：`listActiveMemories` / `getRecentEntities` / `getActiveProfile` / `getActiveTopics`。
- **不计数接口**：`listMemories`（C3 设置页展示）、`queryActiveMemories`（策略扫描专用）—— 展示与策略扫描不得污染访问信号（红线）。

## 4. Views（DAO 查询函数，不建 SQL VIEW）

时间过滤与聚合放 **TS 侧**，SQL 只保留 `user_id = ?` / `kind = ?` / `valid_to IS NULL` 等值条件（记忆量级小 + 保持 SQL 简单参数化）。〔plan-2 §6 B2 裁定 2〕

| 函数 | 语义 | 来源 |
|---|---|---|
| `getActiveProfile(db, userId)` | 当前有效画像行 | plan-2 §6 B2 |
| `getRecentEntities(db, userId, days, now?)` | 近 N 天实体（`now - written_at <= days*86400000` 含边界；第 4 参 `now` 供测试锁边界） | plan-2 §6 B2 裁定 4 |
| `getActiveTopics(db, userId)` | 活跃话题聚合：count 降序 → `lastWrittenAt` 新者优先 → subject 升序 | plan-2 §6 B2 |

## 5. Policy（`src/main/ai/agent/memoryPolicy.ts`）

### 5.1 三策略

| 策略 | 行为契约 | 来源 |
|---|---|---|
| `evictStale` | 超 `MEMORY_EVICT_MAX_AGE_DAYS` 的非 manual active 行置 `valid_to` 关闭；**manual 永不驱逐** | plan-2 §6 B2 |
| `mergeConflicts` | 同 `kind+subject` 组内：**manual 优先 → `written_at` 新者 → 同刻 id 大者**；只关非 manual 败者（manual 败者不关闭，同组多条 manual 会并存 —— 已知问题记 TODO） | plan-2 §6 B2 裁定 5 |
| `enforceMemoryCapacity` | 超 `MAX_ACTIVE_MEMORIES` 时按 `access_count` 升序 → `written_at` 降序 → `id` 升序依次 `close`；**manual 永不因容量关闭**（manual 超上限时返回 0） | plan-3 §6 D2 |

### 5.2 编排与触发〔plan-2 §6 B2、plan-3 §6 D2/D5〕

- `runMemoryPolicy` 顺序 = **merge（同 subject）→ merge（跨 subject）→ evict → capacity**（先 merge 后 evict 的顺序理由写在源码注释，测试已锁；D5 扩编排时返回形状仍为 `{evicted, merged}`，跨 subject 计数并入 `merged`）。
- `runMemoryPolicyForAllUsers` 逐用户 try/catch + `console.warn`，**绝不抛**。
- **三处触发**：① 应用启动（`initAgentQueue` 在 `taskWorker.start()` 后）② C1 `memory_write` 成功后 ③ `memoryWriter` 后台提取成功后 —— **复用既有 1s 队列轮询，不新建定时器/队列任务类型**。

### 5.3 常量（全部无实测数据、待校准）

| 常量 | 值 | 备注 | 来源 |
|---|---|---|---|
| `MEMORY_EVICT_MAX_AGE_DAYS` | 90 | 超龄驱逐窗口（天），保守取值 | plan-2 §6 B2 |
| `MAX_ACTIVE_MEMORIES` | 500 | active 条数上限，建议按生产库 active 行数 P95 重设 | plan-3 §6 D2 |
| `MEMORY_MERGE_SIMILAR_THRESHOLD` | 0.5 | 跨 subject 语义合并阈值 | plan-3 §6 D5 |
| `MEMORY_MERGE_CANDIDATE_LIMIT` | 32 | 单行候选召回上限 | plan-3 §6 D5 |
| `MEMORY_MATCH_MAX_TERMS` | 48 | 单次 FTS 查询最多提交查询词数 | plan-3 §6 D5 |

## 6. 相似合并防线（D5）与 merge_skip

- **跨 subject 语义合并**：基于 `agent_memory_fts` trigram 关键词重合度（无 embedding 依赖），分词与打分共用同一 trigram 小写归一函数防口径漂移；同 subject 合并仍由 `mergeConflicts` 负责。〔plan-3 §6 D5 防线一〕
- **合并不删行**：败者置 `valid_to` 关闭（Ledger）；`manual` 恒免合并。〔plan-3 §6 D5〕
- **三态审核（防线二）**：`ai:memory:similar:list` / `:accept` / `:reject` 三通道挂在既有 `registerMemoryHandlers`；采纳/驳回按 ids 在服务端**重算相似组**（归属 + active + 同 kind + 连通相似度三条都过才动手）；UI 在设置页 `autoMemory` 栏内扩「相似合并建议」区。〔plan-3 §6 D5 防线二〕
- **`merge_skip` 语义**：用户驳回过的行打行级粘性标记；**只禁自动合并，不禁召回**（检索侧不按它过滤，见分册 03 §1.3）；无撤销入口（撤销须删除该记忆后重写，记 TODO）。〔plan-3 §6 D5/D6〕
- **过期复核（防线三）**：完全复用 §5.2 的三处触发，不新建 `setInterval`、不新建队列任务类型。〔plan-3 §6 D5 防线三〕
- FTS 不可用时静默降级返回空数组（生产表现为「不再自动合并」，靠 smoke + 单测兜底）。〔plan-3 §6 D5 残余风险 ②〕

## 7. 已知边界

- 策略层 SQL 语义在 vitest 下由内存 fake 引擎模拟（better-sqlite3 ABI 不可用），真库语义由迁移 smoke 覆盖；fake 只支持等值/`IS NULL`/单列 `ORDER BY LIMIT`，DAO 改用 JOIN/GROUP BY/LIKE 需同步扩 fake（会抛错暴露，非静默）。〔plan-2 §6 B1 残余风险〕
- `memoryPolicy.test.ts` 自持一份与 DAO 版本同构但非同一份的精简 fake，改 fake 语义需两处同步。〔plan-2 §6 B2 残余风险〕
