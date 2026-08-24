# Notus vs WeaveMD — Agent 功能差距分析

> 生成日期: 2026-08-24

## 一、Notus 核心 Agent 功能清单

### A. 后端引擎层 (lib/)

| # | 功能 | Notus 实现 | WeaveMD 现状 | 差距 |
|---|------|-----------|-------------|------|
| A1 | **持久化任务队列** | SQLite FIFO 队列 (`agent_task_queue`)，1s 轮询 worker，同 conversation 串行 | 无队列，`agentLoop.ts` 同步执行 | 🔴 缺失 |
| A2 | **Agent Session 状态机** | 10+ 状态 (created/queued/running/waiting_interaction/waiting_operation_confirmation/waiting_limit/waiting_retry/waiting_model_recovery/completed/failed/cancelled) | 3 状态 (idle/thinking/tool_calling) | 🔴 缺失 |
| A3 | **SSE 事件持久化+回放** | 所有事件写 `agent_run_events` 表，断线后增量回放 | 仅内存推送，断线丢失 | 🔴 缺失 |
| A4 | **Checkpoint/Resume** | LLM 调用前/工具执行中/等待交互前保存 checkpoint，可从任意点恢复 | 无 checkpoint | 🔴 缺失 |
| A5 | **租约机制 (Lease)** | 乐观并发控制，90s 租约 + 20s 续约，孤儿任务自动恢复 | 无 | 🔴 缺失 |
| A6 | **任务取代 (Supersede)** | 新消息到来时取消旧等待态任务 | 无 | 🟡 缺失 |
| A7 | **死循环检测** | 连续 3 次相同结果/2 次连续失败自动终止 | 仅固定 6 轮上限 | 🟡 缺失 |
| A8 | **文件快照+回滚** | session 创建时快照所有 .md 文件，支持一键回滚 | 无快照，无回滚 | 🔴 缺失 |
| A9 | **对话历史重写** | 编辑消息后删除后续消息+取消后续 session/task | 无 | 🟡 缺失 |
| A10 | **LLM 上下文预算** | `llmBudget.js` token 预算管理，85% 阈值停止加载可选工具 | `contextManager.ts` 80% 压缩 | 🟢 已有 |
| A11 | **多引擎联网搜索** | web_search 工具，按任务单独开启 | searchClient 已实现但未注入 Agent 循环 | 🟡 部分 |
| A12 | **工具 Schema 校验** | `validateToolInput()` 严格 JSON Schema 校验 | 无校验 | 🟡 缺失 |

### B. 工具系统 (agentTools.js)

| # | 工具 | Notus | WeaveMD | 差距 |
|---|------|-------|---------|------|
| B1 | `search_knowledge` | 混合搜索(向量+全文) | `searchKB` FTS5 | 🟢 已有 |
| B2 | `web_search` | 联网搜索 | 未注入 | 🟡 部分 |
| B3 | `read_file` | 读取笔记 | `readFile` | 🟢 已有 |
| B4 | `create_note` | 创建笔记 + operation_set 预览 | `createFile` proposal | 🟢 已有 |
| B5 | `preview_patch_files` | 多文件 old/new 补丁预览 | 无 | 🔴 缺失 |
| B6 | `preview_file_revision` | 全文修订稿 diff | `editBlocks` 部分 | 🟡 部分 |
| B7 | `preview_file_operations` | 文件系统操作(移动/重命名/创建目录) | `createFolder` | 🟡 部分 |
| B8 | `ask_question_card` | 结构化提问卡片 | 无 | 🔴 缺失 |
| B9 | `analyze_folder` | 目录结构分析 | 无 | 🔴 缺失 |
| B10 | `check_links` | 内部链接检查 | 无 | 🟡 缺失 |
| B11 | `get_task_activity` | 任务活动查询 | 无 | 🟡 缺失 |
| B12 | `load_skill` | 动态加载 Skill | `runSkill` | 🟢 已有 |
| B13 | MCP 动态工具 | 运行时注入 | 占位 | 🟡 缺失 |

### C. 前端组件层

| # | 功能 | Notus | WeaveMD | 差距 |
|---|------|-------|---------|------|
| C1 | **AgentWorkspace 编排层** | FileAgentWorkspace.js (984 行) 统一编排 | 分散在 AIAgentPanel/AIPanelSession/AgentTab | 🟡 架构差异 |
| C2 | **提问卡片 (ClarifyDrawer)** | 598 行，多题问答、条件依赖、阶段状态机 | IntentCard 简单候选按钮 | 🔴 缺失 |
| C3 | **对话抽屉 (ConversationDrawer)** | 搜索+Agent 状态标签+导出+日志查看 | history 视图简单列表 | 🟡 部分 |
| C4 | **文件 Diff 弹窗** | FileOperationDiffDialog 250 行，左列表+右 diff | RewritePreviewCard 行级 diff | 🟡 部分 |
| C5 | **Mention 预览弹窗** | 文件/目录/Skill 预览+缓存+预取 | 无预览弹窗 | 🔴 缺失 |
| C6 | **操作集 (Operation Set)** | 状态跟踪 (applied/stale/discarded/rolled_back...) + 批量操作 | fileOpProposals 简单 | 🟡 部分 |
| C7 | **模型选择器搜索** | 按名称/Provider/配置名搜索 | 简单下拉 | 🟡 缺失 |
| C8 | **Agent 日志时间线** | AgentLoopLogList 按轮次分组+耗时+thinking 折叠 | AgentStepTimeline 类似 | 🟢 已有 |
| C9 | **对话导出** | 导出为 Markdown | 无 | 🟡 缺失 |
| C10 | **附件/图片处理** | 图片分析+附件解析+图片整理进笔记 | 基础文件上传 | 🟡 部分 |

### D. 配置与扩展

| # | 功能 | Notus | WeaveMD | 差距 |
|---|------|-------|---------|------|
| D1 | **soul.md/memory.md/style.md** | 长期偏好+写作风格+人格参考，支持历史回滚 | 无 | 🔴 缺失 |
| D2 | **Skill 安装源** | 本地目录/Git/ZIP/Agent 草稿 | 磁盘 SKILL.md | 🟡 部分 |
| D3 | **MCP Server** | Notus 可作为 MCP Server 对外暴露 | 无 | 🟡 缺失 |
| D4 | **对话搜索** | 按标题/消息内容搜索 | 无 | 🟡 缺失 |

---

## 二、优先级分层

### P0 — 核心体验（必须做，与 Notus 差距最大的部分）

1. **A2: Agent Session 状态机扩展** — 从 3 状态扩展到 10+ 状态
2. **A4: Checkpoint/Resume 系统** — 任务可恢复，断线不丢失进度
3. **C2: 结构化提问卡片 (ClarifyDrawer)** — Agent 主动提问交互
4. **A1: 持久化任务队列** — 后台任务不阻塞 UI
5. **B5: preview_patch_files 工具** — 多文件补丁预览
6. **A8: 文件快照+回滚** — 一键撤销 Agent 所有修改

### P1 — 重要增强

7. **A3: SSE 事件持久化** — 断线重连后恢复
8. **A6: 任务取代机制** — 新消息优先
9. **A7: 死循环检测** — 防止 Agent 无限循环
10. **B2: 联网搜索注入 Agent 循环** — 完成已有的基础设施
11. **B9: analyze_folder 工具** — 目录分析
12. **C5: Mention 预览弹窗** — @ 引用体验
13. **C9: 对话导出** — 导出为 Markdown
14. **D4: 对话搜索** — 按标题/内容搜索

### P2 — 锦上添花

15. **A9: 对话历史重写** — 编辑消息后级联删除
16. **B10: check_links 工具** — 链接检查
17. **B11: get_task_activity 工具** — 任务活动查询
18. **C7: 模型选择器搜索** — 搜索过滤
19. **D1: soul.md/memory.md/style.md** — 个性化文件
20. **D2: Skill 安装源扩展** — Git/ZIP
21. **D3: MCP Server** — 对外暴露

---

## 三、WeaveMD 需要替换的现有功能

根据用户要求"有冲突直接改成参考项目的功能"：

| 现有功能 | 替换为 | 影响范围 |
|----------|--------|----------|
| agentLoop.ts 同步 6 轮循环 | 持久化队列 + session 状态机 + checkpoint | 主进程核心重写 |
| 3 状态 processStatus | 10+ 状态 session lifecycle | agentStore + 所有 UI 状态展示 |
| IntentCard 简单候选按钮 | ClarifyDrawer 结构化提问卡片 | 渲染端新组件 |
| fileOpProposals 简单提案 | Operation Set 系统（状态跟踪+批量+回滚） | agentStore + PreviewCard |
| AIPanelHome/AIPanelSession/AIPanelSettings 三视图 | FileAgentWorkspace 统一编排层 | 渲染端架构调整 |

## 四、技术风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| 主进程 agentLoop 重写影响所有 AI 功能 | 高 | 保留旧接口适配层，渐进迁移 |
| SQLite Schema 变更影响现有数据 | 高 | 迁移脚本，向后兼容 |
| SSE 持久化增加存储开销 | 中 | 事件截断+过期清理 |
| 前端组件大规模重构 | 中 | 保留旧组件，新组件并行开发 |
| checkpoint 序列化/反序列化复杂 | 中 | 精简 checkpoint 数据结构 |
