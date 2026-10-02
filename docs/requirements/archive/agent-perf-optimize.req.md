# agent-perf-optimize — Agent 性能优化需求

> 创建：2026-09-16 | 来源：优化方向文档 + Grilling 会话 | 状态：需求对齐完成

## 背景

基于《WeaveMD Agent 性能优化方向》文档（含 14+ 优化项），结合 3 路事实查证 + 14 轮 Grilling 决策对齐，确定本次优化范围。

## 硬性约束

| 约束 | 说明 |
|------|------|
| 工具行为不变 | 每个工具的功能、输入输出、副作用不可变 |
| 上下文不瘦身 | 不压缩系统提示、不减少历史轮次、不截断工具结果 |
| 最大轮次不变 | 保持意图动态分配轮次机制 |
| 交互卡不丢 | ask_question_card 触发逻辑保持 |
| agentLoopGuard MD5 不替换 | 死循环检测保持 MD5，仅 staleness detection 路径替换为 xxHash |

## 优化清单

### 阶段 1：低风险优化（本次实施）

| # | 优化项 | 文件 | 风险 | 关键决策 |
|---|--------|------|------|----------|
| S1 | 流式推测执行 | `agentLoop.ts` + 新建 `StreamingToolExecutor.ts` | 中 | 裁剪适配 WeaveMD 架构，不照搬泄露源码；编译时常量开关；需手工 A/B 对比验证 |
| S2 | 并发判断精细化 | `agentToolSelector.ts` + `agentToolExecutor.ts` | 低 | 分批推行：阶段 1 覆盖 TOP10 高频工具，其余默认串行 |
| S3 | 缓存键精细化 | `searchCache.ts` | 低 | 缓存键加 `searchMode`；分级失效（按 chunk_id）；纳入 invalidateKbSearchCache 分级失效 |
| S4 | MD5 → xxHash | `editBlocksHandler.ts` + `previewFileRevision.ts` + `previewPatchFilesHandler.ts` | 低 | `xxhash-wasm`（WASM）；仅替换 staleness detection 路径，不动 agentLoopGuard |

### 阶段 2：架构级优化（规划覆盖，后续执行）

| # | 优化项 | 风险 |
|---|--------|------|
| S5 | 工具延迟加载（ToolSearchTool） | 中 |
| S6 | 大结果持久化（toolResultStorage） | 中 |
| S7 | Prompt 前缀稳定性（6 层分层） | 中 |
| S8 | 上下文压缩复用缓存 | 中 |

### 阶段 3：知识库优化（规划覆盖，后续执行）

| # | 优化项 | 风险 |
|---|--------|------|
| S9 | HyDE 结果缓存 | 低 |
| S10 | Embedding 缓存 | 低 |
| S11 | 预加载策略优化（模糊匹配） | 低 |
| S12 | 查询理解增强 | 低 |

### 阶段 4：监控与验证（规划覆盖，后续执行）

| # | 优化项 | 风险 |
|---|--------|------|
| S13 | 性能基准套件 | 低 |
| S14 | A/B 测试框架 | 低 |
| S15 | 缓存命中率监控 | 低 |
| S16 | 成本追踪 | 低 |

## 顺手修复

| 项 | 文件 | 说明 |
|----|------|------|
| F1 | `tests/main/ai/ipc.test.ts` | 修复 vitest mock hoisting 问题（1 个测试文件失败） |

## 不纳入本次的发现

| 发现 | 处理方式 |
|------|----------|
| `classifyIntent` 未接入 searchKB 主管线 | 记录 TODO，独立任务 |
| `embeddingClient.ts` 完全无缓存 | 已在阶段 3 S10 覆盖 |
| 14 个工具 `isConcurrencySafe` 补全 | 阶段 2 补全 |

## 验收标准

| 指标 | 测量方式 | 目标 |
|------|----------|------|
| 端到端耗时 | `performance.now()` 打点 | 典型任务缩短 15-30% |
| 首个工具调用时机 | PERF 打点 | 流式推测执行：不晚于流结束前 |
| Token 消耗 | API usage 字段 | 减少 25%（阶段 2-4 逐步达成） |
| 缓存命中率 | cache_read / total | > 70%（阶段 4 验证） |
| 类型检查 | `npx tsc --noEmit` | 0 errors |
| 单元测试 | `npx vitest run` | 全部通过 |
| 手工回归 | 简单对话/工具调用/多轮对话/知识库检索/写控制确认 | 无回归 |

## Grilling 决策记录

| Q# | 决策 | 结论 |
|-----|------|------|
| Q1 | 任务拆分 | 一次性规划、分阶段执行、单任务交付 |
| Q2 | StreamingToolExecutor | 确认纳入阶段 1 |
| Q3 | 外部资料优先级 | P0（StreamingToolExecutor/isConcurrencySafe/toolResultStorage）→ P1 → P2 |
| Q4 | xxHash 方案 | xxhash-wasm（WASM） |
| Q5 | 基准时机 | 并行分步：先建最小基准再优化 |
| Q6 | MD5 替换范围 | 仅 staleness detection，不动 agentLoopGuard |
| Q7 | StreamingToolExecutor 设计 | 裁剪适配 WeaveMD，不照搬 |
| Q8 | isConcurrencySafe 推行 | 分批：TOP10 先覆盖，其余默认串行 |
| Q9 | 发现 Bug 处理 | searchCache 纳入；classifyIntent/embedding 记录 TODO |
| Q10 | 外部索引时机 | 规划前建立 P0 索引 |
| Q11 | CONTEXT_WINDOW | 阶段 1 不动，保守阈值 |
| Q12 | 失败测试 | 顺手修复 ipc.test.ts |
| Q13 | Feature Flag | 编译时常量起步 |
| Q14 | 验证标准 | 手工 A/B 对比 + PERF 打点 |