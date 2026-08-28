# ai-perf-optimize — 实施计划

## 变更清单

### 渲染端（Group A）
| 文件 | 变更 |
|------|------|
| `src/render/stores/agentStore.ts` | init 合并 set()、reset 清理监听器、streamBuffer 移除 |
| `src/render/components/AIAgent/AgentTab.tsx` | streamBuffer 用 useRef+rAF、消息列表抽取、onCopy/onRetry useCallback、processStatusText useMemo |
| `src/render/components/AIAgent/AIMessageBubble.tsx` | React.memo、parseRefsJson useMemo、handleOpenSource useCallback |
| `src/render/components/AIAgent/AIAgentPanel.tsx` | handleClose/handleNewChat 等 useCallback |
| `src/render/components/AIAgent/AIPanelComposer.tsx` | buildCompletionItems useMemo |
| `src/render/components/AIAgent/AgentWorkflowCard.tsx` | StepCard/ToolCallRow React.memo、errorCount useMemo、extractToolSummary useMemo |
| `src/render/components/AIAgent/ToolCallTrace.tsx` | React.memo、summarizeArgs useMemo |

### 主进程（Group B）
| 文件 | 变更 |
|------|------|
| `src/main/ai/agentLoop.ts` | 只读工具并行、增量 token、原地 push、增量 checkpoint |
| `src/main/ai/toolRegistry.ts` | defineCoreTools 缓存为模块常量 |
| `src/main/ai/contextManager.ts` | unshift→push+reverse、estimateTokens 中文修正 |
| `src/main/ai/kbSearch.ts` | rankCandidates Map 化、aggregateAndExpand 批量 SQL、rerankCache 惰性清理 |
| `src/main/ai/ipc/agentHandlers.ts` | AGENT_SKILLS_LIST 30s TTL 缓存 |

## 验收标准
1. tsc 0 新增错误
2. vitest 全部通过
3. lint 0 新增错误
4. 流式传输不触发历史消息重渲染
5. 多只读工具并行执行
