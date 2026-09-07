# agent-optimize-v3 — 实施计划

> 创建时间：2026-09-07
> 需求文档：`docs/requirements/agent-optimize-v3.req.md`

---

## 变更清单

| 模块 | 文件路径 | 变更类型 | 关联需求 |
|------|----------|----------|----------|
| 搜索持久化 | `src/render/stores/agentStore.ts` | 修改 | R1.1 |
| 搜索持久化 | `src/render/components/AIAgent/settings/SearchSettings.tsx` | 修改 | R1.2 |
| 动态轮次 | `src/main/ai/agent/agentLoop.ts` | 修改 | R2.1, R2.2, R2.4 |
| 动态轮次 | `src/main/ai/agent/agentLoopGuard.ts` | 修改 | R2.1, R2.4 |
| 动态轮次 | `src/main/ai/agent/agentSession.ts` | 修改 | R2.1 |
| 动态轮次 | `src/main/db/agentSessionDao.ts` | 修改 | R2.1 |
| 动态轮次 | `src/main/ai/ipc/agentHandlers.ts` | 修改 | R2.2 |
| 动态轮次 | `src/render/stores/agentStore.ts` | 修改 | R2.3, R2.5 |
| 动态轮次 | `src/render/components/AIAgent/settings/RoundsSettingsPanel.tsx` | 新建 | R2.3 |
| 动态轮次 | `src/render/components/AIAgent/AgentTab.tsx` | 修改 | R2.5 |
| 多文件Diff | `src/render/stores/agentStore.ts` | 修改 | R3.1 |
| 多文件Diff | `src/render/components/AIAgent/cards/PatchPreviewCard.tsx` | 新建 | R3.2 |
| 多文件Diff | `src/render/components/AIAgent/cards/PatchDetailModal.tsx` | 新建 | R3.3, R3.4 |
| 多文件Diff | `src/render/components/AIAgent/AgentTab.tsx` | 修改 | R3.5 |
| 多文件Diff | `src/shared/ai/clarify.ts` | 修改 | R3.1 |
| 共享常量 | `src/shared/constants.ts` | 修改 | R2.1 |

## 实施顺序

### Phase 1: 联网搜索配置持久化（R1）
- 1.1: `refreshSearchConfig` 联动 `searchConnectionOk`
- 1.2: `handleTest` 与 init 逻辑对齐
- 1.3: 端到端验证

### Phase 2: 多文件 Diff 预览（R3）
- 2.1: 扩展 `IPatchProposal` 类型
- 2.2: agentStore 拦截 `preview_patch_files`
- 2.3: 新建 `PatchPreviewCard`
- 2.4: 新建 `PatchDetailModal`
- 2.5: AgentTab 集成
- 2.6: 端到端验证

### Phase 3: 动态轮次控制（R2）
- 3.1: 统一 `DEFAULT_MAX_ROUNDS` 常量
- 3.2: agentLoop 使用统一配置
- 3.3: agentLoopGuard 支持动态 maxRounds
- 3.4: agentSession 同步 maxRounds
- 3.5: agentSessionDao 支持更新
- 3.6: 基于意图的动态轮次
- 3.7: agentStore 新增轮次配置状态
- 3.8: 新建 `RoundsSettingsPanel`
- 3.9: 死循环消息透传
- 3.10: 轮次耗尽恢复 UI
- 3.11: 端到端验证

## 验收标准
- R1: 重启后搜索状态自动恢复
- R2: 意图动态轮次 + 用户可配置 + 死循环消息透传 + 耗尽可恢复
- R3: preview_patch_files 被拦截 + PatchPreviewCard + PatchDetailModal + 批量操作
