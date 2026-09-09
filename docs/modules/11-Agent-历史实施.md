# AI 代理面板 — 历史实施记录

> 拆分自 [11-AI代理面板-Agent.md](./11-AI代理面板-Agent.md) §7-§13
> 最后更新：2026-09-09

---

## 7. 分期实施（总策略）

1. ✅ **基建**（第1期，2026-08-14）：DB 迁移（ai_* 4 表 + kb_* 预留）、`ai:*` IPC 骨架、设置面板 AI 配置、知情同意页、导航栏按钮
2. ✅ **Chat 闭环**（第2期，2026-08-14）：llmClient（SSE 流式，当时支持 Ollama/远程，现收敛 remote-only）+ 面板 UI + 会话持久化 → 可对话；远程 DeepSeek 真连验证通过
3. ✅ **知识库**（第3期，2026-08-15）：导入 → kb 表 → FTS5 关键词召回 →（当时 embeddingClient 双路召回，现收敛仅 FTS5、向量已去除）+ 拒答 + 出处 + 置顶；KB-06 保存防抖重嵌入/删除清理
4. ✅ **Agent 能力**（第4期，2026-08-15)：skills 体系（3 内置 + 用户扩展）+ 工具注册表 + agentLoop 函数调用循环 + 意图识别/提问卡片 + 上下文压缩 + 失败兜底；consent 分层（allowNetwork + allowSend）
5. ✅ **块级改写**（第5期，2026-08-15 已交付）：选区触发 + 面板 @ 兜底 + 定向块编辑协议 + 红删绿增预览 + 确认写入（可撤销）；主进程只产 LLM 文本、块级替换在渲染侧；e2e 4 用例 + 门禁全绿
6. ✅ **收尾**（第6期，2026-08-15）：**KB 参数持久化已交付**（ai_config 6 列幂等迁移 + `kb:get/setSettings` + 主进程消费修正 + 真库三态实证）+ **stretch `editBlocks` 已交付**（仅产 proposal 不落盘）；真 MCP 进程管理、`fetchContext7`/`fetchFirecrawl` 工具、GitHub 自取 skill 继续延
7. ✅ **第 7 期辅助创作强化**（2026-08-15，批次①~⑦ 全部交付）：A4 选区改写叶序错位修复、A1 当前文档上下文注入 + 意图补词 + 从 0 到 1 整篇写、A2 混合类型工具栏、A3 选区改写高亮 + 取消胶囊、B1 `/ @` 自动补全、B2 命名「智能体」、B3 双 Tab 合并、C1 视觉美化

> 门禁全绿：tsc 0 | vitest 93 files/1338 tests | lint 0 | Playwright 24/24 | vite build

## 8. 2026-08-16 ai-panel-ux-optimize 变更

- **③ 彻底去除 ollama**：`ChatBackend` 收敛为 `'remote'`；KB 降级**仅 FTS5**
- **④ ModelForm**：新增「当前提供商」状态行 + 断开连接
- **②** composer 草稿跨视图保留
- **①** 选区改写整块渐变蓝高亮 + 左端取消胶囊
- **⑤** AI 面板字号整体放大一档

## 9. 2026-08-21 AI 面板体验优化

纯 UI 优化，无数据模型/IPC/后端变更。

### 主界面（home）

- **R1 最近会话删除**：每个会话项右侧 🗑 图标
- **R2 历史会话列表**：「View All」切换到 history 视图
- **R3 会话标题栏**：session 视图顶部栏布局

### 会话内界面

- **R4 /compact 命令**：输入框支持 `/compact` 触发上下文压缩
- **R5 上下文指示器**：底栏绿/黄/红圆点 + token 估算数
- **R6 改写消息显示**：选区改写模式下用户指令入会话
- **R7 改写预览格式**：仅保留 diff + AI 改动说明

### 编辑主区

- **R8 字体统一**：`Consolas` + `KaiTi`/`楷体`

## 10. Notus Agent 克隆（2026-08-24）

> 深度模仿 Notus 项目 AI Agent 功能，21 项全部实现。

### 核心架构变更

| 系统 | 文件 | 说明 |
|------|------|------|
| 任务队列 | `agentTaskQueue.ts` / `agentTaskWorker.ts` | SQLite FIFO 队列，同会话串行 |
| Session 状态机 | `agentSession.ts` | 11 种状态 + DB 持久化 |
| Checkpoint/Resume | `agentCheckpoint.ts` | 断线恢复 |
| SSE 事件持久化 | `agentEventStore.ts` | persistAndSend + replayFromSeq |
| 文件快照+回滚 | `agentSnapshot.ts` | createSnapshot + rollbackToSnapshot |
| 死循环检测 | `agentLoopGuard.ts` | 3x 相同结果 / 2x 连续失败 |

### 新增工具（7 个，共 14 个）

| 工具 | 功能 | 类型 |
|------|------|------|
| `ask_question_card` | 结构化提问卡片 | 交互 |
| `preview_patch_files` | 多文件补丁预览 | 预览 |
| `preview_file_revision` | 全文修订预览 | 预览 |
| `web_search` | 联网搜索 | 搜索 |
| `analyze_folder` | 目录结构分析 | 分析 |
| `check_links` | 内部链接检查 | 检查 |
| `get_task_activity` | 任务活动查询 | 查询 |

## 11. 写控制与任务安全（2026-08-24 ~ 2026-08-25）

> R1~R7 全部交付。

| 需求 | 说明 |
|------|------|
| R1 写模式切换 | `writeMode: 'auto' \| 'manual'`，持久化到 ai_config |
| R2 staleness detection | MD5 contentHash 二次校验，哈希不一致拒应用 |
| R3 Agent 交互暂停/恢复 | ask_question_card → 暂停 → 用户回答 → 恢复 |
| R4 待处理状态 UI | QuestionCard + waiting 状态标识 |
| R5 事件持久化 | persistAndSend + visibilitychange 补发 |
| R6 IndexedDB 草稿恢复 | draftStore.ts + 防抖保存 |
| R7 模块集成 | DeadLoopDetector + Checkpoint + Snapshot + 回滚 |

## 12. Agentic RAG 与 HyDE（2026-09-07）

### Agentic RAG（AGT-20）

`searchKB` 从仅 kbQa 意图 → 所有非 chat 意图均可自主调用。

| 意图 | searchKB | 说明 |
|------|:---:|------|
| chat | ❌ | 闲聊不提供工具 |
| kbQa | ✅ | 知识库问答 |
| rewrite | ✅ | 改写时检索参考资料 |
| create | ✅ | 创作时检索素材 |
| tech | ✅ | 技术问题检索笔记 |
| web | ✅ | 网页搜索时检索本地知识库 |

### HyDE（AGT-21）

LLM 生成假设性文档 → embedding → 向量检索 → 语义匹配更精准。增加约 1-2s 延迟。

### searchMode（AGT-22）

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `hybrid` | FTS5 + 向量 + 标题三路 RRF（默认） | 通用查询 |
| `fts5` | 纯关键词检索 | 精确术语 |
| `vector` | 纯向量语义检索 | 模糊/改述 |

## 13. 优化方案（2026-09-08 ~ 2026-09-09）

### 13.1 IPC 通道名不匹配修复

`ask_question_card` 卡死根因：`persistAndSend` 拼接通道名与 preload 监听不匹配。修复：新增 `persistOnly()` + 直接 IPC 发送。

### 13.2 deleteLocalFile 工具

与 `editLocalFile` 形成读-写-删工具链。安全限制：系统路径黑名单 + 仅删除文件和空文件夹。

### 13.3 QuestionCard 底部滑出面板

从 AgentTab 内联卡片重构为 AIPanelSession 底部面板（bottom sheet）。

### 13.4 系统通知

窗口未聚焦时发送 Windows 系统通知，点击恢复窗口。

### 13.5 deleteLocalFile 文件树刷新 + 编辑器同步（2026-09-09）

| 任务 | 修复 |
|------|------|
| deleteLocalFile 刷新 | 返回值增加 parentDir + agentStore 条件匹配 + 刷新父目录 |
| editLocalFile 同步 | readDisk → updateContent 同步编辑器 |
| preview_file_revision 同步 | proposal.newContent → updateContent |
| web_search 配置检查 | 未配置时不注入，避免 LLM 调用失败 |
| QuestionCard 美化 | 渐变/阴影/卡片/单选按钮组/字体 |

**门禁**：tsc 0 | vitest 23/23 | vite build ok
