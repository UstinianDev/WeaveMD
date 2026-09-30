---
name: agent-memory-optimize-3-d3-done
description: D3 六.1「执行轨迹→Skill 提炼」交付状态、queue supersede 抢位坑、整模块 mock 导出坑、双防线组合变异、门禁实测数字
metadata:
  type: project
---

# agent-memory-optimize-3 · D3（六.1 轨迹→Skill 提炼）交付（2026-09-30）

**状态**：四门禁全绿、**未提交**；工作区同时含 Gate D（D1/D2）的未提交改动（本任务未触碰其
`db/index.ts` 22/0、`memoryPolicy.ts` 120/6、`kbSearch.ts`、`agentHandlers.ts` 等 numstat 原样）。

## 交付形态（与裁定一致）

- **纯文件系统、零 DB 表**：`userData/skills/_auto/`（生效）+ `_auto/_drafts/`（草稿），
  front matter 加 `status: draft|active` + `source: auto`。
- 半自动：`skillDistiller` 只写草稿；**`skillAutoStore.approveDraftSkill` 是唯一 draft→active 入口**。
- 新增 `db/ai.ts` 两个函数：`getConversationMessagesPage`（`rowid` 游标分页 + `user_id` + 全参数化）、
  `hasCompletedAgentTask`（`status='completed'`，req 写的 `'done'` 在枚举里不存在，实为 `completed`）。
- 三处无参 `loadSkills()` 修复 → 新模块 `skills/skillPaths.ts` 提供 `getDefaultSkillDirs()`。
- IPC 三通道 `ai:skilldraft:list/approve/reject`，复用 `memoryHandlers` 的 `isTrustedSender` +
  **新导出的 `resolveUserId`**（JWT 口径单点）。

## 非显然坑（下次别再踩）

1. **`AgentTaskQueue.enqueue` 会 supersede 同会话旧 pending，且不分任务类型**
   （`agentTaskQueue.ts:supersedeOldTasks`）。`memory_extract` 与 `skill_distill` 同点入队
   （`AI_STREAM_DONE` 之后）会互相顶掉。解法：两者的 pending 去重都按「同会话**任意** pending」判定
   → 提炼给 memory 让位，下一轮补入（队列 1s 轮询远快于人类轮次，必然能补上）。
   **Why**：改 supersede 语义会动 C2 已交付的后台任务链。
   **How to apply**：以后任何复用该队列的后台任务类型，都要先查 pending 再入队，别只查同类型。

2. **`agentContext.test.ts:84` / `toolRegistry.test.ts:14` 对 `@main/ai/skills/skillLoader`
   是整模块 mock 且只给 1~2 个导出** → 从 skillLoader 新增具名 import 会让现有测试崩。
   **How to apply**：给 skillLoader/agentContext 加新依赖时放进**新模块**（如 `skillPaths.ts`），
   别往 skillLoader 上挂新 import。同类整模块 mock 见 [[weavemd-test-env-pitfalls]]。

3. **双防线的单点变异测不出红**：`_auto` 的 `status: active` 闸与 `scanUserSkillsDir` 的
   `status: draft` 过滤互为冗余 —— 只改一处，测试仍绿。变异验证必须**组合改两处 + 扫 `_drafts`**，
   验收 3（草稿不进 list_skills/prompt）才红（实测 5 failed）。

4. `ai_messages.id` 是 **TEXT** 主键（UUID / 确定性串）→ 数字游标只能走隐式 **rowid**；
   `beforeId` 语义是「rowid 上界（不含）」，SQL 必须投影 `rowid AS row_id` 才能续页。

5. **`.eslintrc.cjs` `no-console` allow 仅 `['warn','error']`** → 新文件用 `console.log` 会加 warning
   （基线 108）。信息型日志要么降级 `console.warn`，要么 `// eslint-disable-next-line no-console`
   （`agentLoop.ts` 有先例）。

## 门禁实测（2026-09-30）

- `npm run typecheck` exit 0
- `npx vitest run` → **180 文件 / 4315 例全绿**（基线 175/4235 → +5 文件 +80 例，两条既知 flaky 本轮未红）
- `npx eslint src/ --ext .ts,.tsx` → **0 errors / 108 warnings（= 基线）**
- `npx vite build` exit 0
- 改动行覆盖（CLI `--coverage.include` 9 个主进程文件）→ **总 88% 行 / 80.76% 分支**；
  `skillPaths` 100%、`skillDistiller` 98.63%、`skillLoader` 98.49%、`skillDraftHandlers` 92.96%、
  `skillAutoStore` 90.29%、`agentContext` 91.36%、`db/ai` 88.34%、`agentTaskWorker` 73.39%（含既有未覆盖）、
  `skillManager` 55.81%（`rescanSkills`/`getSkillsStats` 全仓无调用方）
- **变异 8 处**逐个变红后还原复绿：M1 skillManager 传空目录 / M2 无参默认目录 / M3 draft 过滤 /
  M4 组合放开草稿可见 / M5 name 正则 / M6 `isPathInside` 恒真 / M7 确认后仍 draft / M8 分页丢 `user_id`

## 未做（记 TODO，超出 D3 范围）

- `sendRoutes.ts` `routeSlashSkill` 仍丢弃技能名（改渲染→主进程载荷结构）
- `skillManager.isSkillEnabled` 仍无调用方；`getManagedSkills().source` 恒为 `'user'`（含内置）
- 渲染侧 `SkillsPanel` / `agentStore` 草稿动作无单测（未计入覆盖）
- 草稿目录**不按 user_id 分目录**（纯 FS 选型的固有结果），IPC 已鉴权但多用户共用同一 userData
