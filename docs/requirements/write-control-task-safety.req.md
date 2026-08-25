# 写控制与任务安全模块 — 需求文档

> 参考：Notus 项目 Write Control & Task Safety 模块
> https://github.com/dnwwdwd/Notus

## 1. 背景

WeaveMD 已有完整的 AI Agent 基础设施（任务队列、会话状态机、检查点、事件存储、文件快照、死循环检测），但多个关键模块**已实现却未集成到主循环**。同时缺少 Notus 的两个核心新特性：写预览版本对比和 IndexedDB 草稿恢复。

本需求将 Notus 的 6 项写控制与任务安全特性适配到 WeaveMD 架构中。

## 2. 需求清单

### R1：写操作模式切换（auto-apply vs manual review）

**Notus 原文**：Choose auto-apply for qualifying writes, or require manual review for every file change.

**WeaveMD 现状**：`agentStore.autoApplyRewrite` 仅控制 `editBlocks` 改写提案。`createFile`/`createFolder` 始终需要手动确认。

**需求**：
- 将 `autoApplyRewrite` 泛化为 `writeMode`，覆盖所有写操作类型（editBlocks / createFile / createFolder）
- 用户可在设置中选择：`'auto'`（符合条件自动应用）/ `'manual'`（全部手动确认）
- `manual` 模式下，所有写操作必须经过用户确认才能落盘
- `auto` 模式下，`editBlocks` 和 `createFile`/`createFolder` 可自动应用（但保留撤销能力）
- 设置持久化到 `ai_config` 表

**验收标准**：
- AC-R1-1：设置页可切换写模式（auto / manual），切换后持久化
- AC-R1-2：`manual` 模式下，editBlocks/createFile/createFolder 均弹出确认卡片
- AC-R1-3：`auto` 模式下，单文件 editBlocks 自动应用并显示成功提示
- AC-R1-4：`auto` 模式下，createFile/createFolder 自动创建并显示成功提示
- AC-R1-5：所有自动应用的写操作均入 undo 栈，可一键撤销

### R2：写预览版本对比（staleness detection）

**Notus 原文**：Every write preview is compared against the current version of the target file before applying; if the file has changed, the preview is returned rather than silently overwriting.

**WeaveMD 现状**：`editBlocks` proposal 生成时不记录文件内容哈希。用户确认时直接应用，不检查文件是否已被编辑。

**需求**：
- 在 proposal 生成时，记录目标文件的内容哈希（SHA-256 或 MD5）
- 用户确认应用时，重新计算当前文件哈希并与记录值对比
- 哈希一致 → 正常应用
- 哈希不一致 → 拒绝静默覆盖，显示「文件已变更」提示 + 新旧 diff 对比，让用户重新确认
- 适用于 `editBlocks`（块级改写）和 `createFile`（覆盖已有文件时）

**验收标准**：
- AC-R2-1：proposal 生成时携带 `fileHash` 字段
- AC-R2-2：确认应用时对比哈希，一致则正常应用
- AC-R2-3：哈希不一致时显示「文件已变更」警告卡片，含新旧 diff
- AC-R2-4：用户可在警告卡片上选择「仍要应用」或「取消」
- AC-R2-5：createFile 覆盖已有文件时同样执行哈希对比

### R3：Agent 提问内联卡片（已有，验证集成）

**Notus 原文**：Agent questions appear as inline cards; answering resumes the same task.

**WeaveMD 现状**：`ask_question_card` 工具 + `IntentCard` 组件已实现。

**需求**：
- 验证 `ask_question_card` 工具正确触发 `waiting_interaction` 状态
- 验证用户回答后任务从 `waiting_interaction` 恢复为 `running`
- 验证切换会话后返回原会话，提问卡片和任务状态正确恢复

**验收标准**：
- AC-R3-1：Agent 调用 `ask_question_card` 时，渲染进程显示内联提问卡片
- AC-R3-2：用户回答后，任务自动恢复执行（状态 running）
- AC-R3-3：切换会话再返回，提问卡片和待回答状态保留

### R4：待处理状态保留（pending state retention）

**Notus 原文**：Pending confirmation, pending answers, recoverable failures, and interrupted tasks are all retained in conversation history.

**WeaveMD 现状**：会话状态机支持 `waiting_interaction`/`waiting_operation_confirmation`/`waiting_retry`/`waiting_model_recovery` 等状态，但渲染侧对这些状态的展示和恢复未完整验证。

**需求**：
- 待确认的写操作（proposal）在对话历史中持久显示，刷新后不丢失
- 可恢复的失败（`waiting_retry`/`waiting_model_recovery`）在对话历史中显示重试入口
- 中断的任务（浏览器关闭/刷新后重新打开）在对话历史中显示恢复入口
- 所有 `waiting_*` 状态的消息在会话列表中可见

**验收标准**：
- AC-R4-1：待确认的写操作 proposal 卡片在刷新后仍可操作
- AC-R4-2：`waiting_retry` 状态显示「重试」按钮，点击恢复任务
- AC-R4-3：中断的任务显示「恢复」入口，点击从检查点续跑
- AC-R4-4：会话列表中 `waiting_*` 状态会话有视觉标识

### R5：任务事件持久化先于 SSE 推送

**Notus 原文**：Task events are persisted before being pushed via SSE, so tool records and final replies survive page refreshes, browser disconnects, and app restarts.

**WeaveMD 现状**：`agentEventStore.ts` 已实现 `persistAndSend()`（先写 DB 再推 IPC），但 `agentLoop.ts` 和 `agentTaskWorker.ts` 直接用 `sendStream()` 推 IPC，绕过了持久化。

**需求**：
- 将 `agentLoop.ts` 中所有 `sendStream()` 调用替换为 `persistAndSend()`
- 将 `agentTaskWorker.ts` 中完成/错误事件改为 `persistAndSend()`
- 渲染进程断线重连时，调用 `replayFromSeq(lastSeq)` 补发丢失事件
- 保留现有 IPC 通道不变，`persistAndSend` 内部先写 DB 再推 IPC

**验收标准**：
- AC-R5-1：`agentLoop.ts` 中 chunk/tool/done/error 事件均经 `persistAndSend()` 持久化
- AC-R5-2：`agentTaskWorker.ts` 中 session 完成/失败事件经 `persistAndSend()` 持久化
- AC-R5-3：刷新页面后，当前会话的工具调用记录和最终回复正确恢复
- AC-R5-4：`replayFromSeq()` 能正确补发指定 seq 之后的所有事件

### R6：发送前输入 IndexedDB 草稿恢复

**Notus 原文**：Pre-send task input is saved in browser IndexedDB; text, Mentions, attachments, and image metadata can all be recovered in the browser.

**WeaveMD 现状**：`AIPanelComposer` 的草稿存储在 `agentStore.draft`（内存），刷新后丢失。

**需求**：
- 将 composer 草稿（文本、@Mentions 列表、附件元数据）持久化到 IndexedDB
- 草稿在用户输入时防抖保存（300ms debounce）
- 页面刷新/重新打开后自动恢复草稿到 composer
- 消息发送成功后清除对应草稿
- 每个会话独立草稿（按 conversationId 索引）

**验收标准**：
- AC-R6-1：输入文本后 300ms 自动保存到 IndexedDB
- AC-R6-2：页面刷新后，composer 自动恢复上次输入的文本和 Mentions
- AC-R6-3：消息发送后，对应草稿从 IndexedDB 清除
- AC-R6-4：切换会话时，保存当前草稿并恢复目标会话草稿

### R7：已实现模块集成（死循环检测 + 检查点 + 完整快照）

**WeaveMD 现状**：三个模块已实现但未集成到主循环：
- `agentLoopGuard.ts`（DeadLoopDetector）— 未在 agentLoop 中实例化
- `agentCheckpoint.ts`（save/load）— agentLoop 主循环未调用
- `agentSnapshot.ts`（完整内容快照）— Worker 中仅做骨架快照

**需求**：
- R7a：在 `agentLoop.ts` 中集成 `DeadLoopDetector`，替换硬编码 `MAX_ROUNDS = 6`
- R7b：在 `agentLoop.ts` 每轮结束时调用 `saveCheckpoint()`，支持断点续跑
- R7c：在 `agentTaskWorker.ts` 中调用 `createSnapshot()` 备份完整文件内容，支持回滚
- R7d：渲染侧提供「回滚到快照」操作入口

**验收标准**：
- AC-R7-1：agentLoop 使用 DeadLoopDetector 检测死循环并提前终止
- AC-R7-2：每轮结束自动保存检查点，中断后可从检查点恢复
- AC-R7-3：任务开始前创建完整文件内容快照
- AC-R7-4：用户可对已完成任务执行「回滚到快照」操作

## 3. 已对齐问题清单

| # | 问题 | 结论 |
|---|------|------|
| Q1 | Notus 使用 Next.js + IndexedDB，WeaveMD 是 Electron + SQLite，IndexedDB 方案是否合适？ | 合适。渲染进程侧草稿用 IndexedDB（不走 IPC），主进程状态用 SQLite，分层清晰。 |
| Q2 | 写模式 `auto` 是否应该区分 editBlocks 和 createFile 的自动应用条件？ | 暂不区分。统一 `auto`/`manual` 开关，后续可按类型细分。 |
| Q3 | 哈希对比用 SHA-256 还是 MD5？ | 用 MD5（与 agentLoopGuard 的 DeadLoopDetector 一致，性能足够）。 |
| Q4 | 事件持久化是否会影响流式性能？ | `persistAndSend()` 是同步写 SQLite（better-sqlite3 同步驱动），延迟 <1ms，可忽略。 |
| Q5 | 检查点恢复时，是否需要恢复 LLM 流式状态？ | 不需要。检查点恢复从上一轮结束处重新调用 LLM，不恢复流式中间状态。 |
| Q6 | R7 的四个子需求是否可以分期交付？ | 可以。R7a（死循环检测）独立，R7b（检查点）依赖 R5（事件持久化），R7c/R7d（快照）独立。 |

## 4. 范围控制

**已完成**：R1（写模式切换，2026-08-25）、R2 + R5 + R7（R7a/R7b/R7c/R7d 全部）。
**后续迭代**：R3（提问卡片验证）、R4（待处理状态 UI）、R6（IndexedDB 草稿）。
**范围外**：
- MCP Server 写操作控制（Notus 有，WeaveMD 延期）
- Skill 文件写控制（Notus 有，WeaveMD 不涉及）
- `soul.md`/`memory.md`/`style.md` 版本管理（Notus 有，WeaveMD 不涉及）
- Web 端 SSE 重连（WeaveMD 是 Electron，走 IPC）
