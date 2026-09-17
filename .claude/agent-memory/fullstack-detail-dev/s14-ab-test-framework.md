---
name: s14-ab-test-framework
description: A/B test framework implementation (S14) — compile-time constant driven, try/finally guaranteed teardown, 4 preset suites + 22 tests
metadata:
  type: project
---

S14 A/B 测试框架已完成 2026-09-17。

## 核心设计

### `tests/benchmarks/ab-test-runner.ts`
- `runABTest(config)`: setupA → run → setupB → run → teardown，**try/finally 保证 teardown 始终执行**
- `formatABTable(comparison)`: 将 ABComparison 输出为 Markdown 对比表格
- `runAllABTests(suites)`: 批量运行
- `higherIsBetter` 集合控制 improved 方向（默认 lower is better）

### `tests/benchmarks/ab-test-suites.ts`
4 套预置场景，全不依赖真实 LLM API：
1. **S1 StreamingToolExecutor**: 10 tools × 15ms 模拟，A 全串行 vs B 70% 并发
2. **S5 Deferred Tool Loading**: 5 核心 + 19 延迟工具的 prompt 体积对比
3. **S3/S10 Search Cache**: 5 唯一查询 × 2 重复，缓存命中率对比
4. **S4 Hash Algorithm**: 模拟 MD5 (3-pass) vs djb2 (1-pass)，4 种输入大小对比

### 关键模式
- 套件使用模块级变量 + setupA/setupB 切换模式，run() 读取当前模式
- teardown 恢复默认状态，保证套件间隔离
- 预置套件使用 `setTimeout` 模拟延迟，不依赖真实 API

### 测试覆盖
22 测试 (ab-test.test.ts):
- runABTest 基础功能 (7)
- formatABTable Markdown 输出 (4)
- 环境隔离 (3)
- teardown 恢复 (3)
- runAllABTests (1)
- 预置套件冒烟 (4)