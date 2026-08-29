# Diff 卡片优化 + 提问系统通知 — 需求

## R1: Diff 汇总卡片

**现状**：`EditBlocksPreviewCard` 和 `RewritePreviewCard` 各自独立渲染，无统一汇总视图。

**目标**：当 AI 完成文件修订后，在消息流末尾显示一个汇总卡片：
- 标题：「N 个文件修订」
- 统计行：「已应用 n 个，已回滚 k 个，已废弃 b 个」（灰色小字）
- 操作按钮：「查看详情」（打开居中 diff 面板）+ 「全部应用」+「全部废弃」
- 点击「查看详情」→ 居中 diff 面板（`fixed inset-0 z-50`），左文件列表 + 右 diff 视图（红删绿增）
- 面板使用 macOS 三色圆点标题栏样式（对齐 `RewriteDetailModal`）

**数据源**：`agentStore.editBlocksProposals` + `rewriteStore.pendingMultiRewrite`

**变更清单**：
- `src/render/components/AIAgent/cards/EditBlocksPreviewCard.tsx` — 重构为汇总卡片
- `src/render/components/AIAgent/cards/EditBlocksDetailModal.tsx` — 居中 diff 面板（已有，优化样式）

## R2: 提问卡片系统通知

**现状**：`QuestionCard` 仅在 AI 面板内渲染，用户不在面板时无感知。

**目标**：当 AI 发起提问（`pendingInteraction` 变为非空）时：
- 主进程发送 Windows 系统通知（右下角）
- 通知标题：「WeaveMD 智能体需要您的回答」
- 通知正文：第一个问题的文本（截断到 100 字符）
- 点击通知 → 聚焦 WeaveMD 窗口

**变更清单**：
- `src/shared/constants.ts` — 新增 IPC channel `NOTIFICATION_SEND`
- `src/main/ipc-handlers.ts` — 注册通知 IPC handler（Electron Notification API）
- `src/main/preload.ts` — 暴露 `notification.send()` 桥接
- `src/main/window.ts` — 新增 `focusWindow()` 方法
- `src/render/stores/agentStore.ts` — `setPendingInteraction` 时触发通知 IPC
- `src/shared/types.ts` — WeaveMDApi 接口新增 notification

## 验收标准

1. AI 修订多个文件后 → 消息流末尾出现汇总卡片（统计 + 三个按钮）
2. 点击「查看详情」→ 居中 diff 面板（红删绿增，左文件列表右 diff）
3. AI 发起提问 → Windows 右下角系统通知
4. 点击通知 → WeaveMD 窗口聚焦到前台
5. typecheck 0 新增 / vitest 全绿 / lint 0 新增
