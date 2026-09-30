---
name: agent-memory-optimize-3-d5-done
description: D5 防膨胀三防线已交付（FTS5 trigram 跨 subject 合并 + 三态审核 IPC/UI + 复用 D2 触发），含 fts5 'delete' 命令实测坑与门禁数字
metadata:
  type: project
---

agent-memory-optimize-3 **D5（六.3 防膨胀三防线）已交付，未提交**（Gate E 最后一项）。

**Why:** 总指挥裁定防线一走 FTS5 关键词重合度（不引 embedding），防线二扩 C3 三通道，防线三完全复用 D2 的三处触发、不新建定时器。

**How to apply:** 后续接 Gate E 收口或 Gate F（D6 三.3 向量库）时直接读本条，不必重新核查基线。

## 交付要点
- `db/index.ts` 新增 `addAgentMemoryFts`（fts5 虚拟表只索引 subject+content、`tokenize='trigram'`、ai/ad/au 三触发器 + 存量回填）与 `addAgentMemoryMergeSkipColumn`（`merge_skip TEXT`），`runMigrations` 各插一行；**该文件 diff 恒为 116/0 纯新增**，`addAgentMemoryTables`/`addAgentMemoryAccessColumns` 本体零改动。
- `db/agentMemory.ts` 新增 `memoryTextTrigrams` / `querySimilarMemoryCandidates` / `listMergeSkipFlags` / `markMergeSkipped`（**计划外 src/ 改动，因 memoryPolicy 头注禁写 SQL**）。
- `memoryPolicy.ts` 新增 `memorySimilarityScore`（trigram Jaccard）、`findSimilarMergeGroups`、`mergeSimilarMemories`、`mergeMemoryGroup`、`rejectMemoryGroup`；`runMemoryPolicy` = merge(同 subject) → merge(跨 subject) → evict → capacity，**返回仍是 `{evicted, merged}`**。
- 三态审核：`ai:memory:similar:{list,accept,reject}` 挂在既有 `registerMemoryHandlers` 内（鉴权四条逐条照抄），preload/weaveMDBridge/agentStore/`AgentPersonalityPanel` 的 autoMemory tab 各加一块。

## 关键坑（实测，SQLite 3.49.2 / 项目锁定 better-sqlite3）
1. **fts5 特殊命令 `INSERT INTO t(t,rowid,a,b) VALUES('delete',...)` 在普通（非 contentless）表上必报 `SQL logic error`** —— 只有 contentless / external content 表接受；普通表用 `DELETE FROM t WHERE rowid = old.rowid`。
   **`kb_chunks_fts_ad` 与 `kb_documents_fts_ad/au` 仍用该坏命令 → 疑似长期失效，D5 未改（超范围），建议另开任务核查。**
2. `tokenize='unicode61'` 把整段连续汉字并成**一个 token**（实测 `用户偏好深色主题` 只产出 1 词）→ 中文相似度检索不可用；`trigram` 可用但**大小写敏感**（查询侧需同时提交原文与小写两套词）。
3. FTS/迁移类断言别用 `/DELETE\s+FROM/i` 这种全禁正则（触发器里的同步 DELETE 会误伤），要限定 `agent_memory\b`。

## 门禁实测（2026-09-30）
- typecheck exit 0 / vitest **183 文件 4418 例全绿** / eslint **0 errors, 108 warnings（=基线）** / vite build exit 0 / **真库 smoke 六态 EXIT=0**。
- 变异 10 处逐个变红后还原复绿；改动行覆盖（vs HEAD，含 D1~D4）**1239/1329 = 93.2%**。
- 既知 flaky `ab-test djb2` 在一次覆盖率运行中红，单跑 `22 passed (22)`，被测代码零改动。

相关：[[agent-memory-optimize-3-d4-done]] [[weavemd-test-env-pitfalls]]
