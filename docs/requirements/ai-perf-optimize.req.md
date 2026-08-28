# ai-perf-optimize — 需求文档

## 目标

优化 AI 模块渲染性能和主进程计算效率，消除流式传输期间的不必要重渲染、串行瓶颈和 O(n²) 算法。

## 需求清单

### R1 流式渲染优化（P0）
- streamBuffer 从 agentStore 移出，用 useRef + rAF 节流在 AgentTab 内部管理
- AIMessageBubble 用 React.memo 包裹，跳过 props 未变的重渲染
- 消息列表抽取为独立 MessageList 组件，不订阅 streamBuffer/processStatus

### R2 工具并行执行（P1）
- agentLoop 中只读工具（listFiles/readFile/searchKB/readFileRevision）用 Promise.all 并行
- 有副作用工具（createFile/editBlocks）保持串行

### R3 知识库搜索优化（P1）
- rankCandidates 中三路排序结果预建 Map<chunkId, rank>，消除 O(n²) find
- aggregateAndExpand 批量收集 chunk 后一次 SQL 查询邻居

### R4 渲染端回调优化（P2）
- AgentTab 中 onCopy/onRetry 用 useCallback 化的稳定引用
- processStatusText 用 useMemo 缓存
- AIAgentPanel 回调用 useCallback 包裹

### R5 主进程算法优化（P2）
- contextManager keepRecentTail：unshift → push+reverse（O(n²)→O(n)）
- agentLoop：增量 token 统计替代每轮 .map().join()
- agentLoop：消息数组 push 原地修改替代 spread 拷贝
- agentLoop：增量 checkpoint 替代全量序列化

### R6 杂项优化（P3）
- defineCoreTools 缓存为模块级常量
- AGENT_SKILLS_LIST 加 30s TTL 缓存
- agentStore init 多次 set() 合并为一次
- agentStore reset() 清理 visibilitychange 监听器
- AIMessageBubble parseRefsJson 用 useMemo
- AIPanelComposer buildCompletionItems 用 useMemo
- AgentWorkflowCard StepCard/ToolCallRow/ToolCallTrace React.memo
- kbSearch rerankCache 惰性清理
- contextManager estimateTokens 中文精度修正（len/4 → len/2）

## 验收标准

1. 流式传输期间，每 token 到达只触发 streamBuffer 文本更新，历史消息不重渲染
2. 多只读工具调用时延迟低于串行执行
3. KB 搜索 20 候选时 rankCandidates 无 O(n²) 查找
4. 所有现有测试通过（typecheck 0 | vitest 通过 | lint 0）
5. 无功能回退

## 已对齐问题

- 无遗留问题，方案明确
