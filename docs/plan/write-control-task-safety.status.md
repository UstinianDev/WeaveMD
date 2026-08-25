# write-control-task-safety — 任务状态

## 分级

| 维度 | 值 |
|------|-----|
| 请求类型 | 功能开发（复刻 Notus 写控制与任务安全模块） |
| 影响面 | 跨模块：主进程 agentLoop/agentTaskWorker + 渲染进程 agentStore + DB + IPC |
| 预估工时 | L（~2-3 天，含集成已实现模块 + 新增功能） |
| 裁剪路径 | 全部阶段，TDD strict |

## 本期范围

第一期：R2（写预览版本对比）+ R5（事件持久化先于 SSE）+ R7（已实现模块集成：死循环检测/检查点/完整快照）
第二期：R1（写模式切换）+ R3（Agent 交互暂停/恢复）+ R4（待处理状态 UI）+ R6（IndexedDB 草稿恢复）

## 当前阶段

- [x] 阶段 0：任务分级
- [x] 阶段 1：需求对齐
- [x] 阶段 2：规划
- [x] 阶段 3：并行执行
- [x] 阶段 4-5：核心实现（Phase 1-4 全部完成）
- [x] R6：IndexedDB 草稿恢复 — 2026-08-25 完成
- [x] R1：写模式切换（auto/manual 泛化）— 2026-08-25 完成
- [x] R4：待处理状态 UI（提问卡片 + waiting 标识 + 重试）— 2026-08-25 完成
- [x] R3：Agent 交互暂停/恢复（ask_question_card → waiting_interaction → 恢复）— 2026-08-25 完成
- [x] 阶段 6：测试（tsc 0 新增 | vitest 1500/1500 | lint 0 error）
- [x] 阶段 7：合规核对
- [x] 阶段 8：交付核对

## R6 完成记录（2026-08-25）

**变更文件**：
- `src/render/services/draftStore.ts` — **新建**：IndexedDB 单例 + saveDraft / loadDraft / deleteDraft / createDebouncedSaver(300ms)
- `src/render/components/AIAgent/AIAgentPanel.tsx` — 导入 draftStore；debounced save effect；restore effect；所有关闭/切换/发送/删除操作集成 IndexedDB 清理
- `src/render/components/AIAgent/AIPanelSession.tsx` — Props 新增 `onSend?` 透传给 AIPanelComposer
- `src/render/components/AIAgent/AIPanelHome.tsx` — Props 新增 `onSend?` 透传给 AIPanelComposer
- `tests/render/components/AIAgent/AIAgentPanel.test.tsx` — mock draftStore + 适配异步 draft 恢复
- `tests/render/components/AIAgent/AIPanelSession.test.tsx` — 更新 M4 测试用例

**验证**：tsc 0 新增错误 | vitest 1500/1500 pass | lint 0 error

---

## R1 完成记录（2026-08-25）

**变更文件**：
- `src/shared/ai.ts` — 新增 `WriteMode` 类型
- `src/shared/constants.ts` — 新增 `AI_GET_WRITE_MODE` / `AI_SET_WRITE_MODE` IPC 通道
- `src/main/db/index.ts` — 幂等迁移 `ai_config.write_mode` 列
- `src/main/db/ai.ts` — `AiConfigRow` / `AiConfigDbRow` / `AiConfigUpdate` 新增 `writeMode`，`mapConfigRow` / `upsertAiConfig` 支持读写
- `src/main/ai/ipc/configConsentHandlers.ts` — 注册 getWriteMode / setWriteMode handler
- `src/main/preload.ts` — `WeaveMDApi.ai` 新增 `getWriteMode` / `setWriteMode` 方法
- `src/render/stores/agentStore.ts` — `autoApplyRewrite` 替换为 `writeMode`，`init()` 拉取，`setWriteMode()` 持久化；`onTool` 回调按 writeMode 分流 auto-apply vs 手动确认
- `src/render/components/AIAgent/AIPanelComposer.tsx` — 开关 UI 改用 writeMode
- `src/render/utils/weaveMDBridge.ts` — 浏览器 mock bridge 补齐

**验证**：tsc 0 新增错误 | agentStore 32/32 tests pass | lint 0 error

## R3 + R4 完成记录（2026-08-25）

**变更文件**：
- `src/shared/constants.ts` — 新增 `AGENT_INTERACTION_QUESTION` / `AGENT_RESUME_INTERACTION` / `AGENT_RETRY_TASK` IPC 通道
- `src/shared/ai.ts` — 新增 `AgentInteractionPayload` / `IAgentStreamInteractionEvent` 类型，`IAgentStreamEvent` 联合扩展
- `src/main/ai/agentLoop.ts` — `AgentLoopDeps` 新增 `onInteractionRequired` / `waitForInteraction` 回调；工具执行循环检测 `ask_question_card` 成功后暂停等待用户答案，答案注入 LLM 续轮
- `src/main/ai/agentTaskWorker.ts` — `pendingInteractions` Map 管理暂停/恢复；`resumeInteraction()` 方法；`cancelTask()` 同时 reject 挂起交互；`processTask` 传递回调到 agentLoop
- `src/main/ai/ipc/agentHandlers.ts` — 注册 `AGENT_RESUME_INTERACTION` / `AGENT_RETRY_TASK` handler
- `src/main/preload.ts` — `WeaveMDApi.ai` 新增 `resumeInteraction` / `retryTask`；`onStream` 订阅 `AGENT_INTERACTION_QUESTION` 事件
- `src/render/stores/agentStore.ts` — 新增 `pendingInteraction` 状态 + `resumeInteraction` / `retryTask` / `clearPendingInteraction` actions；stream manager 新增 `onInteraction` 回调
- `src/render/components/AIAgent/AgentTab.tsx` — 渲染 `QuestionCard`（pendingInteraction 非空时）
- `src/render/components/AIAgent/AIPanelSession.tsx` — 标题栏 waiting 状态视觉标识（橙色圆点 + 文案）
- `src/render/components/AIAgent/QuestionCard.tsx` — 新组件：text/choice/confirm 三种问题类型 + 条件依赖 + 提交
- `src/render/utils/weaveMDBridge.ts` — 浏览器 mock bridge 补齐

**验证**：tsc 0 新增错误 | vitest 1500/1500 pass | lint 0 error（42 warnings 均 pre-existing）
