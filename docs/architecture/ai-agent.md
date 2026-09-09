# AI/Agent 系统架构

> 最后更新：2026-09-09
> 详细文档：[11-AI代理面板-Agent.md](../modules/11-AI代理面板-Agent.md)

## 系统概览

AI/Agent 系统是 WeaveMD 的智能创作辅助模块，基于远程 OpenAI 兼容 API（remote-only），提供：

- 函数调用循环（Agent Loop）
- 24+ 工具（只读/写入/交互/搜索）
- 意图路由（规则启发式 6 类）
- 上下文压缩
- Skills 体系
- 写控制（auto/manual）

## Agent 循环

`agentLoop.ts` 核心流程：

```
用户消息 → 意图识别 → 工具集确定 → 系统提示组装
    ↓
LLM 流式调用（带 tools 定义）
    ↓
工具执行（只读并行 + 写入串行）
    ↓
结果返回 LLM → 下一轮（最多 12 轮）
    ↓
死循环检测 → 完成/错误
```

### 关键参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| maxRounds | 12 | 最大轮次 |
| TOOL_EXEC_TIMEOUT_MS | 30000 | 单工具超时 |
| maxConsecutiveFailures | 2 | 连续失败终止 |

## 意图路由

`intentRouter.ts` 规则启发式分类（纯函数，无 LLM 依赖）：

| 意图 | 关键词示例 | 可用工具 |
|------|-----------|----------|
| chat | 闲聊/通用问题 | 无工具 |
| rewrite | 修改/润色/删除 | editBlocks + 文件操作 + searchKB |
| create | 写/创作/新建 | createFile + editBlocks + searchKB |
| tech | 代码/技术问题 | 同 create |
| kbQa | 知识库/笔记 | searchKB |
| web | 搜索/网站/URL | web_search + research_search + searchKB |

**强信号加权**：输入含 URL 或"网站"等强信号词时，web 意图得分 ×1.5。

## 工具系统

工具注册表 `toolRegistry.ts` 维护 24+ 工具：

### 只读工具

| 工具 | 说明 |
|------|------|
| listFiles | 数据库文件列表 |
| readFile | 读取数据库文件 |
| readLocalFile | 读取本地文件 |
| listLocalDirectory | 浏览本地目录 |
| searchKB | 知识库检索（FTS5） |
| web_search | 联网搜索（需配置） |
| research_search | 研究搜索 |
| analyze_folder | 目录结构分析 |
| check_links | 内部链接检查 |
| get_task_activity | 任务活动查询 |
| list_skills / get_skill_details | 技能系统 |

### 写入工具

| 工具 | 说明 | 确认 |
|------|------|------|
| createFile | 创建文件（DB + 磁盘） | auto/manual |
| createFolder | 创建文件夹 | auto/manual |
| editLocalFile | 编辑本地文件 | auto/manual |
| deleteLocalFile | 删除本地文件/空文件夹 | auto/manual |
| editBlocks | 块级编辑（仅产 proposal） | manual |
| preview_file_revision | 全文修订预览 | manual |
| preview_patch_files | 多文件补丁预览 | manual |
| renameFile / moveFile / deleteFile | 文件操作 | auto/manual |

### 交互工具

| 工具 | 说明 |
|------|------|
| ask_question_card | 结构化提问（text/choice/confirm） |
| runSkill | 执行 Skill |

## 写控制

| 模式 | 行为 |
|------|------|
| `auto` | AI 直接执行写操作 |
| `manual` | 弹确认卡片（红删绿增预览） |

**staleness detection**：editBlocks proposal 生成时计算 MD5 contentHash，确认时二次校验。

## 任务队列

```
用户消息 → agent_task_queue 入队
    ↓
agentTaskWorker 1s 轮询
    ↓
agentSession 状态机（11 种状态）
    ↓
agentLoop 执行
    ↓
agentEventStore 持久化 + IPC 推送
```

### Session 状态

created → queued → running → waiting_interaction / waiting_operation_confirmation → completed / failed / cancelled / superseded

## 搜索配置

`web_search` 工具可用性：

1. 从 `ai_search_config` 表读取配置
2. 检查 `enabled` 和 API key
3. 未配置时不注入（避免 LLM 调用失败）
4. 已配置时对所有非 chat 意图可用
