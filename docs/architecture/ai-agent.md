# AI/Agent 系统架构

> 最后更新：2026-10-01
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
- 自动记忆（`agent_memory` 16 列 + `memory_read`/`memory_write` + 后台 `memory_extract` 提取 + 轨迹提炼 `skill_distill`）

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
| chat | 闲聊/通用问题 | 无意图特有工具（仍拿基础区全量：15 个文件/辅助工具 + memory_read / memory_write = 17；`hasSearchConfig` 时再加 web_search / research_search，`hasInteractionSupport` 时加 ask_question_card） |
| rewrite | 修改/润色/删除 | editBlocks + 文件操作 + searchKB |
| create | 写/创作/新建 | createFile + editBlocks + searchKB |
| tech | 代码/技术问题 | 同 create |
| kbQa | 知识库/笔记 | searchKB |
| web | 搜索/网站/URL | web_search + research_search + searchKB |

**强信号加权**：输入含 URL 或"网站"等强信号词时，web 意图得分 ×1.5。

### 多意图预检门与结构化拆分（agent-multi-intent 任务 2）

规则预检门 `detectMultiIntentGate(input)`（同文件，纯规则零 LLM）：复用 RULES 关键词表收集命中意图类
（含 URL → web 同口径），**开闸 ⇔ 命中类 ≥2**；含连接词（`并且/然后/顺便/另外/同时/接着`）时再按连接词
分句累计。连接词单独命中（「然后？」）或仅 1 类命中一律不开闸 → **单意图零 LLM 调用**。
`classifyIntent` 本体与签名不动（Q8：候选卡与多意图拆分卡两套并存）。

链路（`agentContext.ts` → `agentLoop.ts`，内存编排不动表）：

```
prepareAgentContext :517 classifyIntent 之后 → ctx.intentGateOpen（+ baseHistoryMessages /
  toolSelectionArgs 快照，任务 5 铺垫）；多意图恒用 Agent 提示
runAgentFlow
  ├ gate 关 / 无交互 → 现有单意图轮次循环（逐字节等价）
  └ gate 开 → runTaskSplit（一次结构化出参调用，失败重试 1 次附上次错误）
       ├ null（两次失败 / 0-1 子任务 / 归一后 <2）→ 降级单意图直通（Q5，不阻断对话）
       └ ≥2 子任务 → normalizeTaskPlan（>5 截断 + omittedCount、同对象写合并、写串行标注）
            → onInteractionRequired(questions, 'intent_split', plan)   // 拆分确认卡
            → waitForInteraction → split_plan（JSON）→ parseTaskPlan 解析回计划
                 非法 / 用户取消 → 降级直通
            → subtaskOrchestrator 链 v1：每子任务注入指令 → 复用现有轮次循环
              （共享 llmMessages、单一 detector 总预算、串行，边界只落 assistant/user 轮间）
            → 链末单次 AI_STREAM_DONE 收口（intent = plan.primaryIntent）
```

- **降级路径**：拆分失败 / 无交互支持 / 用户取消 / `split_plan` 非法，一律回到单意图直通；
  无交互环境连拆分调用都不发起（fail-safe）。
- **交互通道复用**：不新开 IPC invoke，`AgentInteractionPayload` 仅扩 `plan?: AgentTaskPlan`
  → preload 桥接 → `agentStore.pendingInteraction` → `AIPanelSession` 按 `variant === 'intent_split'`
  分派 `SplitConfirmCard`（增删行 + 确认回传 / 直接执行 = 空答案降级）。
- **与知识库侧的边界（桥接不合并）**：KB 侧 `queryPlanner.ts` 的多意图只做**检索策略合并**
  （S12 `mergeStrategies` → 单一 `QueryPlan` broad/focused/comparative），不承担任务拆分；
  任务拆分只发生在本章的意图路由 / Agent 编排层。两层互不合并：KB 不拆任务，Agent 链不改写检索策略。
- **透传口径（Q21，任务 9）**：Agent 任务意图单向透传进 KB 检索作**诊断审计**——
  `ToolCtx.agentIntent`（`prepareAgentContext` 构造时注入主 intent；子任务链
  `applySubtaskContext` 切换时覆写为 `subtask.intent`）→ `searchKBHandler`
  `opts.agentIntent` → `kbSearch` `diagnostics.queryUnderstanding.agentIntent`
  （可选字段，缺省不写键）。不改 `searchMode/topK/threshold/expandedQueries`；
  冲突时 Agent 定工具集、KB 定检索策略，以 Agent 为准。kbQa 子任务在
  `applySubtaskContext` 按其 query 单槽预载 `searchKb`（首访等待在飞预载落地），
  全链对该 query 检索恰一次。详见 `knowledge.md`「桥接不合并」小节。
- **另一套意图系统（交叉引用，任务 10）**：项目存在两套意图系统——本节是**任务意图域**
  （`intentRouter.ts` / `intentTiering.ts`，定工具集与子任务链编排）；KB 侧
  [`knowledge.md`](knowledge.md)「Agent 任务意图 ↔ KB 检索策略意图：桥接不合并」小节是
  **检索策略意图域**（`queryPlanner.ts`，定 KB 检索扩展策略）。优先级：任务意图定工具集、
  检索策略意图定 KB 检索，冲突以 Agent 为准；两套不互相 import、禁止物理合并
  （类型分处 `@shared/ai/agent.ts` 与 `@shared/ai/kb.ts`，物理隔离已成立，不建共享常量文件）。
  历史记录见 `docs/requirements/agent-memory-optimize-2.req.md:41`（A3 分工裁定）。
- **规范契约**：子任务链执行与降级编排见 [`agent-tool-runtime.md`](../specs/ai-agent/agent-tool-runtime.md) §13（轮次双预算 / 上下文重建 / 中断安全点 / 失败重试）与 [`agent-prompt-context.md`](../specs/ai-agent/agent-prompt-context.md) §11.3（`runTaskSplit` / `confirmSplitPlan` 调用与降级编排）。

### 三层意图路由分层（agent-multi-intent 任务 4，Q20）

`intentTiering.ts` 在规则层之上加一层**低置信才触发**的轻量 tier2，三层为：

- **L1 规则底线**：`classifyIntent` 同步、零成本，是唯一兜底 —— tier2 任何失败
  （超时 / 抛错 / 非法标签 / 无 key / 非 openai 协议）都降级回规则结果，**降级永不低于规则**。
- **L2 tier2 轻量小模型**：仅规则低置信（`confidence < 0.7 || needsClarification`）且非空输入时，
  经 lazy opts（`runAgentFlow` 注入的工厂：`apiKeyEnc` 非空才 `decryptApiKey` + 取
  `config.remoteBaseUrl/model/protocol`）调 `llmClient.streamChatCompletion` one-shot 分类；
  **1.5s deadline 硬闸**包裹连接 + 推理，输出必须 ∈ `IntentName` 六标签（大小写归一）；
  结果 `confidence = max(rule, 0.7)` —— 永不低于规则。仅 `protocol === 'openai'` 触发
  （anthropic / 协议缺省回规则；生产 `toIAIConfig` 恒归一化协议）。
- **L3 大模型规划**：已建 `runTaskSplit`（gate 开才用，本任务不动），见上节。

**共享缓存**：三调用点 —— `agentContext.ts` 主分类（:533 附近）、技能推断（:419 附近，
`hasHistory:true` 键）、`kbSearch.ts` `isFallthrough`（:385 附近，`hasHistory:false` 键）——
统一经 `classifyIntentShared(input, hasHistory)` 读 `sha256(hasHistory|input)` 键的短 TTL 缓存
（**TTL 10s、容量 200、LRU 淘汰**，`__resetIntentTierCacheForTest` 供测试清空）。
缓存**只由 `prefetchIntentTiered` 在 tier2 成功时写入**；`classifyIntentShared` 只读、miss 即规则
（规则结果不入缓存，保证既有 `classifyIntent` 调用计数断言零回归）。
**kbSearch 只读不预取**（保持 `isFallthrough` 同步语义，Q20）；`runAgentFlow` 在
`prepareAgentContext` **之前** `await prefetchIntentTiered(...)` 且整体 try/catch fail-closed。

**零新增调用口径**：规则高置信输入零新增 LLM 调用（预取在触发判定处短路，lazy opts 工厂都不构造）；
低置信升级小模型是 Q20 P1 裁定；分类层变化不改提示词 / 消息序列（gate 关路径逐字节等价仍成立）。
分类输入输出落日志（`[intentTier]` 前缀，query 摘要 + rule/tier2 结论），供离线评估规则覆盖率。

**回指**：本层只处理**任务意图域**；KB 侧**检索策略意图域**与本层的边界（桥接不合并、`agentIntent` 仅作诊断透传、冲突以 Agent 为准）见 [`knowledge.md`](knowledge.md)「Agent 任务意图 ↔ KB 检索策略意图：桥接不合并」小节。

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

| 工具 | 说明 | 确认矩阵档位（任务 11） | 设计档位 |
|------|------|------|------|
| deleteFile / deleteLocalFile | 删除文件/本地文件（不可恢复） | **force**（任何 intent 恒强制确认卡） | auto/manual |
| createFile / createFolder / renameFile / moveFile / editLocalFile | 直接写盘 | **batch**（单意图现状 preview；多写链链末汇总确认） | auto/manual |
| editBlocks | 块级编辑（仅产 proposal） | none（proposal 恒 manual 确认，不进矩阵） | manual |
| preview_file_revision / preview_patch_files | 修订/补丁预览 | none（proposal 恒 manual 确认，不进矩阵） | manual |
| memory_write | 写入记忆（upsert，恒 `source='auto'`，同轮去重 + 单轮 10 条自限） | none（维持现口径：不进强制档，铁律一仅约束笔记写入） | — |

> **B11 八-2② → 任务 13 更新**：`auto/manual` **消费点已落地**（Q23）——`ai_config.write_mode`
> 经 `toIAIConfig` → `ctx.writeMode` 注入，`checkForceConfirmTools` batch 档按其分派
> （auto=现状/链末汇总，manual=逐写执行前确认）。硬确认仍由 **确认矩阵
> `confirmMatrix.confirmTierFor`**（任务 11，任务 13 起为写工具清单唯一权威）与
> proposal/confirm 类工具（恒 manual）承担。详见下方「写控制」。

### 交互工具

| 工具 | 说明 |
|------|------|
| ask_question_card | 结构化提问（text/choice/confirm） |
| runSkill | 执行 Skill |

## 写控制（intent × tool 确认矩阵，agent-multi-intent 任务 11）

> 权威实现：`src/main/ai/agent/confirmMatrix.ts`（纯函数，**代码矩阵为准**，Q14；
> 提示词一致性由 `tests/main/ai/agentToolExecutor.test.ts`「确认矩阵」+ `tests/main/ai/confirmMatrix.test.ts` 钉死）。
> 规范契约：三档执行语义、链末汇总确认与 write_mode 消费见 [`agent-tool-runtime.md`](../specs/ai-agent/agent-tool-runtime.md) §14（§14.3 链末汇总 / §14.5 write_mode 消费）。

### 三档定义

| 档位 | 覆盖 | 行为 |
|------|------|------|
| `force` | `deleteFile` / `deleteLocalFile`（**任何 intent**，含未知 intent） | 单工具强制确认卡（`delete_confirm` 变体），答 yes 才执行；无交互环境拒绝执行 |
| `batch` | `WRITE_TOOLS` 其余 5 项（createFile/createFolder/renameFile/moveFile/editLocalFile，**任何 intent 均不得返回 `none`**——铁律一不削弱） | 单意图保持现状（执行 + preview 通知）；**多写子任务链**执行并收集写批次 → 链末一次汇总确认（`write_batch`）；无交互环境拒绝执行 |
| `none` | 已登记只读/非写工具（23 项，含 `memory_write` 维持现口径、`ask_question_card`、proposal 类不进矩阵） | 不拦截，常规执行路径 |

- **fail-closed**：未知 intent 值、未登记工具名 → 按 `'batch'`（**只向确认方向兜底，禁止向放行方向兜底**）。
- **无交互环境 `'force'`/`'batch'` 一律拒绝执行**（`checkForceConfirmTools` 内 `:224-235`
  「无交互拒删除」语义泛化到全部写档，只强不弱）。生产链路 `agentTaskWorker.buildAgentDeps`
  恒带交互回调，该闸只在无回调的直连/测试环境触发。
- **多写汇总一次确认（Q13）**：汇总只合并打断次数，**确认动作不省略**——链末一次
  `write_batch` 交互逐项勾选「保留/拒绝」（`BatchConfirmCard`），拒绝项链末经
  `rollbackToSnapshot` 回滚会话内容快照；快照回滚会还原 .md 内容，已接受的
  `editLocalFile` 回滚后重新执行以保留确认变更。**粒度限制（如实记录）**：新建/重命名/
  移动类操作不在内容快照覆盖范围，拒绝这些项无法经快照回滚撤销。
- `waitForAll` skip-set 由矩阵按本轮工具名逐档派生（`confirmSkipSet(intent, inChain, toolNames)`）：
  `force` 恒入、链态下 `batch` 入（留给 `checkForceConfirmTools` 收集）、**未登记名恒入**
  （`confirmTierFor` fail-closed → `batch`，连通性报告 §6）；已登记非链态 skip-set 与原
  `FORCE_CONFIRM_TOOLS` 行为等价。
- 链末汇总确认的明示（拒绝项数 + 回滚结果）追加进链 buffer，随链末单条 assistant 落库；
  错误/取消路径（AI_STREAM_ERROR 收口）不触发汇总确认——该路径下写入保持执行原状（= 改动前基线）。

### write_mode（消费点已落地，agent-multi-intent 任务 13 / Q23）

| 模式 | 消费点行为（Q23 裁定） |
|------|------|
| `auto` | **链式执行 + 链末汇总确认 + 拒绝快照回滚（确认必经，铁律一不削弱）**；单意图 batch 档保持现状（执行 + preview，不打断）——即 P0 行为 |
| `manual` | **逐写执行前确认**（单意图与链一致）：`checkForceConfirmTools` batch 档发 `confirm` 确认卡（id=toolCallId、含目标路径），yes 才执行，no/cancel 取消，无交互仍 fail-closed 拒写；`writeBatch` 收集仅 auto 生效（manual 链不收集 → 链末零交互） |

- **接线链路**：`ai_config.write_mode`（`mapConfigRow` NULL→manual）→ `toIAIConfig` 透传
  （缺省不下发）→ `IAIConfig.writeMode?` → `prepareAgentContext` 注入
  `ctx.writeMode = config.writeMode ?? 'auto'` → `agentToolExecutor.checkForceConfirmTools`
  batch 档按 `ctx.writeMode` 分派 + `agentLoop.computeRoundSkipSet` 路由（manual 把写档
  补进 skip-set）。**缺省 `?? 'auto'` = P0 现行为**（既有测试零 fixture 改动全绿）。
- **确认 UI 不空转**：Composer 写模式开关 title 提示（auto=偏好预设）——manual 现已真实生效。
- **无交互环境**（遗留问题 3，**已解决 @任务13**）：流式/延迟重发两路径 caller 侧
  `computeRoundSkipSet` 把 `confirmTierFor ≠ 'none'` 的本轮工具补进 skip → 路由
  `checkForceConfirmTools` 拒写（非链态流路径原「写工具直通执行」不可达该闸）。
  `confirmSkipSet` 函数本体与输出逐字节不变（`confirmMatrix.test` 103-129 钉死）。
- **收敛声明（Q23 末句）**：`confirmMatrix.ts` 为写工具清单**唯一权威**
  （`CONFIRM_FORCE_TOOLS` / `CONFIRM_BATCH_TOOLS` 常量，`confirmTierFor` 读自身常量）；
  `agentToolSelector.WRITE_TOOLS / FORCE_CONFIRM_TOOLS` 改为从 confirmMatrix 派生再导出
  （成员逐一不变），import 方向倒置——confirmMatrix 不再依赖 agentToolSelector（防循环）。
  交叉断言钉死：matrix batch∪force ⊆ concurrency 表 false 集 / `FILE_OP_WRITE_TOOLS`
  写子集 ⊇ matrix batch∪force（agentPromptBuilder sha256 输入不动）/ selector 派生成员 == 原常量成员。

- **附件/解析产物写入按 `manual` 确认语义执行**（八-2②）：入 KB（`importAttachmentAsKb`）、
  附件落库（`persistIncomingAttachments`）等触发点全部来自用户显式动作（勾选+发送、设置页导入），
  AI 工具集内无任何可触发上述写入的工具（已核查 toolRegistry/agent 侧零引用）——不存在
  "AI 自动写附件"路径，天然满足 manual 语义。

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

### 子任务链追踪（intent_json，agent-multi-intent 任务 6）

多意图链的全链路状态写 `agent_sessions.intent_json`（**零加列**，Q18 裁定），供 getTaskActivity / 报告（任务 7+）消费：

- **形状**（v=1，类型见 `src/shared/ai/intentRecord.ts`）：`{ v, runId, primaryIntent, plan{subtasks,omittedCount}, deps, subtasks[{id,status,startedAt,endedAt,rounds,summary,error}], outcome?, report? }`。
  `deps` 由 `SubtaskDef.preconditions` 的 `serial_after:<id>` 归一（`buildDepsMap` 纯函数，任务 8 出队条件）；
  `status` ∈ `pending|running|done|failed|skipped|skipped_dependency|dependency_rejected`（后两个为任务 12 级联态）。
- **写入链路**：`chainTracking.createChainTracker` 随 `SubtaskChain`（内存态）维护 → 链启动 / 推进（`advanceChain` 出口）/ 失败跳过 / 收口四点经
  **可选** 回调 `deps.onChainRecordUpdate(json)` 推送**全量** JSON（未注入 = 全链零行为变化）→ worker `buildAgentDeps` 实现 →
  `sessionDao.saveIntentJson`（UPDATE 仅 `intent_json` 一列，全量覆盖同 session 单链天然幂等；写库异常 try/catch 仅 console.error，不影响链运行）。
- **不落盘（Q18）**：重试计数（`SubtaskChain.retryCount` 内存态）与文件快照（复用 `agent_file_snapshots` / agentSnapshot，不内嵌 payload）。
- **读端容错**：`getIntentJson` 对不存在 / 未写入 / 坏 JSON 一律降级 `null` 不抛；`outcome` 缺省 = 未收口，
  `finalizeChainRun` 补 `finished`、`stopChain` 写 `stopped`（`failed` 生产点由任务 7 报告线裁定）。
- **`report` 字段**任务 6 只定形不填充（任务 7 `buildChainReport` 起写入）。
- **规范契约**：链执行与并行调度的完整契约见 [`agent-tool-runtime.md`](../specs/ai-agent/agent-tool-runtime.md) §13（子任务链执行）与 §15（依赖图并行调度：出队四道闸 / epoch 乐观锁 / 失败策略 / 交互串行化）。

### 后台任务类型（agent-memory-optimize 三批）

同一 `agent_task_queue` 内，除作答任务外还有两类**不进 `runAgentFlow`、不设 `conversationTaskMap`**
（因而不会被 `AGENT_ABORT` 取消）的后台任务，均**永不 reject、失败 `done('failed')` 不重试**：

| 类型 | 实现 | 触发 | 产物 |
|------|------|------|------|
| `memory_extract` | `agent/memoryWriter.ts` | `handleTaskSuccess` 里 `AI_STREAM_DONE` 之后同步判节流（`MEMORY_EXTRACT_MIN_ROUND_GAP=2`）→ 入队 | 读最近 3 轮 → LLM 结构化提取 → 校验 → `upsertMemory(source='auto')` → `runMemoryPolicy` 冲突清洗 |
| `skill_distill` | `skills/skillDistiller.ts` | `agentTaskWorker` 内 `maybeEnqueueSkillDistillation`（节流 `SKILL_DISTILL_MIN_ROUND_GAP=4` + 同会话 pending 去重，**给 `memory_extract` 让位**） | 读 `ai_messages` 轨迹 → LLM 提炼 → 只写 `userData/skills/_auto/_drafts/`（front matter `status: draft`） |

两类任务共用既有 1s 队列轮询，**未新建 `setInterval` / 未新建队列**；
`enqueue` 的 supersede **不区分任务类型**，故用「同会话任意 pending 即跳过」规避互顶。

### 记忆写入的三处触发

1. C1 `memory_write` 工具（同步，同轮同 `kind+subject` 只留一条，单轮上限 10 条）
2. 后台 `memory_extract`（异步）
3. D2 起，`runMemoryPolicy` 另在**应用启动 / `memory_write` 成功后 / 既有 `memoryWriter.ts` 成功路径**三处触发
   （merge → evict → capacity，`MAX_ACTIVE_MEMORIES=500`；`manual` 永不驱逐、永不满额关闭）

## 搜索配置

`web_search` 工具可用性：

1. 从 `ai_search_config` 表读取配置
2. 检查 `enabled` 和 API key
3. 未配置时不注入（避免 LLM 调用失败）
4. 已配置时对所有非 chat 意图可用
