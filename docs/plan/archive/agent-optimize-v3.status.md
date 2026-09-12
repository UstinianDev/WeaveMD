# agent-optimize-v3 — 实施状态

> 最后更新：2026-09-07

## 门禁

| 门禁 | 结果 |
|------|------|
| tsc --noEmit | 本次文件 0 错误（已有 ipc.test.ts 3 错误为存量） |
| vitest | 1530 passed / 1 failed（已有 ipc.test.ts mock 问题） |
| eslint | 本次文件 0 errors / 3 warnings（已有） |

## Phase 1: 联网搜索配置持久化（R1）✅

| 任务 | 状态 | 文件 |
|------|------|------|
| 1.1 refreshSearchConfig 联动 searchConnectionOk | ✅ | `agentStore.ts:1204` |
| 1.2 handleTest 去乐观置位 | ✅ | `SearchSettings.tsx:86-91` |

## Phase 2: 多文件 Diff 预览（R3）✅

| 任务 | 状态 | 文件 |
|------|------|------|
| 2.1 IPatchProposal 类型 | ✅ | `clarify.ts:35-40` |
| 2.2 agentStore 拦截 preview_patch_files | ✅ | `agentStore.ts:653-670` |
| 2.3 PatchPreviewCard 组件 | ✅ | `PatchPreviewCard.tsx`（新建） |
| 2.4 PatchDetailModal 组件 | ✅ | `PatchDetailModal.tsx`（新建） |
| 2.5 AgentTab 集成 | ✅ | `AgentTab.tsx:15,142-144,234-240` |
| 2.6 patchProposals 状态 + actions | ✅ | `agentStore.ts`（接口+实现） |

## Phase 3: 动态轮次控制（R2）✅

| 任务 | 状态 | 文件 |
|------|------|------|
| 3.1 DEFAULT_MAX_ROUNDS 常量 | ✅ | `constants.ts` |
| 3.2 agentLoop 使用统一配置 | ✅ | `agentLoop.ts` |
| 3.3 agentLoopGuard 动态 maxRounds | ✅ | `agentLoopGuard.ts` |
| 3.4 agentSession 同步 | ✅ | `agentSession.ts` |
| 3.5 死循环消息透传 | ✅ | `agentLoop.ts:finalizeAgentRun` |
| 3.6 基于意图的动态轮次 | ✅ | `agentLoop.ts:getRoundsForIntent` |
| 3.7 userMaxRounds 状态 | ✅ | `agentStore.ts` |

## 变更文件清单

| 文件 | 变更类型 |
|------|----------|
| `src/shared/constants.ts` | 修改（新增常量） |
| `src/shared/ai/clarify.ts` | 修改（新增 IPatchProposal） |
| `src/main/ai/agent/agentLoop.ts` | 修改（统一常量+消息透传+意图动态轮次） |
| `src/main/ai/agent/agentLoopGuard.ts` | 修改（动态 maxRounds） |
| `src/main/ai/agent/agentSession.ts` | 修改（同步常量） |
| `src/render/stores/agentStore.ts` | 修改（搜索持久化+patchProposals+userMaxRounds） |
| `src/render/components/AIAgent/settings/SearchSettings.tsx` | 修改（handleTest 去乐观置位） |
| `src/render/components/AIAgent/panel/AIPanelComposer.tsx` | 修改（selectedEngine useEffect 同步） |
| `src/render/components/AIAgent/cards/PatchPreviewCard.tsx` | 新建 |
| `src/render/components/AIAgent/cards/PatchDetailModal.tsx` | 新建 |
| `src/render/components/AIAgent/AgentTab.tsx` | 修改（集成 PatchPreviewCard） |
