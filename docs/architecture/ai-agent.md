# AI/Agent 系统架构

> 最后更新：2026-09-24
> 详细文档：[11-AI代理面板-Agent.md](../modules/11-AI代理面板-Agent.md)

## 系统概览

AI/Agent 系统是 WeaveMD 的智能创作辅助模块，**remote-only**（Ollama 已移除，`ChatBackend` 收敛为 `'remote'`），
按 `ai_config.protocol` 分流到 **OpenAI 兼容** 或 **Anthropic** 两条协议，提供：

- 函数调用循环（Agent Loop）
- 30 个工具（5 核心 + 25 延迟加载；只读/写入/交互/搜索）
- 意图路由（规则启发式 6 类）
- 上下文压缩
- Skills 体系
- 写控制（auto/manual）

### 协议分流（2026-09-23 接线）

`ModelProtocol = 'openai' | 'anthropic'`（`src/shared/ai/model.ts`），落 `ai_config.protocol` 列（默认 `openai`）。
**6 个非工具调用点**按 `protocol === 'anthropic'` 三元分流到 `streamAnthropicCompletion` / `streamChatCompletionWithRetry`：

| 调用点 | 文件 | 说明 |
|--------|------|------|
| HyDE 假设性文档生成 | `agent/agentContext.ts:247` | 只读文本，可安全分流 |
| 压缩 cache-safe fork | `contextManager.ts:128` | 带 tools 但只读文本、不消费 `tool_use` |
| 上下文压缩 | `contextManager.ts:158` | 同上 |
| Chat 直连 | `ipc/chatHandlers.ts:305` | — |
| 改写预览 | `rewrite.ts:103` | — |
| Skill 执行 | `skills/skillLoader.ts:222` | — |

**`agent/agentLoop.ts:271` 主循环故意不分流** —— `anthropicClient` 无 tools 支持，
分流会打爆创作 Agent 工具循环（createFile / editBlocks / searchKB / ask_question_card）。
要拿到主循环收益须先补 Anthropic tool-use 全套（tools 转换 + `tool_use` 流式解析 + `tool_result` 回填），属独立 L3。

Anthropic 路径的 system 末块带 `cache_control: { type: 'ephemeral' }` 断点（`anthropicClient.ts:243`），
usage 从 `message_start` / `message_delta` 解析出五字段，`costTracker` 按 0.1×（读）/ 1.25×（写）分列计价。

### 多模态消息（B6 五-1/五-2/五-3，2026-09-26 接线）

`LlmMessage.content` / `StreamChatCompletionOptions.messages` 放宽为 `string | ContentPart[]`
（`ContentPart = {type:'text'} | {type:'image_url', image_url:{url}}`），**纯文本消息走原路径零改动**：

| 环节 | 实现 |
|------|------|
| 序列化两套分流 | OpenAI：`llmClient.resolveContentForWire` 本地路径读盘转 `data:` URL（坏路径→占位文本 part）；Anthropic：`anthropicCompat.toAnthropicContent` 转 `text`/`image` block（data URL→base64、http→url source） |
| 分流判定 | `resolveModelProtocol`：显式 `ai_config.protocol` 优先（上表 6 处范式不变）→ 缺省按 `isAnthropicModel(model)` 回退；识别链路首个生产调用方 |
| 注入点（主进程） | `agentMedia.injectImagesIntoMessages` / `buildImageParts`，Chat（`chatHandlers.runChatFlow`）与 Agent（`prepareAgentContext`）共用；**当前轮图片全量、历史行限最近 3 张**（`selectRecentImageIds`，Q4 同口径）；GIF 附「按首帧处理」text part |
| vision 检测 | `modelDiscovery.supportsVision(modelId)` **发送前**判定；不支持 → 不注入任何图片 part + 追加 `VISION_DEGRADED_NOTICE` system 消息（**未知模型保守判否**，避免整条请求 400） |
| 图片落盘 | `image/imageStorage.ts`：`userData/attachments/{userId}/{convId}/{id}.{ext}`，消息存**相对路径**、读取重建；发送链路 `persistIncomingAttachments` 内完成（无新增 IPC 通道）；svg 拒绝 / bmp 栅格化 / gif 原样 / 10MB 上限 |
| md 相对路径图片（B9 三-3②） | `files/mdImageResolver.ts`：解析基准恒为 **md 所在目录**（非 cwd/userData），`workspaceRoot` 越界拦截（`../../` 出界先于存在性检查，不读工作区外），缺失/移动失效结构化降级；`agentContext` 用 `buildMdImageContext` 复用 `buildImageParts` 注入当前轮（上限 3 张、Q4 同口径），缺失/越界/超限以文本提示随消息注入，远程/data 引用跳过；**图片向量（`imageIndexer`/`images_vec`）不动，范围外** |
| 识别（五-3） | `image/imageRecognition.recognizeImageAttachments` 在 Chat/Agent 两条 IPC 链路调用：不支持 vision 不发请求直接标失败，成功描述写 `parsed_attachments.content`（附件入 KB 可检索文本），失败态「图片未成功识别」 |
| 压缩丢图（Q4） | `buildCompressed` 保留最近 **3** 张图片 part，更早原位降级为 `IMAGE_DEGRADED_PLACEHOLDER`；`summarizeViaLlm` 剥图（非 vision 模型压缩不再失败） |
| 事件/checkpoint | `agentEventStore.sanitizeEventPayload` 写入+回放双净化（data URL→占位、附件根内绝对路径→相对）；checkpoint `toCheckpointMessages` 文本化 |
| 计价 | `costTracker.estimateImageTokens` / `TokenUsage.imageTokens` / `CostEntry.imageCostUsd` **归因拆分**（provider `promptTokens` 已含图片，不重复计费），成本表 Image 列；识别调用 `onUsage` 上报 |

详见 `docs/testing/doc-pipeline-b6.tdd.md`（含全部取舍记录 §8）。

## Agent 循环

`agentLoop.ts` 核心流程（2026-09-10 重构拆分为子模块）：

```
用户消息 → 意图识别 → 工具集确定 → 系统提示组装
    ↓
LLM 流式调用（带 tools 定义）
    ↓
工具执行（只读并行 + 写入串行）
    ↓
结果返回 LLM → 下一轮（按意图 6~12 轮，默认 10）
    ↓
死循环检测 → 完成/错误
```

### 关键参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| maxRounds | 按意图 6~12，默认 10 | `getRoundsForIntent()`：chat 6 / kbQa 8 / web·rewrite 10 / create·tech 12 / 其余 `DEFAULT_MAX_ROUNDS=10`（`agentHelpers.ts:52-62`） |
| KEEP_RECENT_ROUNDS | 3 | 压缩后保留的最近轮数（`agentHelpers.ts:14`，实际两处调用都显式传 3） |
| TOOL_EXEC_TIMEOUT_MS | 30000 | 单工具超时 |
| maxConsecutiveFailures | 2 | 连续失败终止 |

### 子模块（2026-09-10 重构提取）

| 子模块 | 文件 | 职责 |
|--------|------|------|
| Prompt 构建 | `agentPromptBuilder.ts` | 系统提示组装 + 文档上下文 + 文件列表快照。文档上下文（B9 三-1②）：载荷带 `currentFileRef`（文件树磁盘 md）时走**引用模式**——只注入文件名+路径+摘要（规模/标题大纲/前 20 行），正文由 `readLocalFile` 按需读取，**不整篇内联**；无磁盘路径（welcome/DB 文档）保持旧的整篇注入+超长截断 |
| 工具选择 | `agentToolSelector.ts` | 按意图决定可用工具子集 + READ_ONLY/WRITE_TOOLS 常量 |
| KB 预加载 | `agentKbPreloader.ts` | 异步预检索 + 一次性缓存（30s TTL） |

## 意图路由

`intentRouter.ts` 规则启发式分类（纯函数，无 LLM 依赖）：

| 意图 | 关键词示例 | 可用工具 |
|------|-----------|----------|
| chat | 闲聊/通用问题 | 无意图特有工具（仍拿基础区全量：listFiles 等 15 个 + memory_read / memory_write，再加本行外的 ask_question_card） |
| rewrite | 修改/润色/删除 | editBlocks + 文件操作 + searchKB |
| create | 写/创作/新建 | createFile + editBlocks + searchKB |
| tech | 代码/技术问题 | 同 create |
| kbQa | 知识库/笔记 | searchKB |
| web | 搜索/网站/URL | web_search + research_search + searchKB |

**强信号加权**：输入含 URL 或"网站"等强信号词时，web 意图得分 ×1.5。

## 工具系统

工具注册表 `toolRegistry.ts`（`handlerMap`）维护 **30 个工具** —— 5 个核心工具发送完整 JSON Schema，
25 个延迟工具仅发名称 stub + `defer_loading: true`，被选中时再补 schema 重发（上限 3 次）：

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
| memory_read | 读取 `agent_memory` 当前有效记忆（kind / subject / keyword 过滤，带 user_id 隔离） |
| searchDocument / readPage / extractTable / analyzeChart | 附件文档工具（B8：关键词+页码检索 / 按页读取 / 抽表 CSV / 图表定位分析） |

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
| memory_write | 写入记忆（upsert，恒 `source='auto'`，同轮去重 + 单轮 10 条自限） | 不进 FORCE_CONFIRM（铁律一仅约束笔记写入） |

> **B11 八-2② 实现现状**：`auto/manual` 为设计意图档位。截至 B11，主进程工具执行路径对
> `write_mode=auto` **无消费点**（该值仅由 UI toggle 与 `AI_GET/SET_WRITE_MODE` 持久化到
> `ai_config.write_mode`）；实际硬确认由 `FORCE_CONFIRM_TOOLS`（`agentToolExecutor.checkForceConfirmTools`，
> 删除类不可恢复操作恒确认）与 proposal/confirm 类工具（恒 manual）承担。详见下方「写控制」。

### 交互工具

| 工具 | 说明 |
|------|------|
| ask_question_card | 结构化提问（text/choice/confirm） |
| runSkill | 执行 Skill |

## 写控制

| 模式 | 设计意图 | 实现现状（B11 八-2② 如实记录） |
|------|------|------|
| `auto` | AI 直接执行写操作 | **主进程工具执行路径无消费点**——仅 UI toggle + IPC（`AI_GET/SET_WRITE_MODE`）持久化为用户偏好 |
| `manual` | 弹确认卡片（红删绿增预览） | 生效路径：`FORCE_CONFIRM_TOOLS` 硬确认（删除类）+ `editBlocks`/`preview_*` proposal 确认（恒 manual） |

- **附件/解析产物写入按 `manual` 确认语义执行**（八-2②）：入 KB（`importAttachmentAsKb`）、
  附件落库（`persistIncomingAttachments`）等触发点全部来自用户显式动作（勾选+发送、设置页导入），
  AI 工具集内无任何可触发上述写入的工具（已核查 toolRegistry/agent 侧零引用）——不存在
  "AI 自动写附件"路径，天然满足 manual 语义。
- **确认 UI 不空转**：Composer 写模式开关已加显式 title 提示（auto=偏好预设、当前按手动语义执行）。
- `write_mode` 完整接线（auto 分支消费点、确认卡片+staleness 全链路）列为后续，不阻塞本期（八-2 范围）。

**staleness detection**：editBlocks proposal 生成时计算 **xxHash64** contentHash
（`src/shared/utils/hashUtil.ts`，S4 MD5→xxHash64 迁移后；本行原文误写为 MD5，B11 如实修正），确认时二次校验。

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
