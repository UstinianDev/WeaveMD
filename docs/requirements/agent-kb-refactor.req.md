# agent-kb-refactor 需求文档

> 创建：2026-09-10

## 目标

对「智能创作 Agent」「搜索知识库」「写控制与任务安全」三个模块进行纯代码质量重构，**不改变任何功能行为**，保持所有端到端连通性。

## 验收标准

1. 所有现有测试通过（`npm run test` + `npm run typecheck` + `npm run lint`）
2. 零功能行为变化：函数签名、IPC 通道、DB schema、UI 行为均不变
3. Agent→KB→Tool→IPC→渲染 每条链路保持连通
4. 重构后代码可读性提升（长函数拆分、重复消除、职责清晰）

## 重构范围

### R1: agentLoop.ts 拆分（1197L → ~600L + 4 个子模块）

从 agentLoop.ts 提取：

| 提取内容 | 目标文件 | 行数估计 |
|----------|----------|----------|
| 系统提示组装 | `agentPromptBuilder.ts` | ~80L |
| 工具选择逻辑 | `agentToolSelector.ts` | ~100L |
| KB 预加载缓存 | `agentKbPreloader.ts` | ~50L |
| 文档上下文构建 | `agentPromptBuilder.ts` | ~30L |

**不变**：runAgentFlow 签名、AgentLoopDeps 接口、所有 IPC 事件格式。

### R2: 消除重复代码

| 重复 | 位置 | 方案 |
|------|------|------|
| `estimateTokens` | agentLoop.ts + knowledgeContext.ts | 提取到 `src/main/ai/utils/tokenEstimator.ts` |
| 缓存模式 | kbSearch.ts 内 3 处缓存（搜索结果 + 重排 + 研究循环） | 提取到 `searchCache.ts` |

### R3: kbSearch.ts 缓存提取（980L → ~750L + 缓存模块）

从 kbSearch.ts 提取：

| 提取内容 | 目标文件 | 行数估计 |
|----------|----------|----------|
| 搜索结果缓存 | `searchCache.ts` | ~60L |
| 重排缓存 | `searchCache.ts` | ~40L |

**不变**：searchKB 签名、KbSearchOptions、所有缓存行为。

### R4: agentTaskWorker.ts 分解

将 `processTask`（220L）拆分为：

| 方法 | 职责 |
|------|------|
| `readTaskPayload` | 解析 payloadJson |
| `buildAgentDeps` | 构造 AgentLoopDeps |
| `handleTaskSuccess` | 成功后续处理 |
| `handleTaskError` | 错误处理 |

**不变**：AgentTaskWorker 公共 API、IPC 事件、状态转换。

### R5: knowledgeContext.ts 分解

将 `buildDocumentContext`（185L）拆分为：

| 函数 | 职责 |
|------|------|
| `buildShortDocContext` | 短文档全文注入 |
| `buildLongDocContext` | 长文档 outline+段落 |
| `truncateToTokenBudget` | 截断（已是独立函数） |

**不变**：buildKbContext 签名和返回值。

## 不在范围内

- 工具策略执行集成（agentToolPolicy.ts 定义了策略但未在执行路径中集成 — 集成会改变行为）
- 新增测试（仅确保现有测试不回归）
- 性能优化（本次仅代码结构优化）
- 文档内容更新（仅更新结构相关文档）

## 已对齐问题

| # | 问题 | 结论 |
|---|------|------|
| 1 | 提取的函数是否需要 export？ | 仅被同模块内使用的不 export；跨模块调用的保持 export |
| 2 | 缓存提取后 TTL 策略是否变化？ | 不变，原样迁移 |
| 3 | 是否需要更新架构文档？ | 完成后更新 ai-agent.md 和 knowledge.md |
