# agent-kb-refactor 实施计划

> 创建：2026-09-10

## 变更清单

### 新增文件

| 文件 | 来源 | 估计行数 |
|------|------|----------|
| `src/main/ai/agent/agentPromptBuilder.ts` | agentLoop.ts 提取 | ~110L |
| `src/main/ai/agent/agentToolSelector.ts` | agentLoop.ts 提取 | ~100L |
| `src/main/ai/agent/agentKbPreloader.ts` | agentLoop.ts 提取 | ~50L |
| `src/main/ai/utils/tokenEstimator.ts` | 两处合并 | ~30L |
| `src/main/ai/knowledge/searchCache.ts` | kbSearch.ts 提取 | ~100L |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/main/ai/agent/agentLoop.ts` | 移除已提取代码，改为 import |
| `src/main/ai/knowledge/kbSearch.ts` | 移除缓存代码，改为 import searchCache |
| `src/main/ai/knowledge/knowledgeContext.ts` | 使用共享 tokenEstimator |
| `src/main/ai/agent/agentTaskWorker.ts` | processTask 分解为子方法 |

### 不变文件

所有 IPC handler、DB schema、渲染端组件、共享类型 — 零改动。

## 执行顺序

### Step 1: 基线测试

```
npm run test && npm run typecheck && npm run lint
```

全绿才继续。

### Step 2: 提取 tokenEstimator（R2 最小依赖）

- 从 agentLoop.ts 提取 `estimateTokens` 到 `src/main/ai/utils/tokenEstimator.ts`
- agentLoop.ts 和 knowledgeContext.ts 改为 import
- 运行测试验证

### Step 3: 提取 agentPromptBuilder（R1）

- 提取系统提示组装逻辑到 `agentPromptBuilder.ts`
- 提取文档上下文构建（buildDocumentContext）
- agentLoop.ts 改为 import
- 运行测试验证

### Step 4: 提取 agentToolSelector（R1）

- 提取 toolsForIntent + READ_ONLY_TOOLS 到 `agentToolSelector.ts`
- agentLoop.ts 改为 import
- 运行测试验证

### Step 5: 提取 agentKbPreloader（R1）

- 提取 createPreloadedSearchKb 到 `agentKbPreloader.ts`
- agentLoop.ts 改为 import
- 运行测试验证

### Step 6: 提取 searchCache（R3）

- 从 kbSearch.ts 提取搜索结果缓存 + 重排缓存到 `searchCache.ts`
- kbSearch.ts 改为 import
- 运行测试验证

### Step 7: 分解 agentTaskWorker.processTask（R4）

- 将220L 方法拆分为4 个子方法（同文件内，不新建文件）
- 运行测试验证

### Step 8: 分解 knowledgeContext.buildDocumentContext（R5）

- 将185L 函数拆分为 3 个子函数（同文件内）
- 运行测试验证

### Step 9: 全量验证

```
npm run test && npm run typecheck && npm run lint
```

### Step 10: 更新文档

- 更新 `docs/architecture/ai-agent.md`
- 更新 `docs/architecture/knowledge.md`
- 更新 `docs/plan/agent-kb-refactor.status.md`
- 创建 `docs/refactor/agent-kb-refactor.refactor.md`

## 验收标准

- [ ] `npm run test` 全绿
- [ ] `npm run typecheck` 零错误
- [ ] `npm run lint` 零错误
- [ ] 所有函数签名不变
- [ ] 所有 IPC 通道不变
- [ ] 所有 DB schema 不变
- [ ] Agent→KB→Tool→IPC→渲染 连通
