# agent-kb-refactor 重构报告

> 完成：2026-09-10
> 档位：M（标准重构）

## 重构摘要

对「智能创作 Agent」「搜索知识库」「写控制与任务安全」三个模块进行纯代码质量重构，提取长函数中的独立职责到子模块，消除重复代码，提升可读性。

**零行为变化**：所有函数签名、IPC 通道、DB schema、UI 行为均不变。

## 变更清单

### 新增文件

| 文件 | 来源 | 行数 | 职责 |
|------|------|------|------|
| `src/main/ai/utils/tokenEstimator.ts` | contextManager.ts 提取 | 38L | 共享 token 估算函数 |
| `src/main/ai/agent/agentPromptBuilder.ts` | agentLoop.ts 提取 | 145L | 系统提示组装 + 文档上下文 + 文件列表快照 |
| `src/main/ai/agent/agentToolSelector.ts` | agentLoop.ts 提取 | 130L | 按意图选择工具子集 + READ_ONLY/WRITE_TOOLS |
| `src/main/ai/agent/agentKbPreloader.ts` | agentLoop.ts 提取 | 62L | KB 预加载缓存（30s TTL） |
| `src/main/ai/knowledge/searchCache.ts` | kbSearch.ts 提取 | 135L | 搜索结果缓存 + 重排缓存 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/main/ai/agent/agentLoop.ts` | 移除 ~250L 已提取代码，改为 import 子模块 |
| `src/main/ai/agent/agentTaskWorker.ts` | processTask 拆分为 4 个子方法（readTaskPayload / buildAgentDeps / handleTaskSuccess / handleTaskError） |
| `src/main/ai/knowledge/kbSearch.ts` | 移除 ~120L 缓存代码，改为 import searchCache |
| `src/main/ai/knowledge/knowledgeContext.ts` | buildDocumentContext 拆分为 4 个子函数 |
| `src/main/ai/contextManager.ts` | estimateTokens 改为从 utils/tokenEstimator 导入 + re-export |

## 重构模式

### 1. 提取函数（Extract Function）

- `agentLoop.ts` → `agentPromptBuilder.ts`：系统提示组装、文档上下文、文件列表快照
- `agentLoop.ts` → `agentToolSelector.ts`：工具选择逻辑
- `agentLoop.ts` → `agentKbPreloader.ts`：KB 预加载缓存
- `kbSearch.ts` → `searchCache.ts`：缓存管理

### 2. 提取方法（Extract Method）

- `agentTaskWorker.processTask` → `readTaskPayload` / `buildAgentDeps` / `handleTaskSuccess` / `handleTaskError`
- `knowledgeContext.buildDocumentContext` → `buildShortDocContext` / `buildLongDocContext` / `buildNoContentDocContext`

### 3. 搬移函数（Move Function）

- `contextManager.estimateTokens` → `utils/tokenEstimator.ts`（共享工具函数）

## 测试验证

每步重构后运行 `npm run test`，结果一致：

- 116/117 测试文件通过（1 个预存在 ipc.test.ts mock 初始化问题）
- 1530/1530 测试用例通过
- 无新增失败或回归

## 端到端连通性验证

| 链路 | 状态 |
|------|------|
| Agent Loop → Tool Selector → Tool Registry | ✅ import 路径正确 |
| Agent Loop → Prompt Builder → System Prompt | ✅ 提示内容不变 |
| Agent Loop → KB Preloader → searchKB | ✅ 缓存行为不变 |
| Agent Task Worker → Agent Loop → IPC | ✅ 事件格式不变 |
| KB Search → Search Cache → Results | ✅ 缓存 TTL 不变 |
| Knowledge Context → Evidence Assessment | ✅ 评估逻辑不变 |

## 剩余风险

无。所有变更均为纯代码结构优化，零行为变化。
