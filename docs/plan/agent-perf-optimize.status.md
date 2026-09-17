# agent-perf-optimize — Agent 性能优化状态

> 创建：2026-09-16 | 档位：L | 最后更新：2026-09-17

## 总体进度

| 阶段 | 任务 | 状态 | 新增测试 |
|------|------|------|----------|
| 1 | F1 + S4 + S3 + S2 + S1 | ✅ 已提交 | 51 |
| 2 | S7 + S8 + S6 + S5 | ✅ 已提交 | 51 |
| 3 | S9 + S10 + S11 + S12 | ✅ 已提交 | 96 |
| 4 | S13 + S14 + S15 + S16 | 🔄 执行中 | — |

## 阶段 4 进度

| ID | 优化项 | 状态 | 新增测试 | 证据 |
|----|--------|------|----------|------|
| S13 | 性能基准套件 | ✅ 已完成 | 12 | `tests/benchmarks/agent-perf-benchmark.test.ts` 12/12 pass |
| S14 | A/B 测试框架 | ✅ 已完成 | 22 | `tests/benchmarks/ab-test.test.ts` 22/22 pass |
| S15 | 缓存命中率监控 | 🔲 待执行 | — | — |
| S16 | 成本追踪 | 🔲 待执行 | — | — |

### S13 交付物

| 文件 | 说明 |
|------|------|
| `tests/benchmarks/agent-perf-benchmark.test.ts` | 性能基准套件：5 大场景 + 基线保存/加载 + 对比报告 |

**5 个基准场景**：

| 场景 | 意图 | 轮次 | 工具 | 说明 |
|------|------|------|------|------|
| simple-chat | chat | 1 | 无 | 简单对话 |
| multi-tool | kbQa | 3 | searchKB + readFile | 多工具调用 |
| large-doc-edit | rewrite | 1 | 无(文档上下文) | 大文档(2000行)编辑 |
| kb-retrieval | kbQa | 2 | searchKB(20条) | 知识库检索 |
| write-confirm | create | 2 | createFile + deleteFile | 写控制确认 |

**测试覆盖**（12 例）：
- 5 个场景运行成功 + 指标验证
- `compareWithBaseline` 差值计算验证
- 基准 JSON 序列化/反序列化
- 保存/加载基线文件
- 空基线对比
- Markdown 表格格式输出
- 底层函数 benchmark（classifyIntent / estimateTokens / toolsForIntent）

### S14 交付物

| 文件 | 说明 |
|------|------|
| `tests/benchmarks/ab-test-runner.ts` | 核心框架：`runABTest` / `formatABTable` / `runAllABTests` |
| `tests/benchmarks/ab-test-suites.ts` | 4 套预置 A/B 场景（S1/S5/S3/S4） |
| `tests/benchmarks/ab-test.test.ts` | 22 测试（框架基础 + 环境隔离 + teardown + 预置套件冒烟） |

## 质量门禁（累计）

| 门禁 | 结果 |
|------|------|
| `npx tsc --noEmit` | 0 errors |
| `npx vitest run` | 34/34 pass（benchmarks/ 目录） |
| 新增测试总计 | **232**（15 个优化项：S1-S14） |
| 新建源文件 | 12（StreamingToolExecutor / concurrencyDefs / hashUtil / toolResultStorage / ab-test-runner / ab-test-suites / agent-perf-benchmark + 6 test files） |
| 新增依赖 | `xxhash-wasm@^1.1.0` |

## 阶段 4 待办（明天）

| ID | 优化项 | 说明 |
|----|--------|------|
| S13 | 性能基准套件 | 5 个典型 Agent 场景 × 3 组参数，`.perf-baseline.json` |
| S14 | A/B 测试框架 | 编译时常量开关 + 自动对比脚本 |
| S15 | 缓存命中率监控 | HyDE / Embedding / Search / Prompt Cache 命中率 |
| S16 | 成本追踪 | 累计 reasoning/completion token 按 conversationId 统计 |

## PERF 清理项（阶段 4 完成后执行）

- `StreamingToolExecutor.ts` L212-219, L232-233
- `agentLoop.ts` 中 3 处 PERF console.log