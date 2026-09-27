# doc-pipeline 遗留修复批次诊断报告（只读诊断，未改代码）

> 分支 `feat/doc-pipeline` @ 4d44eb4。诊断对象：Bug A（上传文件）、Bug B（上传图片）、
> R3~R8 遗留修复点。所有结论均带 文件:行号 实证。风险级沿用全局 CLAUDE.md L0~L4。

---

## Bug A — 上传文件：提问工具不灵活 / 工具参数地址错误 / 绝对路径收不到

### A-1 根因①：附件绝对路径根本没进 prompt（主根因）

**实证链**：

1. 渲染层发送正文只拼占位符，不含路径：
   `src/render/components/AIAgent/composer/pasteAttachment.ts:247-254`
   `buildAttachmentSendText` 对每个附件只追加 `[文件: name]` / `[图片: name]`，
   `att.path` 被明确丢弃（一-4② 设计：正文不进解析产物）。
2. 主进程 `prepareAgentContext` 收到 `payload.attachments` 后只做两件事：
   - `agentContext.ts:216-224` 落库 `attachments_json`（给渲染层回显用）；
   - `agentContext.ts:348-360` **只对 `type === 'image'` 注入图片 part**。
   文件附件（type=file）的 `path` / `attachment_id` / `parseStatus` 从此再无消费点。
3. System prompt 组装无附件清单：
   `agentPromptBuilder.ts:160-168`（DB 文件列表，是笔记不是附件）、
   `agentPromptBuilder.ts:203-223`（`buildLocalTreeSnapshot` 只注入 `payload.fileTreePaths`
   即用户打开的本地文件，也不含会话附件）。
   → LLM 全程只见 `[文件: report.pdf]`，**从未见过绝对路径，也从未见过 attachment_id**。

**后果**：LLM 调 `readLocalFile` 时只能自由编造路径（schema 示例
`toolRegistry.ts:252` 是 `C:/Users/xxx/Desktop/note.md`，进一步诱导幻觉）；
相对路径兜底 `readLocalFile.ts:20` 还会按 `process.cwd()` 解析，把错误路径坐实 →
用户观察到「参数的地址错误」。`searchDocument` 的 `attachment_id` 参数同样无 prompt 来源，
只能靠占位符里的 `file_name` 猜（`searchDocument.ts:54-65` 有 file_name 兜底，勉强可用）。

**最小修复**：`agentContext.ts` 在组装 system 消息段（约 437-454 行
`fileListSnapshot` / `localFileTreeSnapshot` 附近）新增「本会话附件清单」注入：
每条 `- {name} | 路径: {path} | 附件 id: {id} | 状态: {parseStatus}`（文件给绝对路径，
图片可给 id 引导走 searchDocument/image part 而非 readLocalFile），并提示
「附件优先用 searchDocument/readPage 按 file_name 检索；原始文件路径可用 readLocalFile 读取」。
数据源直接用 `payload.attachments`（已含 path，来自 `attachments.ts:453-470` 的 metas）。
纯 prompt 增量，不动 IPC/DB。**风险级 L2**。

**测试点**：单测 `agentContext`——带 `attachments=[{type:'file',path:'C:/x/a.pdf'}]` 的 payload，
断言返回的 `llmMessages` 中存在含该绝对路径与 attachment_id 的 system 消息；
无附件时该段不出现（零回归）。

### A-2 根因②：chat 意图吃掉 CHAT_SYSTEM_PROMPT，工具/提问全被禁（提问不灵活）

**实证链**：

1. `intentRouter.ts:109-116`：无关键词命中即判 `chat`（confidence 0.7），
   `needsClarification` 仅 `text.length < 6 || (conf<0.85 && len<10)`。
   附件消息形如 `[文件: x.pdf]\n帮我看看` 长度必 >10 → `needsClarification=false`；
   且 `classifyIntent` 不感知附件，`[文件: ...]` 占位符不含任何意图关键词 → 高概率落 `chat`。
2. `agentContext.ts:446-453`：`useAgentPrompt = !isChatIntent || needsClarification`
   → chat 且非短消息时用 `CHAT_SYSTEM_PROMPT`（`agentPromptBuilder.ts:328-338`），
   其核心规则明写 **「不要提及工具、文件或文档」**。
3. 工具其实给全了：`agentToolSelector.ts:74-90` 基础工具（含 readLocalFile/
   searchDocument/ask_question_card 前置注册）+ chat 分支 `:100-107` 在 `hasInteractionSupport`
   时也加了 `ask_question_card`；`agentTaskWorker.ts:414-437` 提供了
   `onInteractionRequired`/`waitForInteraction` 回调，`hasInteractionSupport=true`。
   → **工具在、schema 完整（ask_question_card 非 defer，`toolRegistry.ts:218` 无
   defer_loading 标记），但系统提示明令禁止使用** → 「不能灵活调用提问工具」
   「不先提问用户」。
4. `agentLoop.ts:504-526` 文本提问兜底（detectTextQuestions）与 CHAT_SYSTEM_PROMPT
   的「不要提及工具」互相矛盾，形成「有时提问有时不提问」的摇摆。

**最小修复**（二选一，建议 a）：
- (a) `agentContext.ts:446-453`：`useAgentPrompt` 条件补 `payload.attachments?.length > 0`
  （有附件即走 Agent prompt，chat 闲聊不会带附件，误伤面≈0）；
  同时 `intentRouter.classifyIntent` 可选加附件感知（`payload` 不进纯函数签名则不动）。
- (b) `CHAT_SYSTEM_PROMPT` 放开 ask_question_card（改文案风险更大，不建议）。
  **风险级 L2**。

**测试点**：`classifyIntent('[文件: a.pdf]\n帮我看看')` 返回 chat 时，
`prepareAgentContext` 断言 `llmMessages[0].content` 含「ask_question_card」铁律段
（即走了 buildAgentSystemPrompt）而非 CHAT_SYSTEM_PROMPT；
纯闲聊无附件消息仍走 CHAT_SYSTEM_PROMPT。

### A-3 观察（不单列修复）

- `readLocalFile.ts:20` 相对路径按 `process.cwd()` 解析是第二重误导，A-1 修复后
  prompt 全给绝对路径，此点降级为边角，暂不动（避免无关重构）。

---

## Bug B — 上传图片：不管模型是否多模态，LLM 都看不到图片

### B-1 根因①：vision 能力判定 = 模型 id 正则猜 + 未知恒 false + 无用户覆盖

**实证链**：

1. `modelDiscovery.ts:69-88 supportsVision()`：只按 id 模式匹配
   （`vision`/`claude`/`gpt-4`/`o1|o3|o4`/`-vl`/`llava|pixtral|...`/`gemini`），
   **末行 `return false` —— 未知模型保守判否**（注释自认「未知模型按不支持处理」）。
   例：`qwen-plus`（modelCatalog.ts:66 自己的目录项）→ false；`glm-4v`、`minicpm-v`、
   `gpt-5` 系、厂商私有部署改名模型 → 全部 false。
2. 判定结果直接决定注入：`agentContext.ts:333 supportsImages = supportsVision(model)` →
   `:342/:348/:358` 三处注入全以它为闸；false 时 `buildImageParts`
   （`agentMedia.ts:168-170`）**不产任何 part，degraded=true**，
   最后只 push 一条 `VISION_DEGRADED_NOTICE`（`agentContext.ts:429-431`）
   —— 该 notice 是 system 消息只给 LLM 看，**渲染层用户端收不到降级原因**
   （console.warn 在 `agentContext.ts:366-369`，用户不可见）。
3. 同一判定还掐断识别链路：`imageRecognition.ts:193/:243-249` visionOk=false →
   直接标 `parseStatus='error'`「当前模型不支持图片理解」，**不发请求**。
   → 两条图片通道（发送注入 + 识别落正文）被同一个 false 同时掐死。
4. 无任何覆盖机制：`shared/ai/config.ts:10-21 IAIConfig` 无 capabilities/vision 字段；
   `discoverModels` 猜出的 `capabilities`（`modelDiscovery.ts:45`）只用于展示，
   **不参与 `supportsVision` 判定**；设置 UI 无「模型支持图片理解」开关。
   → 用户换多模态模型后只要 id 不匹配模式，表现与纯文本模型完全一致，
   即「不管当前 LLM 是否多模态，LLM 都看不到图片」。

**已排除的假设**（链路本身是通的）：
- ② 注入链已接进 AGENT_RUN 生产路径：`agentHandlers.ts:143-179` 落库 →
  `extra.attachments` 入 payloadJson → `agentTaskWorker.ts:244-263` 透传 →
  `agentContext.ts:348-360` 注入 → `agentLoop.ts:313-317` 发送
  → `llmClient.ts:331 resolveContentForWire` 把本地路径转 data URL
  （读失败降级占位 `llmClient.ts:89`，仅在文件缺失时触发；`buildImageParts`
  已先 `existsSync` 过滤，`agentMedia.ts:176-179`）。测试路径与生产路径共用同一接线点。
- ③ anthropic 协议分流在 chat/识别/压缩链路都有（`chatHandlers.ts:382`、
  `imageRecognition.ts:143`、`contextManager.ts:221`），但
  **`agentLoop.ts:313` 主循环恒用 `streamChatCompletionWithRetry`（OpenAI 端点）**——
  若 protocol=anthropic 整个 Agent 主循环会打错端点（不只是图片），
  属独立既有问题，列为观察项，不并入本 Bug。

**最小修复**（两步，独立可分批）：
1. **用户覆盖开关**：`IAIConfig` 增加可选 `visionOverride?: boolean`（DB 配置表加列，
   迁移只加列不改旧列），`supportsVision` 调用点改为
   `visionOverride ?? supportsVision(model)`；覆盖点仅
   `agentContext.ts:333`、`chatHandlers.ts:339`、`imageRecognition.ts:193` 三处
   （`multimodalParse.ts` 的可注入 deps 不动）。设置 UI 加「模型支持图片理解」勾选，
   默认未设置时维持现状（保守判否不回退）。**风险级 L3**（新增 API/配置字段）。
2. **降级可见**：`visionDegraded` 时随 `AI_STREAM_*` 或独立事件把降级原因发给渲染层
   （复用 `CHANNEL_TO_EVENT_TYPE` 通道，payload 加 `visionDegraded: true`），
   渲染层在附件 chip 上标「当前模型不支持图片理解」。**风险级 L1**。

**测试点**：
- 单测 `supportsVision`：`visionOverride=true` 时 `qwen-plus` 注入 part；
  override 未设置时行为与现状逐 case 相同（回归）。
- 集成：`prepareAgentContext` 以 `model='some-unknown-multimodal'` +
  `visionOverride=true` 构造带图片附件 payload，断言 `llmMessages` 中 user 消息
  含 `image_url` part；override=false 时含 VISION_DEGRADED_NOTICE 且无 part。
- E2E：粘贴 + 系统文件框两条入口（R4 回执 404 是渲染层问题，单独在 R4 测）。

---

## R3~R8 修复点确认

### R3 — searchDocument 未过外发闸（L4 安全）

**根因实证**：
- `searchDocument.ts:178-230 handleSearchDocument` 直读 `parsed_attachments` 返回正文，
  **全程无任何 consent/allowSend 检查**；外发闸只接在 searchKB 上
  （`agentTaskWorker.ts:398-406` 的 `filterKbEgressResults` 闭包）。
- 更重的漏洞：`resolveAttachmentTarget`（`searchDocument.ts:48-51`）按
  `attachment_id` 查 `getParsedAttachment(attachmentId, ctx.userId)`
  （`attachments.ts:140-146`）——**只有 user_id 过滤，没有会话边界**，
  LLM 可带任意历史附件 id 跨会话读正文（readPage/extractTable/analyzeChart
  复用同一函数，四工具同洞）。
- 设计取舍背景：B3 把附件正文从 prompt 挪到工具按需读（一物两表），
  searchDocument 因此成为附件正文 → LLM 的**唯一外发出口**，与 searchKB 同性质，
  却不过闸。

**最小修复方案**：
1. `ToolCtx`（`toolTypes.ts`）增加 `attachmentEgressAllowed: boolean`，
   由 `agentContext.ts:289-299` 组装 toolCtx 时写入：
   `kbEgressAuthorized || kbAttachmentEgressGranted`（`:301-309` 已算好，直接复用）。
2. `resolveAttachmentTarget` 入口（`searchDocument.ts:41`）加两道检查：
   - 会话边界：`rec.conversationId !== ctx.currentConversationId` → 拒
     「附件不属于当前会话」（堵跨会话读）；
   - 外发闸：`!ctx.attachmentEgressAllowed` → 拒「附件外发未授权」。
3. **附件取舍裁定**（见文末开放点）：附件是用户本轮主动上传、内容天然要被模型处理，
   建议「本会话附件 = 用户已知情同意」——即闸只拦**跨会话**附件与
   allowSend=false 时的历史附件，不拦当前会话刚上传的附件；
   若需求方要求更严，则 allowSend=false 时当前会话附件也拒（会直接废掉附件问答主场景，
   不推荐）。
   **风险级 L4**（安全策略，fail-closed：ToolCtx 缺字段视为 false）。

**测试点**：allowSend=false + 无勾选授权 → searchDocument 返回 errorDesc；
allowSend=true 或勾选授权 → 正常；带他会话 attachment_id → 恒拒；
当前会话附件 + 授权 → 放行。`filterKbEgressResults` 既有单测不回归。

### R4 — 回执相对路径缩略图 404

**根因实证**：`persistIncomingAttachments` 对图片返回**相对路径**
`attachments/{userId}/{convId}/{id}.png`（`attachments.ts:461-463`，源自
`imageStorage.ts:192` relPath）。AGENT_RUN 回执把该 metas 原样返回
（`agentHandlers.ts:194`），渲染层 `agentStore.ts:1051-1066` 用它回填消息，
`AIMessageBubble.tsx:380` 对无 thumb 的图片走 `toImgSrc(att.path)`，
而 `inlineRenderer.ts:58-68` **只对盘符/UNC 绝对路径转 media://，相对路径原样返回**
→ 浏览器按页面相对 URL 解析 → 404。
（粘贴通道有 dataURL thumb 兜底 `agentStore.ts:655`；系统文件框选择的图片无 content → 无 thumb → 必 404。
读 DB 路径由 `ai.ts:567-573 resolveAttachmentPaths` 重建绝对，故刷新后恢复——
这解释了「回执瞬间 404、重开会话正常」的间歇性。）

**最小修复方案**：回执边界统一 resolve —— `agentHandlers.ts:189-196` 返回前对
`resolvedAttachments` 的 image 项调 `resolveStoredPath`（`imageStorage.ts:204`）转绝对路径；
落库仍存相对（`serializeAttachments` 会 `toRelativePath` 归一，`ai.ts:552`，不受影响）。
渲染层零改动。**风险级 L1**。

**测试点**：mock persist 返回相对路径，断言 IPC 返回的 image path 为绝对且
`toImgSrc` 产出 `media://`；文件附件 path 不变（本来就是绝对）。

### R5 — 图片 citation 点击被拒（相对路径）

**根因实证**：`agentHandlers.ts:77-105 ATTACHMENT_OPEN_SOURCE`：
1. `findAttachmentFilePath`（`ai.ts:654-679`）返回 `attachments_json` 里存的原始 rec.path，
   **图片存的是相对路径**（`ai.ts:551-552` 强制 toRelativePath）→
   `:95-99` `isLocalAbsolute` 判定失败 → `not a local file path` 拒绝；
2. 即使路径修好，`:100 isSupportedDocFile(filePath)` 的白名单
   （`shared/ai/document.ts:12-20`：pdf/doc/docx/txt/md/xls/xlsx）**不含图片扩展名**
   → `.png` 仍被 `unsupported file type` 拒绝。双重拒绝。

**最小修复方案**：`agentHandlers.ts:91-100` 改为：
1. 先 `resolveStoredPath(filePath)` 重建绝对（相对判定 `isRelativeAttachmentPath` 后才 resolve，
   避免误伤）；
2. 扩展名校验分两档：7 格式文档走现有 `isSupportedDocFile`；
   图片扩展名（复用 `IMAGE_UPLOAD_EXTS`，`pasteAttachment.ts:48`，需抽到 shared）
   单独放行，`shell.openPath` 对图片同样有效。
   **风险级 L2**（本地 openPath，非暴露面；仍保留绝对路径与扩展名白名单校验，不削弱安全）。

**测试点**：图片附件（相对 path 落库）→ 调用返回 success 且 shell.openPath 收到绝对路径；
非白名单扩展名（.exe）仍拒；他用户附件 id 仍 `attachment path not found`。

### R6 — >20 附件占位符与落库不一致

**根因实证**：主进程 `sanitizeIncomingAttachments`（`attachments.ts:311-315`）按
`MAX_ATTACHMENTS_PER_MESSAGE=20` 截断；渲染层 `buildAttachmentSendText`
（`pasteAttachment.ts:247-254`）对**全部** attachments 拼占位符，
`AIPanelComposer.tsx:390` 也不截断（chips 只是显示前 5 个，`MAX_VISIBLE_ATTACHMENT_CHIPS=5`，
选择/粘贴无数量上限）→ 第 21+ 个附件：正文有 `[文件: x]` 占位符，DB 无对应行，
LLM 看到的名字在 searchDocument 的「可用列表」里查不到 → 报错困惑。

**最小修复方案**：渲染层发送前截断 —— `AIPanelComposer.tsx:389-390`（或
`pasteAttachment.ts` 内 `buildAttachmentSendText`/`toAttachmentPayloads` 共用点）
对 attachments `.slice(0, 20)`，上限常量从 `src/main/db/attachments.ts:31` 抽到
`src/shared/ai/`（如 `document.ts`）供两侧 import（消重，符合 mediaMime 先例）。
并给用户可见提示（第 21 个起 toast/inline 提示「单条消息最多 20 个附件」，可选）。
**风险级 L1**。

**测试点**：`buildAttachmentSendText(text, 25个附件)` 与 `toAttachmentPayloads` 输出长度
一致且 =20；20 个以内零回归。

### R7 — removeParsedAttachment 零生产调用方（删除附件入口）

**根因实证**：`attachments.ts:193-212 removeParsedAttachment` 全库无 import 方
（grep 仅命中定义与 `imageStorage.ts:233` 的配对注释）。
现有「删除」入口都够不到它：
- composer `removeAttachment`（`AIPanelComposer.tsx:448`）只清发送前本地 state；
- 会话删除（`chatHandlers.ts:96-114`）只删会话行 + 落盘图片，不删 parsed_attachments
  （→ 见 R8）；
- 消息删除/编辑（`ai.ts:733+ deleteMessagesAfter` 等）不碰附件表。
→ 已上传附件（含误传、含随附 KB 索引行）**没有任何运行时删除路径**。

**最小修复方案**（入口选择需需求方裁定，推荐 a）：
- (a) **消息级删除附件**：删除消息/删除消息之后的消息时级联 —— 在
  `deleteMessagesAfter` 与消息删除 IPC 的调用点（`chatHandlers`/`agentHandlers` 消息编辑域）
  先查受影响行的 `attachments_json`，逐 id 调 `removeParsedAttachment`（它自带 KB 清理
  `removeByAttachment` + 落盘图片清理 `deleteAttachmentImage`，`attachments.ts:203-209`，
  一并解决图片残留）。
- (b) 独立 IPC `attachment:remove` + 气泡 chip 删除按钮（UI 改动大，涉及交互设计）。
  **风险级 L2**（数据删除路径，需补单测；不删测试不删迁移）。

**测试点**：插入会话+附件+KB 行 → 删除消息 → `getParsedAttachment` 返回 null、
KB attachment 行被 `removeByAttachment` 清、落盘图片文件不存在；
删除不含附件的消息 → 无副作用。

### R8 — 会话删除孤儿行

**根因实证**：
- `parsed_attachments` 表定义（`db/index.ts:635-643`）`conversation_id TEXT`
  **无 REFERENCES/FK**，不随 `ai_conversations` 级联（对比 `ai_messages`
  `index.ts:190` 有 `ON DELETE CASCADE`）；
- 删除会话 handler（`chatHandlers.ts:96-114`）只调 `deleteConversation`
  （`ai.ts:508-513`，单条 DELETE）+ `deleteConversationImages`（只删磁盘图片），
  不删 parsed_attachments → 附件正文、structure_json、KB 关联行全部成孤儿
  （`kb_documents.attachment_id` 也无 FK 级联，`index.ts:353` 注释自述按
  `removeByAttachment` 清理，但删除会话路径没调它）。

**最小修复方案**：`chatHandlers.ts:100-108` 删除成功后补一段：
先 `listParsedAttachmentsByConversation(conversationId, userId)` 取 id 列表，
逐个 `removeParsedAttachment(id, userId)`（复用 R7 同一函数，自动级联 KB + 图片；
`deleteConversationImages` 保留作兜底，幂等）。
或抽 `deleteParsedAttachmentsByConversation(userId, convId)` DAO 批量删 + 循环
`removeByAttachment`。**风险级 L2**（数据清理，注意顺序：先取列表再删会话行，
或在 `deleteConversation` 内事务化——handler 层实现即可，不动迁移）。

**测试点**：建会话+附件+KB 行 → 删除会话 → `parsed_attachments` 无该 conversation_id 行、
KB attachment 行清空、磁盘图片删净；无附件会话删除零回归。

---

## 汇总表

| 项 | 根因一句话 | 最小修复位置 | 风险级 |
|---|---|---|---|
| Bug A-1 | 附件 path/id 从未注入 prompt，LLM 只见占位符 | agentContext.ts:437-454 增附件清单段 | L2 |
| Bug A-2 | 附件消息落 chat 意图 → CHAT_SYSTEM_PROMPT 禁工具禁提问 | agentContext.ts:446-453 条件补 attachments | L2 |
| Bug B-1 | supportsVision 按 id 正则猜、未知恒 false、无覆盖开关、降级用户不可见 | IAIConfig 加 visionOverride + 3 个调用点；降级事件回传 | L3 + L1 |
| R3 | searchDocument 四工具不过外发闸且无会话边界 | ToolCtx 加 egress 标志 + resolveAttachmentTarget 双检查 | **L4** |
| R4 | 回执图片相对路径未 resolve，toImgSrc 不转 media:// | agentHandlers.ts:189-196 返回前 resolveStoredPath | L1 |
| R5 | open-source 校验双重拒绝（相对路径 + 白名单无图片扩展） | agentHandlers.ts:91-100 resolve + 图片档放行 | L2 |
| R6 | 渲染层占位符不截断，主进程截 20 | AIPanelComposer/pasteAttachment 截 20 + 常量抽 shared | L1 |
| R7 | removeParsedAttachment 无调用方，附件无删除入口 | 消息删除路径级联调用（入口需裁定） | L2 |
| R8 | parsed_attachments 无 FK，会话删除不清理 | chatHandlers.ts:100-108 补级联删除 | L2 |

## 开放点（需需求方决策）

1. **R3 附件外发取舍**：本会话附件是否视为「用户已知情同意」而豁免 allowSend 闸？
   推荐豁免当前会话、拦截跨会话；若全拦则附件问答主场景失效。
2. **R7 删除入口**：走消息级删除级联（实现快、无新 UI），还是做附件 chip 独立删除
   （需交互设计 + IPC 新增）？
3. **Bug B-1 覆盖开关的形态**：配置表加 `visionOverride` 列（用户手动勾选）
   vs 扩大 id 模式表 + 接入 discoverModels 的 capabilities（自动化但仍有未知模型）。
   建议两者都做：开关为主（用户确定性最高），模式表扩充为辅。
4. **观察项**：`agentLoop.ts:313` 主循环不分流 anthropic 协议（打 OpenAI 端点），
   是否已有已知 issue 覆盖？不在本批次范围，仅提示。
