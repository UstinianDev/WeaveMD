---
name: agent-memory-optimize-3-d6-done
description: D6 向量化经验库（Gate F）交付记录——FTS5 rank 排序方向真库实测、agent_memory 列演进实为 16 列、fake 必须从 SQL 文本派生过滤否则变异测不出
metadata:
  type: project
---

# agent-memory-optimize-3 D6（三.3 向量化经验库，Gate F 唯一任务）交付

状态：**已完成、六门禁全绿、未提交**（2026-10-01）。基线 4430 例 → **4491 例**（新增 61 例 / 4 文件）。

## 关键事实（后续任务会再踩）

1. **FTS5 `ORDER BY rank` 升序 = 相关度从高到低**（已在 `scripts/agent-memory-migration-smoke.cjs` 态7
   用「10 条填充文档 + 全量命中行 + 单 trigram 命中行」探针实测：`rank ASC=[全量,单点]`、`DESC` 反向）。
   **陷阱**：库只有 3 行时 bm25 的 IDF 为负（`log((N-df+0.5)/(df+0.5))`，N=3 时 df≥2 即负），
   表观顺序会反转 —— 早期用 3 行数据断言相关度方向得出了**错误结论**。做相关度方向断言必须配填充文档。

2. **`vec_distance_cosine` = 1 - cos**：同向 0、正交 1（真库实测）。
   记忆侧 `similarity = 1 - distance`；**笔记侧 `kbSearchFts.vectorSearch` 用的是 `1 - distance/2`**
   （正交映射成 0.5 → `DEFAULT_VEC_SCORE_THRESHOLD=0.5` 实际只挡 cos<0），语义不同但**红线不许改**。

3. **`agent_memory` 列演进是 11 → 13（D2）→ 14（D5 merge_skip）→ 16（D6）**。
   任务书写「11→13→15」漏算了 D5 的 `merge_skip`；真库 smoke 态7 按 16 断言。

4. **fake DB 的过滤必须「从 SQL 文本派生」，不能在 fake 里硬编码**。
   教训：M2 变异（去掉向量通道 `valid_to IS NULL`）第一次**没被抓住**，因为 fake 的 `activeRows()`
   自己过滤了 `valid_to`。修法是在 fake 的 `all()` 里加文本守卫
   （`assertScoped` 要求 `user_id = ?`、新增守卫要求 `valid_to IS NULL`），SQL 一改立刻抛错。
   同理 FTS/向量两通道都加了形态守卫（`ORDER BY rank` 必须存在）。

5. **记忆向量的实现落在 `src/main/ai/knowledge/vectorBackfill.ts`（追加段，不新建 src 文件）**
   —— 复用既有 `resolveEmbedding` / `delay` / 分批限速范式；`writeMemoryVectorAsync` /
   `backfillMemoryVectors` / `scheduleMemoryVectorBackfill` 三个导出，**永不 reject**。
   三处触发复用 D2：`agentHandlers.initAgentQueue`（启动）+ `memoryWrite`（C1）+ `memoryWriter`（C2）。

6. **`initAgentQueue` 可以在测试里直接 import 调用**（不需要一整套 ipc.test 的 mock）——
   只要 electron 的 `{ app }` mock 存在即可；但**必须 mock `@main/ai/agent/agentTaskWorker`**，
   否则真实 `start()` 会起 1s 轮询 interval 打 fake db 并泄漏到后续用例。

7. **coverage 插桩下出现过 1 例未复现的失败**（`npx vitest run --coverage` 一次 4491 中 1 红，
   未及时抓到文件名；随后两次全量 4491/4491 绿）。判为既知两条 flaky（ab-test djb2 /
   cacheMonitor 10万次）在 coverage 慢速下的时序波动 —— 若再遇到，先抓文件名。

## 门禁与变异证据

- 六件套：tsc exit 0 / vitest **188 文件 4491 例全绿** / eslint **0 errors, 108 warnings（=基线）** /
  vite build exit 0 / agent-memory-migration-smoke **七态 EXIT=0** / fts5-smoke **EXIT=0（D7 删除态仍绿）**。
- 改动行覆盖 **316/317 = 99.7%**；唯一未覆盖是 `db/index.ts:308`
  （`runMigrations` 内的 `addAgentMemoryVectorColumns(database);` 调用行）——
  `runMigrations` 未导出、vitest 不执行，**D2/D5 的同位置调用行同样未覆盖**（既有范式），
  接线由真库 smoke 的源码正则断言 + 迁移三态测试兜底。
- 变异 6 处逐个变红后还原复绿：去 user_id（12 红）/ 去 valid_to（4 红，需先补文本守卫）/
  去向量通道 try-catch（1 红）/ C1 向量失败上抛（2 红）/ 融合去掉向量分量（2 红）/
  迁移去掉 embedding_model（4 红）。

相关：[[agent-memory-optimize-3-d5-done]]、[[agent-memory-optimize-3-d7-done]]、
[[weavemd-test-env-pitfalls]]、[[agent-memory-optimize-3-d2-done]]
