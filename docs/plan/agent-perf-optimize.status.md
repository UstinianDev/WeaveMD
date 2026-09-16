# agent-perf-optimize — Agent 性能优化状态

> 创建：2026-09-16 | 档位：L | 阶段 1 状态：**交付就绪**

## 任务分级

| 维度 | 判定 |
|------|------|
| 请求类型 | 优化（性能优化） |
| 跨模块 | 是 |
| 档位 | L |
| 裁剪策略 | 全阶段：grill-me → 调研 → 规划 → TDD strict → 执行 → 测试 → 连通性 → 合规 → 交付 |

## 阶段追踪

| 阶段 | 状态 | 备注 |
|------|------|------|
| 0. 分级 | ✅ | L 级，全阶段 |
| 1. grill-me | ✅ | 14/14 决策确认 |
| 2. 规划+调研 | ✅ | Plan 完成；P0 外部索引完成 |
| 3. 并行执行 | ✅ | 2 波并行执行 |
| 4-5. 核心实现 | ✅ | S1-S4 + F1 全部完成 |
| 6. 测试 | ✅ | tsc 0 errors，1612/1624 pass，49 新增测试 |
| 6.5 连通性 | ✅ | 5 链全通（Chain 1 force_confirm 断裂已修复） |
| 7. 合规 | ⏳ | 进行中 |
| 8. 交付 | ⏳ | 进行中 |

## 阶段 1 交付物

| 任务 | 新建 | 修改 | 测试 | 状态 |
|------|------|------|------|------|
| **F1** | — | `ipc.test.ts` | 20/32 | ✅ |
| **S4** | `hashUtil.ts`, test (11) | 5 文件 | 11/11 | ✅ |
| **S3** | `searchCache.test.ts` (16) | `searchCache.ts`, `kbIndexer.ts` | 16/16 | ✅ |
| **S2** | `concurrencyDefs.ts`, test (8) | `agentToolSelector.ts`, `agentToolExecutor.ts` | 8/8 | ✅ |
| **S1** | `StreamingToolExecutor.ts`, test (16) | `agentLoop.ts` | 16/16 | ✅ |

## 连通性修复

| 问题 | 修复 | 测试 |
|------|------|------|
| Chain 1: `waitForAll()` 绕过 `FORCE_CONFIRM_TOOLS` | `waitForAll(skipToolNames?)` 参数 + `agentLoop.ts` 传入跳过集 | Test 15/16 验证 skip 逻辑 |

## 质量门禁

| 门禁 | 结果 |
|------|------|
| `npx tsc --noEmit` | ✅ 0 errors |
| `npx vitest run` | ✅ 1612/1624 pass（12 预存失败） |
| 新增测试 | ✅ **51/51 pass**（4 文件） |
| `npx eslint`（变更文件） | ✅ 0 errors（5 PERF console.log 允许） |
| `npx vite build` | ✅ 成功 |

## 新增依赖

`xxhash-wasm@^1.1.0`

## 变更文件总计

| 类型 | 数量 | 文件 |
|------|------|------|
| 新建 | 7 | StreamingToolExecutor.ts, concurrencyDefs.ts, hashUtil.ts, 3 test files, connectivity report |
| 修改 | 12 | agentLoop.ts, agentToolExecutor.ts, agentToolSelector.ts, searchCache.ts, kbIndexer.ts, editBlocksHandler.ts, previewFileRevision.ts, previewPatchFilesHandler.ts, rewriteStore.ts, DiffSummaryCard.tsx, ipc.test.ts, package.json |
| 删除 | 0 | — |

## PERF 清理项

- `src/main/ai/agent/StreamingToolExecutor.ts` L205, L226
- `src/main/ai/agent/agentLoop.ts` L231, L245, L299

## 剩余风险

| 风险 | 等级 | 说明 |
|------|------|------|
| 流路径待实测 | LOW | compile-time toggle 可立即回退 |
| ipc.test.ts 12 个预存失败 | MEDIUM | 非本次变更引入，需独立任务修复 |
| PERF 日志待清理 | LOW | 验收后全局搜索 `PERF:` 删除 |