---
name: agent-memory-optimize-2-c3-done
description: agent-memory-optimize-2 子批 C3（设置页自动记忆可见性入口）已实现未提交，含 IPC 鉴权范式与实测门禁数字
metadata:
  type: project
---

C3 于 2026-09-30 完成（未 commit；工作树同时含 C1/C2 与前批未提交改动）。

**交付文件**
- 新建 `src/main/ai/ipc/memoryHandlers.ts`（两通道 `ai:memory:list` / `ai:memory:delete`）
- 改 `src/main/ai/ipc/index.ts`（注册）、`src/main/preload.ts`（`ai.memory.list/delete`）、
  `src/shared/constants.ts`（+2 通道）、`src/shared/ai/agent.ts`（+`IAgentMemory` / `AgentMemoryKindValue`）、
  `src/render/stores/agentStore.ts`（`memories`/`memoriesLoading`/`memoriesError` + `loadMemories`/`deleteMemory`，
  已进 `RESET_FIELDS`）、`src/render/components/AIAgent/settings/AgentPersonalityPanel.tsx`（第 4 个 tab
  `autoMemory`，只读列表 + 二次确认删除）、`src/render/utils/weaveMDBridge.ts`（browser 模式 stub）、
  `src/render/i18n/{zh-CN,zh-TW,en}.json`（+16 键）
- 测试：`tests/main/ai/memoryHandlers.test.ts`(16) / `tests/main/preload.test.ts`(2) /
  `tests/render/components/AIAgent/settings/AgentPersonalityPanel.test.tsx`(9) +
  `tests/render/stores/agentStore.test.ts` 追加 6 例 + `tests/setup.ts` 加 `ai.memory` mock

**关键口径（沿用 C1/C2 风格，后续批次复用）**
- **不接受渲染层 `userId`**：两通道第一参是 `authToken`（当前登录 JWT），主进程用
  `sha256(app.getPath('userData'))` 解出 userId（与 `ipc-handlers.ts` 的 `getJwtSecret` **同源，
  改动需两处同步**）+ `findById` 校验用户仍存在 → fail-closed。
- `isTrustedSender(event)`：`BrowserWindow.fromWebContents(event.sender)` 非 null 且 `!isDestroyed()`。
  **注意：全仓此前没有任何 handler 校验 `event.sender`**（`chatHandlers.ts:73-83` 是已知反面案例，见 TODO），
  这是第一个按 SECURITY.md 落地的范式 —— 后续新 IPC 直接抄 `memoryHandlers.ts`。
- 删除走物理 `DELETE`（`deleteMemory`，带 `user_id`）；列表用 `listMemories`（含 `valid_to` 已关闭行展示「已失效」）。
- 响应统一 `IpcResponse`：删除返回 `{success:true,data:{deleted}}`（对齐 `AI_CONVERSATION_DELETE` 风格）。

**Why:** 下一批 C4/Gate C 要引用鉴权范式与门禁数字；`getJwtSecret` 双处副本是已知维护点。
**How to apply:** 新增「需当前用户上下文」的 IPC 时，复制 memoryHandlers 的 sender + JWT 两段校验，
不要退回渲染层传 userId；改 JWT secret 推导必须两处同改。

**门禁实测**：typecheck exit 0 / 全量 vitest `4190 passed | 1 failed`（既知 flaky
`cacheMonitor.getStats`，单跑 `37 passed`）/ eslint `0 errors, 108 warnings`（= C2 基线，零新增）/
`npx vite build` exit 0 / 铁律一红线 3 文件 `77 passed` / **改动行覆盖 419/419 = 100%**。
变异验证 5 处逐个变红还原：跳过 sender 校验 `2 failed`、禁用 id 校验 `1 failed`、
跳过 JWT 直接采信入参 `10 failed`、删除去二次确认 `1 failed`、`listMemories`→`listActiveMemories` `1 failed`。
> 「`deleteMemory` 去掉 `user_id`」这条变异被执行器以「削弱生产鉴权」为由拒绝，未执行、已还原。

**残余风险**：`getJwtSecret` 与 `ipc-handlers.ts` 各留一份推导；`handleSave`/`handleRestoreDefault` 的
`activeFile === AUTO_MEMORY_TAB` 早退是 UI 不可达的防御分支；browser 模式 `ai.memory` 恒失败
（诚实失败，不假装删除成功）；跨用户删除越权在**单测层**由 fake DB 断言，未做 E2E（归 C4/Gate C）。
