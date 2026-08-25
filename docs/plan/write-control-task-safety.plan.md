# 写控制与任务安全模块 — 实施计划

> 参考：Notus 项目 Write Control & Task Safety
> 本期范围：R1 + R2 + R5 + R7（核心子集）

## 一、变更清单

### R1：写模式切换（auto/manual 泛化）— 已完成 2026-08-25

| 编号 | 文件 | 改动 |
|------|------|------|
| R1-1 | `src/shared/ai.ts` | 新增 `WriteMode = 'auto' \| 'manual'` 类型 |
| R1-2 | `src/shared/constants.ts` | 新增 `AI_GET_WRITE_MODE` / `AI_SET_WRITE_MODE` IPC 通道 |
| R1-3 | `src/main/db/index.ts` | 幂等迁移 `ai_config.write_mode TEXT DEFAULT 'manual'` |
| R1-4 | `src/main/db/ai.ts` | `AiConfigRow`/`AiConfigDbRow`/`AiConfigUpdate` 新增 writeMode，map/upsert 支持 |
| R1-5 | `src/main/ai/ipc/configConsentHandlers.ts` | 注册 get/set writeMode handler |
| R1-6 | `src/main/preload.ts` | `WeaveMDApi.ai` 新增 getWriteMode / setWriteMode |
| R1-7 | `src/render/stores/agentStore.ts` | `autoApplyRewrite` → `writeMode`，init 拉取 + setWriteMode 持久化 + onTool 按 writeMode 分流 |
| R1-8 | `src/render/components/AIAgent/AIPanelComposer.tsx` | 开关 UI 改用 writeMode |
| R1-9 | `src/render/utils/weaveMDBridge.ts` | 浏览器 mock bridge 补齐 |

### R2：写预览版本对比（MD5 staleness detection）

| 编号 | 文件 | 改动 |
|------|------|------|
| R2-1 | `src/shared/ai.ts` | `IPatchPreview` 新增 `contentHash?: string` |
| R2-2 | `src/main/ai/toolRegistry.ts` | editBlocks/preview_patch_files 生成时计算 MD5 写入 contentHash |
| R2-3 | `src/render/stores/agentStore.ts` | onTool 回调传递 contentHash 到 rewriteStore |
| R2-4 | `src/render/stores/rewriteStore.ts` | applyRewrite 时校验 contentHash，不一致设 staleRejected |
| R2-5 | `src/render/components/AIAgent/RewritePreviewCard.tsx` | stale 警告文案确认 |

### R5：任务事件持久化先于 SSE 推送

| 编号 | 文件 | 改动 |
|------|------|------|
| R5-1 | `src/main/ai/agentLoop.ts` | sendStream → persistAndSend（4 处），AgentLoopDeps 扩展 sessionId/mainWindow |
| R5-2 | `src/main/ai/agentTaskWorker.ts` | 传递 sessionId + mainWindow 到 agentLoop，完成/错误事件走 persistAndSend |
| R5-3 | `src/shared/constants.ts` | 新增 AGENT_REPLAY_EVENTS + AGENT_ROLLBACK_SNAPSHOT 通道 |
| R5-4 | `src/main/ai/ipc/agentHandlers.ts` | 注册 replay IPC handler |
| R5-5 | `src/main/preload.ts` | 暴露 replayEvents API |
| R5-6 | `src/render/stores/agentStore.ts` | 断线重连补发（visibilitychange 触发 replay） |

### R3：Agent 交互暂停/恢复（ask_question_card）

| 编号 | 文件 | 改动 |
|------|------|------|
| R3-1 | `src/shared/constants.ts` | 新增 `AGENT_INTERACTION_QUESTION` / `AGENT_RESUME_INTERACTION` / `AGENT_RETRY_TASK` |
| R3-2 | `src/shared/ai.ts` | 新增 `AgentInteractionPayload` / `IAgentStreamInteractionEvent` 类型 |
| R3-3 | `src/main/ai/agentLoop.ts` | `AgentLoopDeps` 扩展 `onInteractionRequired` / `waitForInteraction`；工具循环检测 ask_question_card 成功后暂停 |
| R3-4 | `src/main/ai/agentTaskWorker.ts` | `pendingInteractions` Map + `resumeInteraction()` + cancelTask reject |
| R3-5 | `src/main/ai/ipc/agentHandlers.ts` | 注册 `AGENT_RESUME_INTERACTION` / `AGENT_RETRY_TASK` handler |
| R3-6 | `src/main/preload.ts` | 暴露 `resumeInteraction` / `retryTask` API + `onStream` 订阅 interaction 事件 |
| R3-7 | `src/render/stores/agentStore.ts` | `pendingInteraction` 状态 + `resumeInteraction` / `retryTask` actions |
| R3-8 | `src/render/utils/weaveMDBridge.ts` | 浏览器 mock bridge 补齐 |

### R4：待处理状态 UI

| 编号 | 文件 | 改动 |
|------|------|------|
| R4-1 | `src/render/components/AIAgent/QuestionCard.tsx` | 新组件：text/choice/confirm 三种问题类型 + 条件依赖 |
| R4-2 | `src/render/components/AIAgent/AgentTab.tsx` | pendingInteraction 非空时渲染 QuestionCard |
| R4-3 | `src/render/components/AIAgent/AIPanelSession.tsx` | 标题栏 waiting 状态视觉标识 |

### R7：已实现模块集成

| 编号 | 文件 | 改动 |
|------|------|------|
| R7a | `src/main/ai/agentLoop.ts` | 集成 DeadLoopDetector，删除硬编码 MAX_ROUNDS=6 |
| R7b | `src/main/ai/agentLoop.ts` | 每轮结束调用 saveCheckpoint |
| R7c | `src/main/ai/agentTaskWorker.ts` | 调用 createSnapshot 替换骨架快照 |
| R7d | constants + handlers + preload + store + UI | 渲染侧「回滚到快照」全栈入口 |

## 二、实施顺序

```
Phase 1 (可并行):
  R2-1 + R2-2  (shared types + toolRegistry)
  R5-3          (IPC 通道常量)

Phase 2 (依赖 Phase 1):
  R2-3 + R2-4 + R2-5  (渲染侧 stores + UI)
  R5-1 + R7a + R7b     (agentLoop: persistAndSend + DeadLoopDetector + checkpoint，同文件合并)

Phase 3 (依赖 Phase 2):
  R5-2 + R7c           (agentTaskWorker: persistAndSend + createSnapshot，同文件合并)
  R5-4 + R5-5          (replay IPC handler + preload)

Phase 4 (依赖 Phase 3):
  R5-6                 (渲染侧断线重连)
  R7d                  (回滚到快照全栈)

Phase 5: 测试
```

## 三、风险评估

| 变更 | 风险 | 说明 |
|------|------|------|
| R2-2 toolRegistry MD5 | 低 | 纯计算 |
| R2-4 rewriteStore 校验 | 中 | 需确认 renderer crypto 可用 |
| R5-1 agentLoop 替换 | **高** | 核心路径，需 try-catch 容错 + 向后兼容 |
| R5-2 agentTaskWorker | 中 | mainWindow null-guard |
| R5-6 断线重连 | **高** | 建议 MVP 用 visibilitychange |
| R7a DeadLoopDetector | 中 | MAX_ROUNDS 6→12 行为变更 |
| R7b saveCheckpoint | 中 | 每轮 DB 写入开销 |
| R7c createSnapshot | 低 | 已实现，仅替换调用点 |
| R7d 回滚 UI | 中 | 需二次确认弹窗 |

## 四、关键设计决策

1. **AgentLoopDeps 扩展**：sessionId/mainWindow 全部可选，缺失时回退到 sendStream（向后兼容）
2. **persistAndSend 容错**：DB 写入失败时 log warn + 仍推 IPC（降级不丢事件）
3. **MD5 vs 全文比对**：两套并存，全文比对用于改写路径，MD5 用于 agent 工具路径
4. **MAX_ROUNDS 折中**：agentTaskWorker 传入 maxRounds=12
