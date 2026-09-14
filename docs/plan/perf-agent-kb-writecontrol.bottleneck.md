# perf-agent-kb-writecontrol — 瓶颈扫描报告

> 扫描时间：2026-09-15 | 范围：Agent / KB 搜索 / 写控制 | 3 模块 × 3 智能体并行扫描

## 优化候选（按优先级排列）

### ✅ P0 — 实施

| # | 模块 | 文件 | 问题 | 严重度 | 预期提升 |
|---|------|------|------|--------|----------|
| 1 | Agent+写控制 | `agentCheckpoint.ts:59-89` | "增量保存"实为每轮全量读+写(O(r²)) | 🔴高 | 12轮长对话省~70% checkpoint 开销 |
| 2 | 写控制 | `agentStore.ts` 8处 | `await import('fileTreeStore')`动态加载(fileTreeStore无循环依赖) | 🟡中 | 消除每次工具事件 1-3ms 异步延迟 |
| 3 | Agent | `agentLoop.ts:993-1007` | 压缩后死代码(oldMessageCount 恒>压缩后长度导致 slice 返回空数组) | 🟡中 | 消除一次无效 reduce |
| 4 | Agent | `agentEventStore.ts:96,126` | 事件批量刷新做 JSON.stringify→parse 往返 | 🟡中 | 每批次省 1-2ms |

### ⚠️ P1 — 低风险可选

| # | 模块 | 文件 | 问题 | 严重度 | 预期提升 |
|---|------|------|------|--------|----------|
| 5 | KB | `searchCache.ts:92-101` | `invalidateKbSearchCache(userId)` 忽略 userId 清空全部用户缓存 | 🟡中 | 多用户缓存命中率+80% |
| 6 | KB | `knowledgeContext.ts:301-323` | `getDocument()` 循环中逐文档 DB 查询(可合并为 WHERE id IN) | 🟡中 | DB 延迟降 5-10x |

### ❌ 跳过

| # | 模块 | 原因 |
|---|------|------|
| 7 | KB | `embeddingClient.ts` 图片 embedding 串行→并发 — 改变并发行为，风险高于收益 |
| 8 | KB | `kbIndexer.ts` 向量逐条 UPDATE — 影响<15%，需改事务逻辑 |
| 9 | Agent | `agentLoop.ts` 拆分 1166 行 — 逻辑紧耦合，风险高且无直接性能收益 |
| 10 | Agent | `estimateTokens` 换 LRU 缓存 — 收益 <0.1ms/次，几乎为0 |
| 11 | 写控制 | agentStore onTool 链式判断优化 — 收益 <0.5ms |

## 模块拆分分析

| 模块 | 行数 | 拆分建议 |
|------|------|----------|
| `agentLoop.ts` | 1166 | **不拆** — prepareAgentContext/executeToolRound/runAgentFlow 紧耦合 |
| `agentStore.ts` | 1586 | **不拆** — Zustand store 天性大文件，拆分增加跨 store 协调复杂度 |
| `kbSearch.ts` | 901 | **不拆** — FTS5 查询+结果排序+BM25 评分在同一数据流上紧密协作 |
| `agentTaskWorker.ts` | 465 | **不拆** — 已由 processTask 分解为 4 个子方法 |