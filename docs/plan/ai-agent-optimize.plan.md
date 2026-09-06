# AI Agent 优化计划

> 来源：`WeaveMD-AI-Agent优化任务清单.md`
> 级别：L（跨模块，10 个子模块）

## 变更清单

### Phase 1: P0 Bug 修复 + 提示词优化
| # | 任务 | 文件 | 优先级 |
|---|------|------|--------|
| 1 | 重试不重置累积状态 | `src/main/ai/llm/llmClient.ts`, `src/main/ai/agent/agentLoop.ts` | P0 |
| 2 | 不完整对话历史污染 | `src/main/ai/agent/agentLoop.ts` | P0 |
| 3 | 精简系统提示词 | `src/main/ai/agent/agentLoop.ts` | P0 |

### Phase 2: P1 核心性能 + 前端体验
| # | 任务 | 文件 | 优先级 |
|---|------|------|--------|
| 4 | 减少 LLM 调用轮次（12→6 + 快速路径） | `src/main/ai/agent/agentLoop.ts` | P1 |
| 5 | 动态工具选择 | `src/main/ai/agent/agentLoop.ts`, `src/main/ai/toolRegistry.ts` | P1 |
| 6 | 优化重排触发条件 | `src/main/ai/knowledge/kbSearch.ts` | P1 |
| 7 | editBlocks 加入 READ_ONLY_TOOLS | `src/main/ai/agent/agentLoop.ts` | P3 |
| 8 | 优化写入确认规则（系统提示词） | `src/main/ai/agent/agentLoop.ts` | P1 |
| 9 | 进度反馈 | `src/main/ai/agent/agentLoop.ts` | P2 |
| 10 | 顶部导航栏添加保存按钮 | `src/render/components/Navbar/TopBar.tsx` | P1 |
| 11 | 切换文档前保存提示 | `src/render/components/Editor/panels/FileTreePanel.tsx` | P1 |
| 12 | 退出应用前保存提示 | `src/main/main.ts`, `src/render/App.tsx` | P1 |

### Phase 3: P2 优化
| # | 任务 | 文件 | 优先级 |
|---|------|------|--------|
| 13 | Schema 压缩 | `src/main/ai/toolRegistry.ts` | P2 |
| 14 | 上下文窗口管理优化 | `src/main/ai/agent/agentLoop.ts` | P1 |
| 15 | 知识库搜索缓存 | `src/main/ai/knowledge/kbSearch.ts` | P2 |

## 不在本次范围
- P4: Agentic RAG、HyDE（高复杂度，需独立规划）
- P2: Embedding 架构设计（纯设计，无代码变更）
- P3: Web Worker JSON.parse、批量 IPC（收益低，风险中）
- 工具设计借鉴（需独立调研）

## 验收标准
1. `npm run typecheck` — 0 error
2. `npm run test` — 全部通过
3. `npm run lint` — 0 error
4. 重试 Bug 验证：retry 时 assistantContent 重置
5. 不完整历史验证：无 reply 的 user 消息被清理
6. 保存按钮可见且功能正常
