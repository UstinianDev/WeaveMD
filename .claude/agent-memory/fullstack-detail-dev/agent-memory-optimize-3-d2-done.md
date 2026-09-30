---
name: agent-memory-optimize-3-d2-done
description: D2 遗忘/过期机制已实现未提交——访问计数写回形态、runMemoryPolicy 返回形状约束、fake 引擎兼容清单、Electron smoke 挂起坑
metadata:
  type: project
---

agent-memory-optimize-3 的 D2（方向 五.4 遗忘/过期机制）已实现并通过门禁，**未 git add/commit/push**（与 D1 并行，工作区同时含 D1 的 kbSearch/toolTypes/searchKBHandler/docs 改动）。

**Why:** 三处红线/约束决定了实现形态，后续批次（D5 六.3 防膨胀要复用本批触发时机与 `queryActiveMemories`）必须沿用同一口径，否则会破坏既有断言。

**How to apply:**

1. **`runMemoryPolicy` 返回形状必须保持 `{ evicted, merged }`** —— `tests/main/ai/memoryPolicy.test.ts` 既有3 例用 `toEqual` 精确锁对象。容量上限关闭数因此**折进 `evicted`**，未单开字段。新增字段前先 grep `toEqual({ evicted`。
2. **`AgentMemoryRow` 不带 `accessCount`/`lastReadAt`** —— `tests/main/db/agentMemoryDao.test.ts:304` 对整行 `toEqual`，加字段必红。容量排序改走 `listActiveMemoryAccess()` 窄投影。
3. **访问计数用「读出值 + 1」绝对值写回，不用 `access_count = access_count + 1`** —— 三个 fake 引擎（memoryPolicy/memoryTools/memoryWriter/agentMemoryDao）的 UPDATE SET 只接受 `col = ?`；`memoryHandlers.test.ts` 的 fake 原本**只支持 SELECT/DELETE**，已在该文件补了 `runUpdate` 分支（只加语句能力、零断言改动）。
4. **策略扫描一律走 `queryActiveMemories` / `listActiveMemoryAccess`（不计访问）**，只有 `listActiveMemories` / `getActiveProfile` / `getRecentEntities` / `getActiveTopics` 计数；`listMemories`（C3 列表）不计数。
5. **`addAgentMemoryAccessColumns` 是独立新函数**，`addAgentMemoryTables` 本体一行未改；`db/index.ts` diff = 22 insertions / 0 deletions（migrations.test.ts 有 anti-drift 断言守着）。
6. **`npx electron scripts/*.cjs` 若在模块顶层抛错会挂起不退出**（脚本的 try/catch 在 `main()` 之外）。做「revert → RED」时先 `cp` 备份到 `/tmp`，且**必须单独一条命令确认已恢复**——曾因 TaskStop 把 shell 杀掉而丢了 `db/index.ts` 的改动，靠 `/tmp/tmp.*` 备份找回。
7. **vitest 对不存在的命名导出不报收集错误**，只在调用处抛 `TypeError: xxx is not a function` —— 可直接当 RED 用，不必先造 stub。
8. 既知 flaky 两条在全量跑时轮流红：`ab-test` djb2 与 `cacheMonitor` getStats，**单跑复核即可**（本次各复核 1 次全绿）。`npm run test` 在有红时**不出覆盖报告**，要看覆盖得先保证绿。
