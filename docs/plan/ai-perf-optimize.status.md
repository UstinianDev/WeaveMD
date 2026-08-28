# ai-perf-optimize — 状态文档

## 分级

- 类型：优化（性能）
- 档位：M（跨模块，每项独立低风险）
- 裁剪：跳过拷问（grill-me 分析已完成）、跳过技术调研

## 已完成优化项

### P0 — 流式渲染 ✅
- [x] streamBuffer 从 store 移到组件 useRef + rAF 节流（agentStore.ts → AgentTab.tsx）
- [x] AIMessageBubble React.memo（AIMessageBubble.tsx）
- [x] 消息列表抽取为 MessageList 子组件（AgentTab.tsx）

### P1 — 主进程 ✅
- [x] 只读工具并行执行 Promise.all（agentLoop.ts）
- [x] rankCandidates 用 Map 替代 find O(n²)→O(n)（kbSearch.ts）
- [x] aggregateAndExpand 批量 SQL 查询（kbSearch.ts）

### P2 — 渲染端回调与计算 ✅
- [x] AgentTab onCopy/onRetry useCallback 化（AgentTab.tsx）
- [x] processStatusText useMemo（AgentTab.tsx）
- [x] contextManager unshift → push+reverse O(n²)→O(n)（contextManager.ts）
- [x] agentLoop 增量 token 统计 + 原地 push（agentLoop.ts）
- [x] agentLoop checkpoint 增量化（agentLoop.ts）

### P3 — 其他 ✅
- [x] defineCoreTools 缓存为模块常量（toolRegistry.ts）
- [x] AGENT_SKILLS_LIST 30s TTL 缓存（agentHandlers.ts）
- [x] visibilitychange 监听器清理（agentStore.ts）
- [x] init 多次 set() 合并为一次（agentStore.ts）
- [x] parseRefsJson useMemo（AIMessageBubble.tsx）
- [x] buildCompletionItems useMemo（AIPanelComposer.tsx）
- [x] StepCard/ToolCallRow/ToolCallTrace React.memo（AgentWorkflowCard.tsx / ToolCallTrace.tsx）
- [x] rerankCache 惰性清理（kbSearch.ts）
- [x] estimateTokens 中文精度修正 len/4→len/2（contextManager.ts）

## 测试证据

- **typecheck**: 3 pre-existing errors（ipc.test.ts）；0 新增
- **vitest**: 1499/1499 passed；1 pre-existing suite failure（ipc.test.ts mock hoisting）
- **lint**: 1 pre-existing error + 66 warnings；0 新增 error

## 变更文件清单

### 渲染端
- `src/render/stores/agentStore.ts` — init 合并、visibilitychange 清理、streamBuffer 移除 + onStreamDelta 事件
- `src/render/components/AIAgent/AgentTab.tsx` — streamBuffer 本地化、MessageList 抽取、processStatusText useMemo、onCopy/onRetry useCallback
- `src/render/components/AIAgent/AIMessageBubble.tsx` — React.memo、parseRefsJson useMemo、handleOpenSource useCallback
- `src/render/components/AIAgent/AIAgentPanel.tsx` — 5 个 handler useCallback
- `src/render/components/AIAgent/AIPanelComposer.tsx` — buildCompletionItems useMemo、streamBuffer→onStreamDelta
- `src/render/components/AIAgent/AgentWorkflowCard.tsx` — StepCard/ToolCallRow React.memo、errorCount useMemo、extractToolSummary useMemo
- `src/render/components/AIAgent/ToolCallTrace.tsx` — React.memo、summarizeArgs useMemo

### 主进程
- `src/main/ai/agentLoop.ts` — 只读工具并行、增量 token、原地 push、增量 checkpoint
- `src/main/ai/toolRegistry.ts` — CORE_TOOLS 模块级常量
- `src/main/ai/contextManager.ts` — push+reverse、estimateTokens len/2
- `src/main/ai/kbSearch.ts` — rankCandidates Map 化、批量 SQL、rerankCache 惰性清理
- `src/main/ai/ipc/agentHandlers.ts` — AGENT_SKILLS_LIST 30s TTL 缓存

### 测试
- `tests/main/ai/agentStore.test.ts` — 同步 streamBuffer 移除
- `tests/main/ai/contextManager.test.ts` — 同步 estimateTokens 精度变更

## 风险

| 风险 | 等级 | 说明 |
|------|------|------|
| streamBuffer→onStreamDelta | 中 | 新事件机制，需确认 AgentTab/AIPanelComposer 的 useEffect cleanup 正确 |
| estimateTokens 精度变更 | 低 | len/4→len/2 对中文更准确，英文偏保守多触发压缩（安全侧） |
| 并行工具执行 | 低 | 只读工具并行不改变语义；有副作用工具保持串行 |
| 增量 checkpoint | 低 | 只存本轮 toolTurn，恢复时调用方不依赖全量历史 |
