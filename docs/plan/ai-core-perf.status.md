# ai-core-perf — 执行状态

> /devflow-perf | 启动：2026-10-03 | 档位：**L**

## Phase 0 分级

| 维度 | 判定 |
|------|------|
| 类型 | 优化类 |
| 影响面 | 跨模块（agent 编排 / 记忆 / 队列 / 工具装配 / 文档解析） |
| 工时 | 多天 |
| 档位 | **L**（全阶段 + 强制调研 + 并行执行） |

扫描范围：`src/main/ai/agent/`、`src/main/ai/tools/`、`src/main/ai/files/`、`src/main/ai/toolRegistry.ts`、
`src/main/db/agentMemory.ts`、`src/main/db/agentTaskDao.ts`、`src/main/ai/utils/tokenEstimator.ts`

瓶颈报告：`docs/plan/ai-core-perf.bottleneck.md`（13 项，P0×4 / P1×5 / P2×4）

## Phase 4 基线（行为守护起点）

```
npm run test  →  207 files / 4832 tests passed  |  exit code 0  |  166.8s
```

- 已知 flaky（不判回归）：`tests/main/ai/cacheMonitor.test.ts > getStats 10 万次调用 < 50ms`、
  `tests/benchmarks/ab-test.test.ts > djb2 faster than simulated MD5`（并行负载下红、单跑绿）
- 本次基线全量并行跑为**全绿**，上述两项未触发。

## 技术调研（2.0）裁定

L 级要求 `crw search` + `docs-mcp-server search`。**本轮不执行**，理由记录如下（非静默跳过）：

本轮 13 项瓶颈全部是**本地算法复杂度 / 缓存装配 / 轮询改事件驱动**类改动，
不涉及任何外部库选型或 API 契约决策（无新增依赖、无框架替换、无协议变更）。
外部调研无法产出任何决策输入 —— 调研目标（"用哪个库/哪种方案"）在本题中不存在。
若后续范围扩大到「解析卸载 Worker」「DAO 异步化」等架构级改动，届时补充调研。

## 变更白名单（Phase 2 锁定的文件集，Phase 4 不得越界）

| 瓶颈 | 文件 |
|------|------|
| MEM-1/2/3/4 | `src/main/ai/agent/memoryPolicy.ts`、`src/main/db/agentMemory.ts` |
| INT-1 | `src/main/ai/agent/subtaskOrchestrator.ts` |
| INT-2 | `src/main/ai/intentTiering.ts` |
| TOOL-1 | `src/main/ai/toolRegistry.ts`、`src/main/ai/agent/agentToolSelector.ts` |
| QUE-1/2 | `src/main/db/agentTaskDao.ts`、`src/main/ai/agent/agentTaskQueue.ts`、`src/main/ai/agent/memoryWriter.ts` |
| DOC-1 | `src/main/ai/files/pdfLayout.ts` |
| DOC-2 | `src/main/ai/files/parseLimiter.ts` |
| DOC-3 | `src/main/ai/tools/searchDocument.ts` |
| DOC-4 | `src/main/ai/utils/tokenEstimator.ts`、`src/main/ai/agent/agentPromptBuilder.ts` |

## 阶段进度

- [x] Phase 0 分级 + 瓶颈扫描（13 项：P0×4 / P1×5 / P2×4）
- [x] Phase 4 基线全绿记录
- [x] Phase 1 需求对齐（范围裁定：**P0+P1+P2 全部**；外部调研**同意跳过**）
- [x] Phase 2 规划 → `ai-core-perf.plan.md`
- [x] Phase 4 逐项优化 —— **实施 9 项，主动放弃 4 项**（理由见 `ai-core-perf.delivery.md` §2.2）
- [x] Phase 5 代码审查（过程中捕获 1 处真实缺陷：MEM-2 首版 memo 键用 row.id）
- [x] Phase 5.5 连通性验证 → `ai-core-perf.connectivity.md`（11 链全部 ✅）
- [x] Phase 6 全量测试门禁 → **209 files / 4864 tests，VITEST_EXIT=0**
- [x] Phase 7 合规核对（0 error / 109 warning；无 `any`；SQL 全参数化）
- [x] Phase 8 交付 → `ai-core-perf.delivery.md`

## 最终结果

| 指标 | 改前 | 改后 | 提升 |
|------|------|------|------|
| `analyzePdfLayout`（20 页密集版面） | 21.53 ms (min) | 5.16 ms | 4.2× |
| `toolsForIntent` ×100 | 4.433 ms (min) | 0.095 ms | 46.7× |
| `Σ estimateContentTokens`（14 条消息） | 0.167 ms (min) | 0.010 ms | 16.7× |
| `classifyIntentShared` ×120 | 3.404 ms (min) | 2.158 ms | 1.6× |
| `runMemoryPolicy` 全列扫描 / 读取模型 | 4 次 / 6.58 MB | 0 次 / 0.53 MB | −92% |

门禁：`tsc` 无错误 · `eslint` 0 error · `vitest` 全绿（exit 0） · `vite build` 通过

## 后续任务（交接）

1. R6：用真实 SQLite 库（Electron 运行时）复核 SQL 层收益模型 —— 本轮无真机基准。
2. R4：`skillDistiller.ts:208` 的 QUE-2 同款写法（白名单外，未改）。
3. 范围外（需另立任务）：解析计算卸载 Worker、`better-sqlite3` 异步化、`pdfLayout.detectTable` 大样例基准。
4. 范围内放弃的 DOC-2 / QUE-1 / MEM-1 批量关闭 —— 均已实测为单位数毫秒或零收益，**不建议重开**。

