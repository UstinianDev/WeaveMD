---
name: s13-benchmark-suite
description: S13 性能基准套件——5 大 Agent 场景 + 基线持久化 + compareWithBaseline 对比 + Markdown 表格输出
metadata:
  type: reference
---

# S13 性能基准套件

## 交付物

**文件**: `D:\software\WeaveMD\tests\benchmarks\agent-perf-benchmark.test.ts`

## 5 个基准场景

| 场景名 | 意图 | 轮次 | 工具数 | 说明 |
|--------|------|------|--------|------|
| simple-chat | chat | 1 | 0 | 简单对话 |
| multi-tool | kbQa | 3 | 2 | searchKB + readFile |
| large-doc-edit | rewrite | 1 | 0 | 大文档(2000行)上下文 |
| kb-retrieval | kbQa | 2 | 1 | searchKB 20条结果 |
| write-confirm | create | 2 | 2 | createFile + deleteFile |

## 关键函数/类型

- `PerfBaseline` / `PerfScenario` / `PerfMetric` — 基准数据结构（timestamp + commit + scenarios）
- `ComparisonReport` / `ComparisonEntry` — 对比报告结构（每指标差值 + 百分比变化）
- `saveBaseline()` / `loadBaseline()` — 持久化到 `tests/benchmarks/.perf-baseline.json`
- `loadBaselineOrEmpty()` — 文件不存在时返回空基线（含当前 commit/timestamp）
- `compareWithBaseline(current, baseline)` — 按名称匹配场景，计算每项指标差值
- `formatComparisonMarkdown(report)` — 生成带 🟢/🔴/🟡/➖ 的 Markdown 对比表格
- `measurePhase(label, fn)` / `measurePhaseSync(label, fn)` — 高精度 `performance.now()` 计时包装

## Mock 架构

完整 mock 了 Agent 框架的所有外部依赖（electron / db / llmClient / intentRouter / skillLoader / toolRegistry / toolResultStorage / concurrencyDefs / agentEventStore / agentLoopGuard / agentCheckpoint / embeddingClient / webSearch），仅测量纯粹的框架层代码路径。

## 测试覆盖（12 例，全绿）

- 5 个场景：成功运行 + 关键指标验证（e2eMs > 0 / toolCallCount / roundCount）
- compareWithBaseline：差值计算 / 百分比变化 / 摘要统计
- 基准 JSON：序列化 → 反序列化往返验证
- 保存/加载：文件写入 → 读取 → 清理
- 空基线对比：entries.length === 0
- Markdown 格式：表格 / 颜色图标 / commit hash
- 底层函数 bench：classifyIntent / estimateTokens / toolsForIntent

## 质量门禁

| 门禁 | 结果 |
|------|------|
| `npx tsc --noEmit` | 0 errors |
| `npx vitest run tests/benchmarks/agent-perf-benchmark.test.ts` | 12/12 pass |
| `npx eslint tests/benchmarks/agent-perf-benchmark.test.ts` | 0 errors |
| `npx vitest run`（全量） | 1841/1853 pass（12 预存 ipc.test.ts 失败，无新增回归） |