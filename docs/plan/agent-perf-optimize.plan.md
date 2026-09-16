# agent-perf-optimize — 实施计划

> 创建：2026-09-16 | 来源：[需求文档](../requirements/agent-perf-optimize.req.md) | 定档：L

---

## 1. 变更清单

### 1.1 新建文件

| 文件 | 用途 |
|------|------|
| `src/main/ai/agent/StreamingToolExecutor.ts` | S1 — 流式推测执行器，状态机 + 流式工具调度 |
| `src/main/ai/agent/concurrencyDefs.ts` | S2 — isConcurrencySafe 定义表（24 工具全量注册，阶段 1 覆盖 TOP10） |
| `src/shared/utils/hashUtil.ts` | S4 — 统一 xxHash 封装（主进程 + 渲染进程共用） |
| `tests/main/ai/streamingToolExecutor.test.ts` | S1 — StreamingToolExecutor 单元测试 |
| `tests/main/ai/concurrencyDefs.test.ts` | S2 — isConcurrencySafe 覆盖度 + 回归测试 |
| `tests/main/ai/searchCache.test.ts` | S3 — searchCache 新缓存键 + 分级失效测试 |

### 1.2 修改文件

| 文件 | 关联需求 | 变更级别 |
|------|----------|----------|
| `src/main/ai/agent/agentLoop.ts` | S1 | 中：集成 StreamingToolExecutor，编译时常量开关 |
| `src/main/ai/agent/agentToolExecutor.ts` | S1, S2 | 大：分区逻辑迁入 StreamingToolExecutor，保留单工具执行函数 |
| `src/main/ai/agent/agentToolSelector.ts` | S2 | 小：导入 concurrencyDefs，暴露 `isToolConcurrencySafe()` |
| `src/main/ai/knowledge/searchCache.ts` | S3 | 中：`getSearchCacheKey` 加 `searchMode`；`invalidateKbSearchCache` 支持 chunk_id 分级 |
| `src/main/ai/tools/editBlocksHandler.ts` | S4 | 小：`createHash('md5')` → `xxHash` |
| `src/main/ai/tools/previewFileRevision.ts` | S4 | 小：`createHash('md5')` → `xxHash` |
| `src/main/ai/tools/previewPatchFilesHandler.ts` | S4 | 小：`createHash('md5')` → `xxHash` |
| `src/render/stores/rewriteStore.ts` | S4 | 小：`simpleHash` (djb2) → `xxHash` |
| `src/render/components/AIAgent/cards/DiffSummaryCard.tsx` | S4 | 小：`simpleHash` → `xxHash` |
| `tests/main/ai/ipc.test.ts` | F1 | 小：修复 vitest mock hoisting |
| `tests/main/ai/agentLoop.test.ts` | S1 | 小：适配 StreamingToolExecutor token 数 + 工具调用时序变化 |

### 1.3 依赖变更

| 包 | 版本 | 用途 |
|----|------|------|
| `xxhash-wasm` | ^1.0.2 | S4 — 跨平台 xxHash64 WASM 实现 (~10KB) |

---

## 2. 阶段 1 详细方案

### 2.1 S1 — 流式推测执行（StreamingToolExecutor）

**现状**: `agentLoop.ts:187-222` 的 for-await 循环逐 chunk 接收流式响应，工具调用全部累积后才执行。

**架构**: 状态机 `queued → executing → completed → yielded`，核心 API：
- `onToolCall(tc, assistantMessage)` — 流中注册新工具调用
- `getCompletedResults()` — Generator 顺序产出已完成结果
- `getRemainingResults()` — AsyncGenerator 等待未完成工具
- `abortAll(reason)` — 级联取消

**集成**: `agentLoop.ts` 加编译时常量 `USE_STREAMING_EXEC = true` 控制新旧路径切换。

**风险缓解**: 保留原始 `executeToolRound` 为兜底路径；常量 `false` 时与当前行为完全一致。

### 2.2 S2 — 并发判断精细化

**现状**: 静态 `READ_ONLY_TOOLS`(16) / `WRITE_TOOLS`(7) 二分。

**方案**: `concurrencyDefs.ts` 定义全量 24 工具并发安全表。阶段 1 覆盖 TOP10 高频工具，其余默认 `false`（fail-closed）。

**TOP10 高频工具**: listFiles, readFile, searchKB, editBlocks, list_skills, get_skill_details, analyze_folder, check_links, get_task_activity, readLocalFile — 全部标记为并发安全（只读或 proposal-only）。

### 2.3 S3 — 缓存键精细化

**变更**:
1. `getSearchCacheKey` 加 `searchMode` 参数
2. `invalidateKbSearchCache` 支持三级范围：`all` / `user` / `chunk`
3. 新增 `chunkId → cacheKey` 索引维护
4. `kbIndexer.ts` 调用方适配

### 2.4 S4 — MD5 → xxHash

**新建** `src/shared/utils/hashUtil.ts`：
- `xxHash64(input)` — 异步版本（WASM 懒加载）
- `xxHash64Sync(input)` — 同步版本（fallback djb2 降级）

**替换范围**: editBlocksHandler / previewFileRevision / previewPatchFilesHandler（staleness detection）+ rewriteStore / DiffSummaryCard（渲染进程哈希统一）

**不动**: agentLoopGuard.ts MD5（死循环检测，数据量小，风险 > 收益）

### 2.5 F1 — 修复 ipc.test.ts

修复 vitest mock hoisting 问题（`vi.mock` + `vi.hoisted` 顺序冲突）。

---

## 3. 阶段 2-4 概要

### 阶段 2：架构级优化
- **S5** 工具延迟加载：CORE_TOOLS 从模块级常量 → 工厂函数返回
- **S6** 大结果持久化：单工具 50K 字符 / 单轮 200K 字符阈值
- **S7** Prompt 前缀稳定性：6 层分层（静态 → 动态）
- **S8** 上下文压缩复用缓存

### 阶段 3：知识库优化
- **S9** HyDE 结果缓存
- **S10** Embedding 缓存
- **S11** 预加载策略优化（模糊匹配）
- **S12** 查询理解增强

### 阶段 4：监控与验证
- **S13** 性能基准套件
- **S14** A/B 测试框架
- **S15** 缓存命中率监控
- **S16** 成本追踪

---

## 4. 实施顺序

```
Day 1-2: F1 (test fix) → S4 (xxHash) → S3 (searchCache)
Day 3-5: S2 (concurrencyDefs) → S1 (StreamingToolExecutor)
Day 6:   验收（tsc + vitest + 手工 A/B 对比）
```

S1-S4 依赖关系：S4 独立，S3 独立，S2 是 S1 的依赖，S1 是最复杂的集成项。

---

## 5. 验收标准

| 指标 | 测量方式 | 目标 |
|------|----------|------|
| 端到端耗时 | `performance.now()` 打点 | 典型任务缩短 15-30% |
| 首个工具调用时机 | PERF 打点 | 流式推测执行：不晚于流结束前 |
| 类型检查 | `npx tsc --noEmit` | 0 errors |
| 单元测试 | `npx vitest run` | 全部通过 |
| 手工回归 | 简单对话/工具调用/多轮对话/KB检索/写控制确认 | 无回归 |

---

## 6. 风险矩阵

| 风险 | 影响 | 概率 | 缓解 |
|------|------|------|------|
| StreamingToolExecutor 状态机 bug | 高 | 中 | 编译时常量开关 + 兜底路径 + 单元测试 |
| 并发安全误判导致竞态 | 高 | 低 | TOP10 严格审查 + fail-closed 默认 |
| xxHash WASM 渲染进程加载失败 | 中 | 低 | fallback djb2 降级 |
| 缓存键变更短期命中率下降 | 低 | 高 | 旧缓存 TTL 自然过期（3 分钟） |
| chunk_id 索引内存增长 | 低 | 低 | LRU 淘汰联动索引清理 |