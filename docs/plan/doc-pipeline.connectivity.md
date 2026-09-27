# doc-pipeline 阶段 6.5 — 模块连通性验证报告

> 分支 `feat/doc-pipeline` @ `187c472`｜验证日期 2026-09-27｜方法：**Read/Grep 实证核对**（不采信计划文档的行号/结论）。
> 行号为该 HEAD 快照，后续改动后以符号名定位。
> 状态口径：**✅ 通畅** = 两端契约 + 数据格式 + 错误处理 + 向后兼容四项均核实；**⚠️ 风险** = 结构连通，但存在生产不可达 / 边界数据不一致 / 已归档取舍；**❌ 断裂** = 两端契约或数据格式对不上、链路走不通。

---

## 0 总览

| # | 链路 | 状态 | 一句依据 |
|---|---|---|---|
| 1 | 上传解析链：`DIALOG_OPEN_FILE(upload)` → composer → `KB_PARSE_DOCUMENT` → `parseDocument` → `parseLimiter` | ✅ | 双模式 handler、7 格式白名单、options 第 5 参边界校验、限流四点全实接 |
| 2 | 发送落库渲染链：占位符 → `AGENT_RUN` → `parsed_attachments`/`attachments_json` → 气泡 → prompt | ⚠️ | 主链通畅；>20 附件主进程静默截断，占位符数与落库行数可能不一致（R6） |
| 3 | 入库与向量回填链：`importDirAsKb`/附件入 KB → `kbIndexOpts` → `scheduleVectorBackfill` | ✅ | 4 个索引入口（保存防抖/重索引/目录导入/文本与附件导入）全部真实配置 + 回填接线 |
| 4 | 检索 → citation → `refsJson` → 气泡回链 | ⚠️ | 两端契约一致（`searchDocument`↔`collectCitations`、`refsJson` 三处同步），但 `searchKB` 因 `useKnowledgeBase` 恒 false 生产不可达（R1） |
| 5 | 外发同意闸：`allowSend` × 勾选授权 → `filterKbEgressResults` → `searchKb` 外发口 | ⚠️ | 过滤层 fail-closed 正确，但闸门两把锁（KB 开关 / allowSend 开关）在生产 UI 均不可达（R1、R2），且 `searchDocument` 旁路（R3） |
| 6 | 多模态图片链：粘贴/选择 → `imageStorage` 落盘 → 相对路径 → `agentMedia` → `llmClient` content 数组 → 事件回放 | ⚠️ | LLM 通路全通；回执后相对路径缩略图 404、图片 citation 打开被拒（R4、R5） |
| 7 | PDF 版面与 D 路线链：`parseDocument({userId})` → `shouldUseDRoute` → `runDRoute` | ✅ | handler 边界校验 + renderer 3 个调用点 + 发送补解析共 5 处 userId 全贯通，缺 options 向后兼容 |
| 8 | 文件树链（B9）：`currentFileRef` 引用模式 + md 相对路径图片注入 | ✅ | 载荷 → extra 白名单 → payload → `buildDocumentContext` 引用模式全链接线，DB/welcome 文档零引用保持旧行为 |
| 9 | 新 IPC/事件三处一致性：`attachment:open-source`、`parseDocument userId`、`done.refsJson`、`uploadKbDefault` | ✅ | constants / preload / renderer / docs 逐项对齐，§1.3「新增通道三处同步」满足 |
| 10 | 删除清理链：附件删除 → KB 清理；会话删除 → 图片/附件行 | ⚠️ | 删除函数成对实现，但 `removeParsedAttachment` 零生产调用方（R7）、会话删除留孤儿行（R8） |
| 11 | 打包体积门禁链（B10）：`prebuild clean` → `build.files` 排除 → `postbuild sizeGate` | ⚠️ | 脚本三段接线 ✅ 实测属实；linux AppImage target 与 liteparse 排除互斥（R9） |
| 12 | Docling PoC 隔离（B12） | ✅ | 依赖隔离在 `scripts/docling-poc/`，主 `package.json` 零 docling 依赖、`documentParser.ts` 零改动 |

**计数：12 条｜✅ 6｜⚠️ 6｜❌ 0**

---

## 1 断裂（❌）清单

**无。** 未发现任何两端契约（函数签名 / IPC 通道名 / 事件字段名与形状）或数据格式（字段类型、必选/可选）对不上的断点。全部 ⚠️ 均属「链路可通但触发条件不可达 / 边界数据不一致 / 已归档取舍」，是否修复由主会话决定。

---

## 2 风险清单（⚠️ R1–R10，证据为 文件:行号）

| ID | 风险 | 证据 |
|---|---|---|
| R1 | **`searchKB` 生产不可达**：`useKnowledgeBase` 初值 `false`，`setUseKnowledgeBase` 全仓零调用方；`toolsForIntent` 的 kbQa/rewrite/create/tech 四分支均要求该标志 → 检索、citation（searchKB 分支）、外发闸注入矩阵在生产 UI 恒不触发（B11 status 已如实标注为 Module 10 移除后的废弃开关，不恢复） | `src/render/stores/agentStore.ts:290`、`:1113`、`:989`；`src/main/ai/agent/agentToolSelector.ts:109,122,140,147`；`src/main/ai/agent/agentContext.ts:317`；`src/main/ai/agent/agentLoop.ts:243` |
| R2 | **`allowSend` 无可达设置入口**：DB 默认 `0`；唯一 UI `ConsentOverlay` 只在 `pendingConsent` 时出现，而 `pendingConsent` 仅由（a）`useKnowledgeBase && !allowSend`（因 R1 死）或（b）`consent_required`（`needsConsent` 恒 false）触发 → `filterKbEgressResults` 生产不执行；i18n `ai.settings.allowSend` 为孤儿键 | `src/main/db/index.ts:171`；`src/render/components/AIAgent/panel/AIAgentPanel.tsx:377-390`；`src/render/stores/agentStore.ts:598,1003,1072`；`src/main/ai/consent.ts:10-12`；`src/main/ai/ipc/shared.ts:65` |
| R3 | **`searchDocument` 未过外发闸**：直接把附件正文片段交 LLM，不经 `filterKbEgressResults`，与 `searchKB` 的闸形成旁路（附件为用户主动上传、且解析产物本就不入 prompt，是否需同等闸需产品裁定） | `src/main/ai/tools/searchDocument.ts:178-230`；对照 `src/main/ai/knowledge/kbSearch.ts:427-435` |
| R4 | **回执后图片缩略图 404**：`persistIncomingAttachments` 返回**相对路径**并经 `AGENT_RUN` 回执回填覆盖乐观项；仅粘贴图有 `thumb`（data URL），选择器选取的图片无 thumb → `toImgSrc` 对相对路径原样返回 → `<img src="attachments/...">` 加载失败，直到重载会话（DB 读侧重建绝对路径）才恢复 | `src/main/db/attachments.ts:461-462`；`src/main/ai/ipc/agentHandlers.ts:189-196`；`src/render/stores/agentStore.ts:1051-1067`、`:655`；`src/render/components/AIAgent/message/AIMessageBubble.tsx:380`；`src/render/editor/kernel/inlineRenderer.ts:58-62`；恢复点 `src/main/db/ai.ts:567-573` |
| R5 | **图片附件 citation 点击必失败**：`attachments_json` 中图片存相对路径（`db/ai.ts:552`），`attachment:open-source` 显式拒绝非绝对路径 → 返回 `not a file path`（渲染层仅 console.warn）。文件附件（绝对路径）不受影响 | `src/main/db/ai.ts:548-564`、`:654-679`；`src/main/ai/ipc/agentHandlers.ts:93-99` |
| R6 | **>20 附件静默截断**：composer 无数量上限，主进程 `sanitizeIncomingAttachments` 截到 20 → `buildAttachmentSendText` 按 composer 全量拼占位符，与实际落库行数可能不一致 | `src/main/db/attachments.ts:31,315`；`src/render/components/AIAgent/composer/pasteAttachment.ts:247-254,304`；`src/render/components/AIAgent/panel/AIPanelComposer.tsx:421,441` |
| R7 | **「附件删除→KB 清理」休眠**：`removeParsedAttachment`（唯一删除点，内含 `removeByAttachment` + 搜索缓存失效）全仓仅测试调用；会话删除也不触发 | `src/main/db/attachments.ts:193-215`；`src/main/ai/knowledge/kbIndexer.ts:702-717`；调用方仅 `tests/main/db/attachments.test.ts:210,218,226,235` |
| R8 | **会话删除不清理 `parsed_attachments` 行**：该表 `conversation_id` 无外键级联；删除只删会话 + 落盘图片文件 → 孤儿行（其 path 指向已删文件） | `src/main/db/index.ts:635-645`；`src/main/ai/ipc/chatHandlers.ts:96-114`；`src/main/db/ai.ts:508-513` |
| R9 | **linux target 与 liteparse 排除互斥**：`build.files` 排除 liteparse 的 `.node/libpdfium.so`（win 瘦身），而 `linux.target: AppImage` 仍在 → 执行 linux 打包会缺原生件（`docs/guide/packaging.md` 已写警示，此处核对代码现状属实） | `package.json:104-109`、`:134-136` |
| R10 | **`AI_CHAT` 附件/入 KB 链休眠**：主进程 `ChatReqPayload` 有 `attachments/uploadToKb`，preload `ai.chat` 类型缺这两字段，渲染层 grep 无 `.chat(` 调用（Chat 模式废弃）→ 契约不一致但零调用方，无实际断裂面 | `src/main/ai/ipc/chatHandlers.ts:46-53,290-327`；`src/main/preload.ts:129-133` |

> 附注（设计使然而非风险）：向量召回仅在 LLM 传 `hyde:true`（或 `searchMode∈{vector,hybrid}` 且给出 `queryVector`）时发生；`searchMode` 默认 `hybrid` 但无 `queryVector` → 纯 FTS5+标题（`src/main/ai/knowledge/kbSearch.ts:501,541`；`src/main/ai/tools/searchKBHandler.ts:63-79`）。B8 已记录该取舍。

---

## 3 逐链明细（接口契约 / 数据格式 / 错误处理 / 向后兼容）

### 链路 1 上传解析链 — ✅

| 接口 | 调用端 | 被调端 | 契约 |
|---|---|---|---|
| `dialog.openFile()` | `preload.ts:347` → invoke `{upload:true}` | `ipc-handlers.ts:140-177` | PASS（双模式：upload=7 格式+多选+只返 `{paths}`；无参=md 单选+读全文） |
| `dialog.open()`（编辑器） | `preload.ts:315` | 同一 handler，`options` 缺省 → upload=false | PASS（B2 双入口共享通道的向后兼容点） |
| `kb.parseDocument(path,name,mime,opts)` | `AIPanelComposer.tsx:296-305,414-423`、`KnowledgeBaseSettings.tsx:57-59`、`pasteAttachment.ts:283-306` | `kbHandlers.ts:259-289` | PASS（第 5 参 `options` 形状在 IPC 边界校验：`typeof options.userId==='string'` 才透传，否则 `undefined`） |
| 限流 | — | `parseLimiter.ts:28-49`（`PARSE_MAX_CONCURRENCY=3`，FIFO），三处调用：`kbHandlers.ts:278,327`、`attachments.ts:405` | PASS |

- 数据格式：`IDocumentParseResult`（text/headings/sections/tables/images/pageCount/parseVersion/degraded）→ `extractStructure`（`shared/ai/document.ts:133`）→ `IAttachmentPayload.structure` → 主进程 `sanitizeStructure` 白名单（`db/attachments.ts:243-309`，含 `images`/`metadata.headersFooters`）。
- 错误处理：白名单不中直接 `{success:false}`（`kbHandlers.ts:269-271`）；解析异常包装返回（`:282-287`）；单文件失败不断批（`pasteAttachment.ts:301-304`）。
- 向后兼容：无 `options` 调用方（浏览器 mock `weaveMDBridge.ts:749-764`）不受影响；`KB_PARSE_DOCUMENT` 老签名（3 参）仍合法。

### 链路 2 发送落库渲染链 — ⚠️（R6）

- 契约：`buildAttachmentSendText` 占位符（`pasteAttachment.ts:247-254`）→ `sendAgentMessage(text, attachments)`（`agentStore.ts:592,643-667`）→ `ai.runAgent({attachments, uploadToKb, ...})`（`:984-1000`）→ `AGENT_RUN`（`agentHandlers.ts:141-179`）→ `persistIncomingAttachments`（`db/attachments.ts:345-474`）→ `extra.attachments` → `readTaskPayload`（`agentTaskWorker.ts:340-368`）→ `prepareAgentContext` 落 `attachments_json`（`agentContext.ts:215-224`）→ `mapMessageRow` 读回（`db/ai.ts:575-606`）→ `AgentTab.tsx:129` 气泡 chips。**全段 PASS**。
- 占位符进 prompt：`message`（含 `[文件: xxx]`）即 LLM userText（`agentContext.ts:200,377-390`），附件正文**不**入 prompt（仅 images 经 `buildImageParts` 注入，见链路 6）。PASS。
- 数据格式：`IAttachmentPayload`→`IAttachmentMeta` 白名单序列化剔除 `thumb/content`（`db/ai.ts:548-564`）；三态 `pending→processing→done|error`；回执 `IAttachmentMeta[]` 与渲染层乐观态字段名一致（`agentStore.ts:1051-1067`）。
- 错误处理：单附件失败不断批、DB 异常兜底不阻断发送（`attachments.ts:446-451`）；`parseStatus/error` 三态上屏。
- 向后兼容：旧消息 `attachments_json` NULL/坏 JSON → `attachments` 为 `undefined`，气泡不渲染附件区（`db/ai.ts:584-593`；组件测试锁定）。
- ⚠️ **R6**：>20 附件静默截断（占位符数 ≠ 落库数）。

### 链路 3 入库与向量回填链 — ✅

| 索引入口 | `kbIndexOpts(userId)` | `scheduleVectorBackfill` |
|---|---|---|
| 保存防抖（`ipc-handlers.ts:64-76`） | ✅ `:71` | ✅ `:72` |
| `KB_REINDEX` → `reindexFromKbOrFile`（`kbHandlers.ts:433-449`） | ✅ `:442` | ✅ `:445` |
| `importDirAsKb`（`:306-358`，7 格式白名单 `:322`，先 parse 再 index，fs 读禁） | ✅ `:341`（+`pageOffsets :343`） | ✅ `:356` |
| `KB_IMPORT_FILE` 文本（`:75-83`）/ 附件 `importAttachmentAsKb`（`:367-408`） | ✅ `:80` / `:395` | ✅ `:85` / `:406` |

- `kbIndexOpts`（`:455-462`）→ `resolveEmbedding`（`vectorBackfill.ts`）失败收敛 `{}` → 纯 FTS5 不破坏；`writeChunks` 写 `heading_path` + 向量（`kbIndexer.ts:430-498`），`chunkEmbeddingText` 仅向量侧加前缀（`:422-427`）。
- 附件入 KB：`source_type='attachment'` + `attachment_id` + `consentGranted` 贯通 `indexImportedText`（`:606-640`）；勾选是唯一触发（`agentHandlers.ts:176-178`、`chatHandlers.ts:316-318` → `importAttachmentsAsKb:416-430` 仅 `file+done`）。
- 回填：`scheduleVectorBackfill`（防抖 2s、running 重入保护、未配置 embedding 直接不扫库，`vectorBackfill.ts:131-163`）。
- 错误处理：单文件异常写 `recordImportFailure`（`status='error'`）不断批（`kbHandlers.ts:346-353`）；附件不存在不落孤儿行（`:374-382`）。
- 向后兼容：D1/D2/D3/D5/D5b/D7 均为追加式幂等迁移且启动调用（`db/index.ts:270-283`），零 DROP。

### 链路 4 检索 → citation → refsJson → 气泡回链 — ⚠️（R1）

- 数据流（结构 PASS）：`searchKB` 结果含 `sourceRef`（`shared/ai/kb.ts:88`）/ `searchDocument` 输出 `{attachmentId, fileName, matches[{page}]}`（`searchDocument.ts:220-229`）→ `collectCitations`（`agentToolExecutor.ts:294-342`，两工具形状逐一匹配）→ `mergeCitations` 封顶 10（`:345-359`）→ `citationRefsJson`（`agentLoop.ts:161-165`）→ 落库 `appendMessage refsJson`（`:181-187,529-535`）+ `AI_STREAM_DONE.refsJson`（`:189-195,537-543`）→ preload map（`preload.ts:443-455`）→ `finishAndPersist(evt.refsJson)`（`agentStore.ts:439-445`）与回放（`:1664-1675`）→ `AIMessageBubble.parseRefsJson`（`:67-102`，读 `page/attachmentId/fileId`）→ 点击 `attachment.openSource`（`:305-318`）/ `file.get`（`:290-303`）。
- `source_ref` 页码来自 B7 `pageOffsets` 二分 + 第 5 参 `attachmentId`（`kbIndexer.ts:447-453,507-517`），附件锚点由 `indexImportedText` 传入（`:631-633`）。
- 向后兼容：`refsJson` 为 JSON 级可选、历史消息 `null` 正常渲染（组件测试锁定）；done 无该字段 → preload `?? null`。
- ⚠️ **R1**：`searchKB` 分支因 KB 开关恒 false 不可达 → 生产实际只有 `searchDocument` 分支产生 citation（该分支仍能带 `attachmentId+page`，回链可用）。

### 链路 5 外发同意闸 — ⚠️（R1、R2、R3）

- 闸逻辑（结构 PASS、fail-closed）：`needsKbSendConsent = !allowSend`（`consent.ts:10-12`，缺行默认 `allowSend:false`，`ipc/shared.ts:65`）→ `agentContext.ts:301-323`（`kbEgressAuthorized` 恒 `!allowSend`；勾选授权附件存在性 `hasGrantedAttachmentDocs`，异常按无授权）→ `toolsForIntent` 第 7 参 `kbAttachmentEgressGranted`（`agentToolSelector.ts:56-65`：`kbSearchAllowed = kbEgressAuthorized || kbAttachmentEgressGranted`）→ `searchKb` 闭包唯一出口过滤（`agentTaskWorker.ts:389-407`：`consent.allowSend` 早返回；否则 `filterKbEgressResults(res,false,getGrantedAttachmentDocIds(u))`，白名单查询失败用空集合兜底）→ `filterKbEgressResults`（`kbSearch.ts:427-435`：笔记永不入列、best 同步收敛）。
- 白名单数据层：`getGrantedAttachmentDocIds` / `hasGrantedAttachmentDocs`（`db/kb.ts:245,256`）；`consent_granted` 由 `importAttachmentAsKb` 贯通（`kbHandlers.ts:364-404`，缺省不写键 fail-closed；`kbIndexer.ts:623,672`）。
- 勾选链（B11 Q2）全通：`constants.ts:186-187` → `configConsentHandlers.ts:131-160` → `preload.ts:416-418` → `agentStore.ts:505-543,1133-1147` → composer 勾选 UI `AIPanelComposer.tsx:534-546` → 载荷 `uploadToKb`（`agentStore.ts:999`）→ `agentHandlers.ts:176-178`；D5 列 `db/index.ts:390`。
- 向后兼容：旧库 `upload_kb_default` NULL → 默认勾选；`consent_granted` DEFAULT 0。
- ⚠️ **R2**（allowSend 无入口）、**R1**（注入矩阵不可达）、**R3**（`searchDocument` 旁路）。

### 链路 6 多模态图片链 — ⚠️（R4、R5）

- 入口：粘贴双兜底（`pasteAttachment.ts:213-237`）/ 选择器（`AIPanelComposer.tsx:429-446`）→ `validateImageAttachment` 入口拒 svg（`pasteAttachment.ts:54-60`）。
- 落盘：`persistIncomingAttachments` 图片分支（`db/attachments.ts:378-397`）→ `storeAttachmentImage`（data URL 就地解码 / sourcePath），成功写 `relPath` → `attachments_json` 存相对路径（`db/ai.ts:552`），读侧 `resolveAttachmentPaths` 重建绝对（`:567-573`）。
- 注入：`agentContext.ts:334-360`（历史 `injectImagesIntoMessages` 近 3 张 / 当前轮全量）→ `agentMedia.ts:160-186,209-244`（`resolveStoredPath` 重建、缺文件计入 `unreadable`、vision 不支持 degraded）。
- 发线：`llmClient.ts:71-94` `resolveContentForWire`（本地路径 → data URL，读失败降级占位文本 part）→ `:331` 挂在 `streamChatCompletion`；anthropic 分流 `anthropicCompat.ts:50-75`。
- 事件回放：`agentEventStore.ts:33-55` 写入/回放双净化（data URL→占位、附件根内绝对路径→相对），纯文本原样透传。
- 向后兼容：纯文本 `content:string` 零改动（B6 专项断言）；历史消息无 `attachments` 不注入。
- ⚠️ **R4**（回执相对路径缩略图 404）、**R5**（图片 citation 打开被拒）。

### 链路 7 PDF 版面与 D 路线链 — ✅

- `KB_PARSE_DOCUMENT` 第 5 参边界校验（`kbHandlers.ts:272-276`，无 options 向后兼容）→ `parseDocument(filePath,fileName,mime,{userId})`（`documentParser.ts:506+`）→ 版面 `analyzePdfLayout`/`shouldUseDRoute`（`:253`）→ `runDRoute({...,userId}` `:256-262`）；`.doc` 无 userId 直接给「另存为 docx」指引（`:518-520`）、有 userId 优先 D（`:544-550`）。
- userId 5 处贯通：composer ×2（`AIPanelComposer.tsx:299-301,417-419`）、设置页（`KnowledgeBaseSettings.tsx:57-59`）、发送补解析（`db/attachments.ts:404-407`）、目录导入（`kbHandlers.ts:328`）。
- 结构回写：`pageCount/pageOffsets/sections/tables/images/metadata/parseVersion` → `structure_json`（`db/attachments.ts:411-425`；sanitize 白名单 `:243-309`）；`DOCUMENT_PARSE_VERSION=2`。

### 链路 8 文件树链（B9）— ✅

- `buildCurrentFileRef`（`agentStore.ts:58-68`：welcome:// 与 DB 文档不带引用）→ `runAgent`（`:982-993`）→ `agentHandlers.ts:138` → `agentTaskWorker.ts:334-337,368` → `buildDocumentContext(currentDocument, currentFileRef)`（`agentContext.ts:459-460` → `agentPromptBuilder.ts:88-93` 引用模式：文件名+路径+摘要，正文交 `readLocalFile`）。
- md 相对路径图片：`agentContext.ts:354-360` → `buildMdImageContext`（`mdImageResolver.ts:295,340` 复用 `buildImageParts`，越界先于存在性拦截）→ `VISION_DEGRADED_NOTICE`/notes 随 LLM 消息（`:375-379`），不写消息表。
- 向后兼容：无 ref → 旧整篇注入 + 截断，存量断言零修改。

### 链路 9 新 IPC/事件三处一致性 — ✅

| 项 | constants | preload | renderer | docs/modules/08 |
|---|---|---|---|---|
| `attachment:open-source` | `constants.ts:173` | 类型 `preload.ts:117-120` + 实现 `:368-369` | `AIMessageBubble.tsx:307-308`（bridge mock `weaveMDBridge.ts:661`） | `:164` ✅ |
| `ai:get/set:uploadKbDefault` | `constants.ts:186-187` | `:416-418` | `agentStore.ts:505-506,1143-1146`（mock `:705-706`） | `:136` ✅ |
| `KB_PARSE_DOCUMENT` 第 5 参 `options.userId` | 既有通道（非新增，§1.3 不强制 docs 字段级） | 类型 `:276-281` + invoke `:562-563` | 3 调用点（链路 7） | `:150` 通道行 ✅ |
| `done` 事件扩 `refsJson` | 非新通道 | map `:443-455`；共享类型 `shared/ai/conversation.ts:72-76` | `agentStore.ts:444,1665`；`finishAndPersist(refsJson)` `:387-388` | `:138 ai:stream:*` 通用行（字段级未列，符合「新增通道才三处同步」） ✅ |
| handler 注册 | — | — | — | `ai/ipc/index.ts:27-39` 全部注册 ✅ |

- 错误处理：`attachment:open-source` 载荷校验 + 绝对路径（盘符/根/UNC 显式白名单，规避 vitest browserify posix `path.isAbsolute`）+ 7 格式白名单防伪造 `.exe`（`agentHandlers.ts:77-106`）。

### 链路 10 删除清理链 — ⚠️（R7、R8）

- 已实现且成对：`removeParsedAttachment`（`db/attachments.ts:193-215`）→ `removeByAttachment`（`kbIndexer.ts:702-708`，清 KB + `invalidateKbSearchCache`）→ `imageStorage` 删除文件（`:233` 注释约定配对）；设置页删除走 `KB_DELETE fileId|docId`（`kbHandlers.ts:119-135` → `removeByFile/removeByDocId` 均失效缓存 `kbIndexer.ts:690-717`）。
- ⚠️ **R7**：`removeParsedAttachment` 零生产调用方 → 该链在产品内无入口；**R8**：会话删除只删会话+图片文件，`parsed_attachments` 无 FK 级联 → 孤儿行。

### 链路 11 打包体积门禁链（B10）— ⚠️（R9）

- `package.json:14-20`：`prebuild → clean`、`build = vite build && electron-builder`、`postbuild → size` 三段接线 ✅；`build.files` 21 条 `!` 排除（`:96-118`，react-icons/monaco/liteparse-linux/jieba-web·deno·bundler/better-sqlite3 deps）✅；`better_sqlite3.node` 不在排除清单（防误伤）✅。
- ⚠️ **R9**：`linux.target: AppImage`（`:134-136`）与 liteparse 排除（`:104-109`）互斥（packaging.md 已警示）。

### 链路 12 Docling PoC 隔离（B12）— ✅

- 根 `package.json` dependencies 无 `docling.rs`（实测全量依赖清单核对）；PoC 依赖隔离在 `scripts/docling-poc/`；`documentParser.ts`/打包配置零改动（与 PoC 报告声明一致）；替换 A 路线须先重跑七-3 门禁的红线写在报告内。

---

## 4 方法与局限

- 仅静态只读核对（Read/Grep + 只读 git/ls），**未运行** vitest / E2E / 打包；各批门禁结论引自 `docs/plan/doc-pipeline.status.md`。
- 行号为 `187c472` 快照；跨批改动后请以符号名（如 `filterKbEgressResults`、`persistIncomingAttachments`）定位。
- 「生产不可达」判定依据为全仓 grep（如 `setUseKnowledgeBase(` 仅定义无调用、`ai.chat(` 渲染层零调用），未做运行时插桩验证。

---

## 结构化摘要

{链路总数: 12, ✅: 6, ⚠️: 6, ❌: 0}
断裂：无。风险 R1~R10 见 §2，是否修复由主会话/需求方裁定。
