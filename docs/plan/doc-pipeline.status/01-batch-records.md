# doc-pipeline — 逐批执行记录（阶段 3~8，B1~B12）

> 拆分自 [doc-pipeline.status.md](../doc-pipeline.status.md)，原 §阶段 3~8：执行中（B1~B12 完成记录）；2026-09-27 按渐进式披露拆分，正文未改动。
> 返回索引：[doc-pipeline.status.md](../doc-pipeline.status.md)

---

## 阶段 3~8：执行中

- **2026-09-25 计划已获用户放行**（选项：按计划全量放行；L4 批次 B6/B10/B11 执行前再次确认）。

### B1 完成（2026-09-25，commit `7056dcf`）

- **范围**：二-1 统一解析入口 + 二-2 xls/xlsx + 二-6 类型契约（TDD strict）。
- **状态**：✅ 完成。证据：`docs/testing/doc-pipeline-b1.tdd.md`。
- **交付**：`parseDocument` 返回结构化产物（headings/sections/tables/images/pageCount/parseVersion/degraded）；
  新增 `parseXlsx`（多 sheet→章节标题、`!merges` 还原、公式取缓存值、列宽归一防错位）；
  `parsePdf` 按实测适配 `LiteParse` API（`LlamaParseReader` 实测不存在，伪造 shim 已删）；
  `.doc` 按 Q3 降级（D 路线随 B7、无 OCR）；`isSupportedDocument` 接线进 `KB_PARSE_DOCUMENT`（取「接线」，理由见 TDD §8.2）；
  bridge mock 受控实现；依赖新增 `xlsx@0.18.5`。
- **门禁**：tsc 0 error / vitest 139 文件 3250 passed / lint 0 error（108 存量 warning）/
  vite build exit 0 / E2E 31f·97p·1s **与基线完全一致零新增**（反证实验：回退本批次渲染层 2 文件重跑失败子集同 7 条失败，TDD §6）。
- **遗留**：E2E 存量 31 failed 属前序已裁定范围，B1 不处理；`KB_PARSE_DOCUMENT` 的 composer/文件树真实调用方按计划随 **B2**。
- **下一任务**：B2（一-1/一-2/一-3 上传接线，依赖 B1 解析层）。

### B2 完成（2026-09-26）

- **范围**：一-1 格式白名单 + 一-2 多选批量 + 一-3 粘贴上传（TDD strict，含 Playwright E2E）。
- **状态**：✅ 完成。证据：`docs/testing/doc-pipeline-b2.tdd.md`。
- **交付**：`DIALOG_OPEN_FILE` 参数化双模式（`{upload:true}`：7 格式 + `multiSelections` + 返回 `{paths}` 保序 + 无 `readFileSync`；无参数：编辑器 `file.open` 保持 md 单选 + 全文——**双入口共享通道为计划未披露耦合，自检发现并修复，补 2 条回归锁定**）；preload `dialog.openFile` 类型/参数同步；新建 `parseLimiter.ts`（信号量，默认并发 3）并接线 `KB_PARSE_DOCUMENT`；`AIPanelComposer` 收路径数组逐个解析（单文件失败不断批）、chips >5 折叠「N 个附件」、粘贴换 `handleComposerPaste`（图片双兜底 + 7 格式文件分支 + 防重复插入，照 ContentBlock 范式）；新建 `composer/pasteAttachment.ts` 纯函数模块（覆盖率门禁所需，偏离记录见 TDD §8.1）；bridge 拆 openFile/uploadFile 两 mock + `pickImage` 恒 null → 受控返回；`KnowledgeBaseSettings` 契约波及伴随适配（取首路径走 `KB_PARSE_DOCUMENT`）。
- **门禁**：tsc 0 error / vitest **141 文件 3280 passed 0 failed** / lint 0 error（108 存量 warning）/
  vite build exit 0 / E2E **31 failed·1 skipped·101 passed（133 条）**——31 failed 与基线逐条同名单（脚本比对零 B2 失败），4 条新增用例全过，**零新增失败**。
- **遗留**：图片 data URL 仅内存 chips（落盘随 **B6**、正文占位符随 **B3**，批次边界见 TDD §8.4）；粘贴无 path 二进制文件跳过不断批（Electron `File.path` 正常走解析层）；E2E 存量 31 failed 不属本批次。
- **下一任务**：B3（一-4 附件持久化与消息渲染：`attachments_json` 幂等迁移 + `parsed_attachments` DAO + 气泡三态）。

### B3 完成（2026-09-26）

- **范围**：一-4 附件持久化与消息渲染 = D1/D2 数据迁移 + `parsed_attachments` DAO 启用 + 发送链路落两表 + 气泡三态（TDD strict，L3 数据迁移）。
- **状态**：✅ 完成。证据：`docs/testing/doc-pipeline-b3.tdd.md`。
- **交付**：
  - **D1/D2 迁移**：`db/index.ts` 新增可测导出 `addAttachmentColumns`（`ai_messages.attachments_json TEXT DEFAULT NULL` + `parsed_attachments.parse_status TEXT DEFAULT 'done'` / `parse_version INTEGER DEFAULT 1`），追加式、幂等、零 DROP；调用点在建表之后（D2 依赖，偏离记录 TDD §8.1）。
  - **DAO 启用**：新建 `src/main/db/attachments.ts`（insert OR REPLACE/get/updateStatus/updateContent/remove/listByConversation 全参数化 + user_id 过滤 + 边界校验 sanitize + 20 项截断）+ **三态状态机** `persistIncomingAttachments`（pending → processing → done|error；有产物直写 done、无产物有路径经 parseLimiter 补解析、图片 data URL 转存 content、皆无 error）。
  - **两表分工**：`appendMessage` 10 参写 `attachments_json`（**白名单序列化**，thumb/content 剔除）；正文只在 `parsed_attachments.content`；`IAIMessage.attachments` 可选（旧消息 NULL/坏 JSON 向后兼容）；`IAttachmentPayload` 死类型复用补 `id/path/size/parseStatus` + 新增 `IAttachmentMeta`。
  - **发送链路**：AGENT_RUN 先落两表 → 元数据随 payloadJson → prepareAgentContext 写用户消息 → 回执 `attachments` 回填渲染层乐观态；AI_CHAT 同构；`agentLoop/agentContext/agentTaskWorker` 透传。
  - **渲染层**：`handleSend` 只拼 `[文件: xxx]`/`[图片: xxx]` 占位符（**不再拼接 att.content，解决打爆 CONTEXT_WINDOW=64000**）；`sendAgentMessage(text, attachments?)` 载荷随行（emitAgent 无附件保持单参兼容）；气泡 chips + 图片缩略图（thumb 存活态 / path→media:// / 图标降级）+ 解析中/失败/完成三态；i18n 三语 catalog。
  - **真库验证**：新建 `scripts/attachments-migration-smoke.cjs`（Electron 运行时真 SQLite 四态，DDL 从源码正则抽取防漂移），退出码 0。
- **门禁**：tsc 0 error / vitest **143 文件 3325 passed 0 failed**（+45）/ lint 0 error（108 存量 warning）/ vite build exit 0 / E2E **31 failed·1 skipped·101 passed（133 条）**——failed 名单构成与基线逐条同（ai-agent-panel 恰 4 条 A2/A3/A4/①），**零新增失败**；迁移三断言 vitest（FakeDb）+ 真库 smoke 双轨全过。
- **遗留**：历史粘贴图片（无 path）重载后缩略图待 **B6** 落盘产 path；改写类路由不携带附件载荷（TDD §8.6 记录取舍）；`attachments.ts` DB 异常兜底分支未单测（TDD §5）；E2E 存量 31 failed 不属本批次。
- **下一任务**：B4（四-3 批量导入通道：`importDirAsKb` 扩 7 格式 + 先 `parseDocument` 再入索引 + `parsed_attachments.id` 关联）。

### B4 完成（2026-09-26）

- **范围**：四-3 批量导入通道 = `importDirAsKb` 解析先行 + 失败 `status='error'` 可见 + 附件入 KB 关联 + **D3** `kb_documents.attachment_id`（TDD strict，L3 数据迁移）。
- **状态**：✅ 完成。证据：`docs/testing/doc-pipeline-b4.tdd.md`。
- **交付**：
  - **目录导入改造**：`importDirAsKb` 正则扩 7 格式（`isSupportedDocument` 白名单）；**先 `parseDocument`（parseLimiter 限流）再 `indexImportedText`，导入路径零文件字节读取**（fs 读禁断言锁定，pdf 不再 utf-8 直读乱码入库）；单文件解析失败/抛异常写 `recordImportFailure`（`status='error'` + 原因进 `IKbImportResult.error`）不静默、不断批。
  - **附件入 KB**：`importAttachmentAsKb` 读 `parsed_attachments`（user_id 归属过滤）→ `source_type='attachment'` + `attachment_id` 入索引；不存在附件不落孤儿行、未解析完成写 error 行；**复用 `kb:import:file` 载荷二选一**（`KbImportFileRequest`），不新增通道（§1.3 三处同步不触发，取舍 TDD §8.1）。
  - **删除链路**：`removeParsedAttachment`（唯一删除点）成功即 `removeByAttachment` 清理 KB + 搜索缓存失效（对齐 `cleanupKbAfterFileDelete` 模式）；`KB_DELETE` 载荷扩 `docId`（导入/错误行 `file_id` 为 NULL 可删），设置页删除按钮全量渲染、`triggerKbDelete` 改对象入参（偏离记录 TDD §8.2）。
  - **D3 迁移**：`db/index.ts` 新增可测导出 `addKbAttachmentColumns`（`attachment_id TEXT DEFAULT NULL` + `idx_kb_doc_user_attachment`），追加式、幂等、零 DROP；`upsertKbDocument` 按 `attachmentId > fileId > 新建行` 查找优先级收敛（附件重试幂等）；`KbIndexOpts` 扩 `sourceType/attachmentId` 贯穿 indexFile/indexImportedText。
  - **真库验证**：新建 `scripts/kb-attachment-migration-smoke.cjs`（Electron 运行时真 SQLite 四态，DDL 从源码正则抽取防漂移），退出码 0；B3 `attachments-migration-smoke.cjs` 回归亦 4 态全过。
- **门禁**：tsc 0 error / vitest **145 文件 3370 passed 0 failed**（+45；收尾 03:14 实测）/ lint 0 error（108 存量 warning）/ vite build exit 0 / E2E **31 failed·1 skipped·101 passed（133 条）**——failed 按 spec 构成与基线逐条同名单（ai-agent-panel 4 / drag 5 / table 7 / feedback 5 / float-toolbar 2 / thematic 2 / exit 2 / editor 1 / image-resize 1 / recent-history 1 / welcome 1），**零新增失败**；迁移三断言 vitest（FakeDb）+ 真库 smoke 双轨全过。
- **遗留**：设置页单文件导入解析失败无行内提示（TDD §8.6）；目录导入重复行语义为既有状态未改（§8.4）；`database.md` kb_documents 字段表按计划归 **B11 八-3②** 对齐（§8.7）；入 KB 勾选 UI 随 **B11**；E2E 存量 31 failed 与 `cacheMonitor` 性能用例负载 flaky 不属本批次（TDD §6）。
- **下一任务**：B5（四-1 `kbIndexOpts()` 真实配置贯通 3 入口 + 四-2 `heading_path` 写入 + 三-2 表格 md 同批，D4 无 DDL）。

### B5 完成（2026-09-26）

- **范围**：四-1 Embedding 接通 + 四-2 `heading_path` 写入 + 三-2 表格 md 同批（TDD strict，L3；D4 无 DDL）。
- **状态**：✅ 完成。证据：`docs/testing/doc-pipeline-b5.tdd.md`。
- **交付**：
  - **四-1 接通**：新建 `src/main/ai/knowledge/vectorBackfill.ts`——`resolveEmbedding` 单点配置判定（复用 KB_STATUS 的 `kbEmbeddingProvider`+`apiKeyEnc` 语义，读 `ai_embedding_config` 真实 key 解密；任一环节失败降级 null→纯 FTS5）；`kbIndexOpts(userId)` 改读真实配置并 **贯通全部索引入口**：保存防抖（`ipc-handlers` 1200ms → `kbIndexOpts(userId)`，替换硬编码 `{}`）、手动重索引 KB_REINDEX、目录导入 importDirAsKb、文本/附件导入 KB_IMPORT_FILE——漏一条即部分摆设的卡点消除；每入口完成后 `scheduleVectorBackfill(userId)` 触发回填。
  - **向量回填任务**：`runVectorBackfill` 分批（20/批）限速（批间 300ms）扫描 `vector IS NULL OR embedding_model IS NOT ?`（**切模型旧向量渐进重算**）→ 批量 embedding → Float32 BLOB + `embedding_model` 写回；2s 防抖合并高频调度、running 重入防并发、失败收敛 `phase='error'` 可观测（状态机 pending→running→done|error 对齐 `kb_documents.status` 范式，进程内存态不加 DDL、不新增 IPC）；回填不经检索链路，**pending/error 期间 searchKB 走 FTS5 正常返回**（测试锁定）。
  - **四-2 heading_path（D4）**：`NoteChunk` 扩 `headingPath`；`splitNote` 内 header stack 计算 `" > "` 路径（80 字符截断、无标题空串）；`insertChunk`/`insertChunksBatch` 写 `heading_path` 列（空串归一 NULL，历史行读侧 NULL 降级）；`aggregateAndExpand` 生效验证 4 用例（heading 30% 提升触发、全空不误触发、isHeading+headingBoost、历史 NULL 不加成）——防历史回归。
  - **三-2 表格分块（同批强制）**：`splitNote` 重写为「结构单元扫描 → 贪心合并 → 原子输出」：GFM 表格判定（表头/分隔行单元数相等 + 未转义管道计数）、**整表独立成 chunk 不与正文混切**；超长表按行切片、**每片重复表头行+分隔行**（配对保持、片间零 overlap、单行超限不切单元格）；**标题统领**：标题+其下段落 ≤targetSize 合并 1 chunk；超长段保留旧断点+overlap 兜底语义。
  - **模型过滤（检索侧）**：`vectorSearch` 加 `embeddingModel` 参数化子句（切模型后旧向量不参与 RRF）；`searchKB` 读当前 `ai_embedding_config.model` 透传；sqlite-vec prepare 抛错静默降级（`knowledge.md` 纯 FTS5 约定不破坏）。
- **门禁**：tsc 0 error（首轮 9 错已修）/ vitest **146 文件 3416 passed 0 failed**（B4 基线 3370 + 46）/ lint 0 error（108 存量 warning）/ vite build exit 0 / E2E **31 failed·1 skipped·101 passed（133 条）**——failed 按 spec 构成与基线逐条同名单，**零新增失败**；过程 1 次 `cacheMonitor` 性能用例负载 flaky（B4 已记录同款），单跑 37 passed、收尾全量绿。
- **遗留**：回填状态无 UI/IPC 展示（B5 验收点只要求可观测，测试与 `getVectorBackfillStatus` 承担；如需设置页展示列后续）；超宽表按单元格 emergency split（STC）未实现——无样例需求记录为可选增强；headingPath 未前置进 `content`（上下文前缀取舍按计划归 **B8 四-4②**）；E2E 存量 31 failed 不属本批次。
- **下一任务**：B6（五-1 `content` 数组 + 五-2 图片落盘 + 五-3 死代码接活，**L4 执行前需二次确认**）。

### B6 完成（2026-09-26，L4 已获用户放行）

- **范围**：五-1 `content` 数组贯通全调用点 + Q4 压缩丢图 + 五-2 图片落盘相对路径 + 五-3 死代码接活（TDD strict，**L4 核心 LLM 链路**）。
- **状态**：✅ 完成。证据：`docs/testing/doc-pipeline-b6.tdd.md`。
- **交付**：
  - **五-1 content 数组**：`llmClient` 新增 `ContentPart`/`MessageContent`/`LlmRequestMessage`，`resolveContentForWire` 发送前把本地图片路径读成 data URL（坏路径降级占位文本 part，绝不发破请求）；`anthropicCompat.toAnthropicContent` 转 `text`/`image` block（data URL→base64、http→url source）；`anthropicClient` system/messages 双处转换。**两套分流收口 `resolveModelProtocol`**：显式 `ai_config.protocol` 优先（既有 6 处范式不变），缺省按 `isAnthropicModel` 回退（该函数 B6 前零生产调用方，本次接入识别链路）。全部调用点类型贯通（rewrite/skillLoader 纯文本零改动、chatHandlers/agentContext 注入数组、事件回放净化）。
  - **Q4 压缩丢图**：`LlmMessage.content` 扩数组；`buildCompressed` 保留最近 **3** 张图片 part、更早图片原位降级 `IMAGE_DEGRADED_PLACEHOLDER`（显式提示）；`summarizeViaLlm` 压缩输入剥图（非 vision 模型压缩不再失败）；`estimateContentTokens`/`countMessageImages` 承担含图 token 估算。
  - **五-2 落盘**：`imageStorage` 重写为 `userData/attachments/{userId}/{conversationId}/{id}.{ext}`；消息 `attachments_json` **存相对路径**（写前 `toRelativePath`、读时 `resolveStoredPath` 重建）；**不新增 IPC 通道**——落盘在发送链路主进程 `persistIncomingAttachments` 完成（复用 `dialog:pick-image` / `clipboard:read-image`，§1.3 三处同步不触发，取舍记 TDD §8.1）；删除会话（IPC 层）/删除附件（`removeParsedAttachment`）同步清文件；svg 三重拒绝（dialog 过滤 + composer 入口 + 存储层）、bmp `nativeImage` 栅格化、gif 原样 + 首帧提示、单图 10MB 上限，失败原因经新字段 `IAttachmentMeta.error` 上屏。
  - **五-3 死代码接活**：`agentMedia` 新增 `buildImageParts`/`injectImagesIntoMessages`/`selectRecentImageIds`（主进程注入点，Chat `runChatFlow` 与 Agent `prepareAgentContext` 共用；当前轮全量、历史限 3 张；vision 不支持 → 不注入 + `VISION_DEGRADED_NOTICE`）；`imageRecognition` 接真实 `createRecognitionLlmCall`（protocol 分流 + usage 计价回调）并由 `recognizeImageAttachments` 在**两条发送链路**调用（不支持 vision 不发请求直接标失败、成功描述写 `parsed_attachments.content` 供附件入 KB 检索、失败「图片未成功识别」）；`processMedia`/`formatImageForLlm` 均有真实调用方。
  - **事件回放**：`sanitizeEventPayload` 写入（persistAndSend/persistOnly）+ 回放（replayFromSeq）双净化——data URL→占位、附件根内绝对路径→相对路径；checkpoint 走 `toCheckpointMessages` 文本化（不落 base64/路径）。
  - **计价**：`IMAGE_TOKENS_PER_IMAGE`/`estimateImageTokens` + `TokenUsage.imageTokens`/`CostEntry.imageCostUsd` **归因拆分**（provider promptTokens 已含图片，不重复计费）+ 成本表 Image 列；agentLoop 每轮按 `countMessageImages` 归因；识别调用 `onUsage` 上报。B7 D 路线直接复用。
  - **渲染层**：气泡缩略图点击 lightbox（遮罩/Esc 关闭）、图片失败态 `att.error ?? 图片未成功识别`、GIF 首帧提示；composer `validateImageAttachment` 入口拒绝 + `composer-image-notice` 提示行。
- **门禁**：tsc 0 error（首轮 13 错已修）/ vitest **152 文件 3500 passed 0 failed**（B5 基线 3416 + 84，18:45 实测）/ lint 0 error（106 warning，较基线 108 减 2）/ vite build exit 0 / E2E **31 failed·1 skipped·101 passed（133 条）**——failed 按 spec 构成与基线逐条同名单（table 7 / feedback 5 / drag 5 / ai-agent-panel 4 / thematic 2 / float-toolbar 2 / exit 2 / editor 1 / image-resize 1 / recent-history 1 / welcome 1），**零新增失败**；B6 触及文件语句覆盖率 81.7%~99.7%（聚合 84.87%）。过程 flaky：`cacheMonitor` 与 `ab-test` 两项存量性能断言负载间歇超阈（单跑 37/22 passed，收尾全量绿）。
- **纯文本链路回归（L4 最高优先级）**：content 类型放宽后既有断言**零修改**全部通过；另加 `resolveContentForWire` 纯文本逐字透传、`buildCompressed` 纯文本输出不变两条专门断言。
- **遗留**：识别调用同步阻塞发送（多图串行、单次 60s 超时，异步三态留后续）；Skill 链路 content 类型已贯通但输入无附件来源故不注入（取舍 TDD §8.7）；`IImagePayload` 仍无调用方（无使用场景，不强行接线）；图片向量按范围外不动；E2E 存量 31 failed 与性能用例 flaky 不属本批次。
- **下一任务**：B7（二-3 PDF 版面 + 二-4 D 路线 + 二-6 页码落库；D 路线图片计价复用 `estimateImageTokens`）。

### B7 完成（2026-09-26）

- **范围**：二-3 PDF 版面还原 + 二-4 D 路线（远程多模态兜底）+ 二-6 页码溯源落库（TDD strict，L3）。
- **状态**：✅ 完成。证据：`docs/testing/doc-pipeline-b7.tdd.md`。
- **交付**：
  - **二-3 版面还原**：新建 `src/main/ai/files/pdfLayout.ts`（纯函数、零 native 依赖）——(X,Y) 坐标聚类分栏（coverage-gutter 切分、全宽行 band 分隔、**先左栏后右栏**）、字号 > 字符权重 10% 基准 → 标题层级 1-6、无框线表格列 x-start 对齐还原（**Markdown + CSV 两态**、填充率判据防双栏散文误判）、**跨页表格合并**（页末表 + 次页页首对齐行吸收、重复表头丢弃、全局保留首表表头）、**页眉页脚跨页重复剔除入 `metadata.headersFooters`**（顶/底带 + 数字归一化）、**无文本层双低判定**（字符数/页面积比）、`columnDetectFailed`/`tableConfidence` 信号；`parsePdf` 接线 liteparse `textItems` → `analyzePdfLayout` → 结构化产物（pageOffsets 分页溯源）。
  - **二-4 D 路线**：新建 `src/main/ai/files/multimodalParse.ts`——`shouldUseDRoute` 显式三信号（no-text-layer / column-detect-failed / low-table-confidence，**正常文档不烧 token**）；`runDRoute` 执行：vision 前置判定（不支持 → 降级 A 路线 + 含模型名的显式提示、零请求）、页数上限 `MAX_D_ROUTE_PAGES=10` 截断显式提示、并发 `D_ROUTE_CONCURRENCY=2` 有界池、`estimateDRouteTokens` 复用 B6 `estimateImageTokens` 计价（调用后 `recordUsage` 图片归因）、`D_ROUTE_SYSTEM_PROMPT` 强制管道表格/数据输出禁评论感想、任一环节失败整体降级不产出残缺 D 文本；**`.doc` D 路线优先（Q3）**：有 userId 先试 D（pageCount=0 全渲染截断），不可用/降级 → 另存为 docx 文案。
  - **二-6 页码落库**：`buildSourceRef` 增 pageOffsets 二分 → `{fileName, page, offset}` **替代 60 字符行号近似**（md/txt 保留 line 兼容）；`KbIndexOpts.pageOffsets` 贯通目录导入/附件导入/单文件导入三链路；`parsed_attachments` 新增 **D7 `structure_json` 列**（页码/章节/表格序号 + parseVersion，独立幂等迁移函数、不动 B3/B4 已应用迁移、三断言齐备）；composer `ingestFilePaths` 提取 `extractStructure` 随附件载荷透传，主进程 `sanitizeStructure` 白名单校验后落库；`DOCUMENT_PARSE_VERSION` 升 **2**（pageOffsets/metadata/csv/dRoute 契约扩展）。
  - **接线**：`parseDocument` 增 `options.userId`（D 路线读 ai_config）；`KB_PARSE_DOCUMENT` 第 5 参 options（IPC 边界校验，无 options 向后兼容）；preload + renderer 3 个调用点传 userId；发送链路补解析传 userId + 结构回写 + **空文本 degraded 随 `IAttachmentMeta.error` 上屏**（无文本层给用户明确提示）。
- **选型（记录于 TDD §8.1）**：坐标与栅格化均用 `@llamaindex/liteparse` 实测能力（`textItems` x/y/width/height/fontSize、`screenshot()` PNG）——**不引入 pdfjs-dist，体积门禁（B10）零增量**。
- **门禁**：tsc 0 error / vitest **154 文件 3583 passed 0 failed**（B6 基线 3500 + 83）/ lint 0 error（106 warning，与基线持平）/ vite build 三段 exit 0 / E2E **31 failed·1 skipped·101 passed** 两轮实测与基线逐项一致、**零新增失败**；B7 触及文件语句覆盖率 **92.97%~100%**（聚合 95.79%，multimodalParse 首轮 73.38% 补默认依赖 8 例后 97.15%）。
- **遗留**：D 路线逐页独立识读（页间跨页表在 D 产物不合并，A 路线有完整合并）；计划 §3 数据变更点漏列 B7（按 §2-B7 落库要求补 D7，见 TDD §8.3）；页眉页脚单页独有文本不剔（跨页语义）。
- **下一任务**：B8（六-1 文档工具集 + 六-2 citation 回链 + 六-3 评测 + 四-4 检索质量，依赖 B7 真实页码）。

### B8 完成（2026-09-27）

- **范围**：六-1 文档四工具 + 六-2 citation 回链 + 六-3 评测闭环 + 四-4 检索质量（TDD strict，L3）。
- **状态**：✅ 完成。证据：`docs/testing/doc-pipeline-b8.tdd.md`。
- **交付**：
  - **六-1 文档四工具**：新建 `src/main/ai/tools/{searchDocument,readPage,extractTable,analyzeChart}.ts`（对齐 readLocalFile 只读范式）——searchDocument 关键词命中返回 offset/snippet/**真实页码（pageOffsets 二分）**/章节路径；readPage 按页切片（无页码结构显式指引改用 searchDocument）；extractTable 清单先行 + 完整 CSV（引号感知计列、**handler 不截断**）；analyzeChart 以 page/image_index 双锚点返回章节摘录 + 关联数据表（**不在工具期烧 vision token**，取舍记 TDD §8.4 邻接）。注册进 handlerMap + CORE_TOOLS defer + READ_ONLY_TOOLS + **concurrencyDefs 并发安全**（不落 fail-closed 串行）+ toolsForIntent 意图分区 + 系统提示词路由；**陈旧工具名 readFileRevision/listFileRevisions/getFileInfo 从 selector/concurrency 双处清理**（src 零残留）；`IDocumentStructure` 增可选 `images` 锚点（sanitize 白名单 + 解析回写，JSON 级向后兼容）；readLocalFile 超限文案改如实（**择「改文案」不实现分块**，TDD §8.1）。
  - **六-2 citation 回链**：`buildSourceRef` 第 5 参 attachmentId + indexFile 贯通 fileId（既有 openFile 回链接通）；executeOneTool 收集 searchKB/searchDocument 引用（`collectCitations`/`mergeCitations` 去重封顶 10）→ assistant `refsJson` 落库 + **done 事件携带 refsJson**（渲染即时展示 + 回放恢复，preload map/agentStore 三处消费同步）；气泡页码标签 `ai.refs.page`（三语）+ **附件引用点击经新 IPC `attachment:open-source` 跳原文**——服务端按 user_id 反查路径（参数化 LIKE + JSON 定位）+ 绝对路径/7 格式白名单双校验防伪造 `.exe`；§1.3 三处同步（constants/preload/docs-08）；历史消息无新字段兼容（组件测试锁定）。**与图片引用结构取舍**（两套结构不合并）记 TDD §8.4。
  - **四-4 检索质量**：`chunkEmbeddingText` **仅向量侧加 headingPath 前缀、FTS5 content 保持原样**（避免污染关键词召回，取舍记 TDD §8.5）；写索引（writeChunks）与回填（vectorBackfill 扫描 SQL 补 heading_path）共用同构；查询侧不加前缀（已知限制如实记录）。
  - **六-3 评测闭环（可自动化四项）**：① 表格行列还原固定样例（PDF 无框线 3×4 两态 / 跨页合并 / md CSV）→ `docPipelineEval.test.ts`；② chunk 页码溯源（多页单调、首块 page=1）→ kbIndexer.test；③ 固定 query 集检索命中率 5/5（BM25 负分语义 + 分属不同文档防段聚合）→ kbSearch.test；④ 多模态降级行为断言（buildImageParts/D 路线 no-vision 零调用 + VISION_DEGRADED_NOTICE 注入补齐）→ eval + agentLoop。OCR 指标不做（决策基线）。
  - **HyDE 收益复核（四-4②）**：结构性结论——B5 前文档侧无向量时 `hyde:true` 为 no-op，接通后路径生效（本批 2 例断言锁定：generateHydeVector → queryVector 透传 / 未传零调用）；**量化 A/B 需真实 embedding+LLM 凭据，无凭据环境不编造数据，列遗留**（TDD §8.6）。**拒答阈值 0.6 复核**：附件与笔记同管线同阈值、无 source_type 分支，本期不新增配置（TDD §8.7）。
- **门禁**：tsc 0 error / vitest **157 文件 3664 passed 0 failed**（B7 基线 3583 + 81，2026-09-27 00:38 实测 exit 0）/ lint 0 error（106 warning，与基线持平）/ vite build exit 0 / E2E **31 failed · 1 skipped · 101 passed**——failed 构成与基线逐项一致（table 7 / feedback 5 / drag 5 / ai-agent-panel 4 / thematic 2 / float-toolbar 2 / exit 2 / editor 1 / image-resize 1 / recent-history 1 / welcome 1），**零新增失败**；B8 触及文件语句覆盖率：四工具聚合 96.58%、kbIndexer 97.29%、vectorBackfill 98.36%、concurrencyDefs 97.84%（agentToolExecutor 整文件 62% 中低值均为存量分支，新增收集器函数全用例直达）。
- **偏离实测记录**：vitest 环境 `path.isAbsolute` 被 browserify 换为 posix 语义（win32 下 `C:\` 返回 false）→ 通道 handler 改显式盘符/根/UNC 白名单；固定检索集首版用正 bm 与 bm25 负分语义相反致 top1 反转 → 按 `ORDER BY bm` 升序修正（TDD §2 轮3）。
- **遗留**：HyDE 量化 A/B（需 API 凭据）；chatHandlers（废弃 Chat 模式）未接 citation 收集；附件页内定位（无应用内 PDF 预览，打开交 OS 默认应用）；analyzeChart 工具期像素识读不做（D 路线解析期已转数据表）；readLocalFile offset/limit 分块未实现；E2E 存量 31 failed 不属本批次。
- **下一任务**：B9（三-1 超长 md 发送 + 三-3 相对路径图片，L2；四工具/搜索路由已就位可配合摘要发送）。

### B9 完成（2026-09-27）

- **范围**：三-1 超长 md 发送不整篇内联 + `FOLDER_READ` 过滤锁定 + 三-3 相对路径图片（TDD strict，L2）。
- **状态**：✅ 完成。证据：`docs/testing/doc-pipeline-b9.tdd.md`。
- **交付**：
  - **三-1① 发送构造（摘要引用模式）**：载荷新增 `currentFileRef {name,path}`（`shared/ai/agent.ts` → `agentHandlers` extra → `agentTaskWorker.readTaskPayload` 白名单 → `AgentReqPayload`，全链可选、存在才塞）；渲染侧 `agentStore.buildCurrentFileRef` 从当前打开磁盘文件构造（welcome:// 与 DB 文档不带）；`buildDocumentContext` **带 ref 走引用模式**——只注入文件名+路径+规模统计+标题大纲+前 20 行（单行 120/总摘录 1200 字符上限），正文交 `readLocalFile` 按需读取；无 ref（DB/welcome 文档工具读不到正文）保持旧整篇注入+截断，存量 A1a 断言零修改通过。`currentDocument` 全文仍随 IPC 载荷（editBlocks contentHash/门控需要，不消耗 CONTEXT_WINDOW，取舍记 TDD §8.2）。
  - **三-1② `FOLDER_READ` 锁定**：`.md` 过滤零改动 + handler 内「有意为之」注释 + `docs/modules/08` `folder:read` 行写明决策基线；ipcDialogs 真实目录锁定用例首跑即绿（防误"修复"回归）。
  - **三-1② `MentionPreview`**：500 字硬截断改「摘要（行/字统计+标题大纲）+ 前 20 行」+「仅预览」提示（摘录 4000 字符/大纲单条 120 字符上限）。
  - **三-3 相对路径图片**：新建 `src/main/ai/files/mdImageResolver.ts`（纯 fs，不依赖 path 模块平台语义）——解析基准恒为 **md 所在目录**；`workspaceRoot`（`pickWorkspaceRoot` 取含 md 的最长文件树根，缺省 md 目录）**越界拦截先于存在性检查**（工作区外文件真实存在也不读不返回）；`../../`/盘符/UNC 三形态；缺失与 md 移动失效 → missing 结构化降级；远程/data 静默跳过、svg/非图片/`media:` 拒绝。`buildMdImageContext` 复用 B6 `buildImageParts` 在 `agentContext` 注入当前轮（上限 3 张=Q4 口径、vision 不支持 degraded 走 `VISION_DEGRADED_NOTICE`、缺失/越界/超限文本提示随消息进 prompt 不落消息表）；**`imageIndexer`/`images_vec` 图片向量不动（范围外）**。
- **门禁**：tsc 0 error（修 ContentPart 导入 1 处）/ vitest **159 文件 3708 passed 0 failed**（B8 基线 3664 + 44，收口实测 exit 0）/ lint 0 error（106 warning 与基线持平）/ vite build 三段 exit 0 / E2E **31 failed·1 skipped·101 passed（133 条）**——failed 按 spec 构成与基线逐条一致（table 7 / feedback 5 / drag 5 / ai-agent-panel 4 / thematic 2 / float-toolbar 2 / exit 2 / editor 1 / image-resize 1 / recent-history 1 / welcome 1），**零新增失败**；B9 触及文件覆盖率：mdImageResolver **98.26%**、MentionPreview 93.97%、agentPromptBuilder 91.42%、agentContext 80.08%（新增行全量直达）。过程 flaky：`cacheMonitor`/`ab-test` 存量性能断言负载间歇超阈（单跑 37/22 passed，收尾全量绿）。
- **偏离记录**：计划指 FileTreePanel「改发送构造」，实测该组件只负责 openFile（发送构造在 agentStore + 主进程注入点）→ FileTreePanel 零改动（TDD §8.1）；md 图片注入主对话而非 `recognizeImageAttachments`（附件专属路径，TDD §8.4）。
- **遗留**：`readLocalFile` 无分块（>1MB md 引用模式读不到全文，B8 遗留依赖）；md 图片不持久化到消息表/回放；越界判定大小写敏感（fail-safe 方向）；E2E 存量 31 failed 不属本批次。
- **下一任务**：B10（七 打包体积，**L4 执行前需二次确认**）与 B11（八 写控制与外发，**L4**）可并行；B12 Docling PoC 收尾。

### B10 完成（2026-09-27）

- **范围**：七-1 四项瘦身 + 七-2 monaco 运行时验证（Q5）+ 七-3 体积门禁（TDD strict，**L4，已获用户二次放行**）。
- **状态**：✅ 完成。证据：`docs/testing/doc-pipeline-b10.tdd.md`。
- **交付**：
  - **七-1① files 反向排除（electron-builder 24.13.3 实测生效）**：`build.files` 新增 21 条 `!` 排除——`react-icons`（~81.9MB，Vite 已内联，具名导入形态本就按需、零代码改动）、`monaco-editor`（68.5MB，见七-2）、liteparse Linux 件（`.node` 24.83MB + `libpdfium.so` 7.09MB，asar 与 asar.unpacked 双处归零）、`jieba-wasm` 的 `pkg/{web,deno,bundler}`（`require.resolve` 实测只走 `pkg/nodejs`，保留一份）、`better-sqlite3/deps/**`（构建期源码 ~9.6MB；**`build/Release/*.node` 零误伤**，`ASAR_REQUIRED` 门禁断言 + 打包后启动实测双保险）。每条排除写双口径 pattern（项目根 / 依赖父目录两种 v24 匹配基准）。**注意**：启用 Linux AppImage target 前须移除 liteparse 两条排除（记录于 packaging.md）。
  - **七-1① `clean` 脚本**：`scripts/clean.mjs` 挂 `prebuild`——dist-main 历史分片实测 211 文件 176MB（计划时点 44~50MB 已增长）→ 清理后单次构建 7 文件 2.4MB；asar 内 `dist-main/index-*.js` 70 → 3 份。
  - **七-1① 图标清单 + 视觉回归（先于替换）**：`tests/components/IconInventory.test.tsx` 落 `ICON_INVENTORY` 132 项全表（键双向对账 + 组件身份比对 + 逐项 svg 非空 + 降级断言）→ RED→GREEN 后才动打包配置；打包后 CDP 实测 svgCount 31 与剔除前一致（前后截图存证）。
  - **七-2② monaco 运行时验证（Q5 判定出口）**：**验证通过 → 剔除执行**。剔除前：CDP 全会话追踪（page request + Network 双通道，先 reload 覆盖完整启动再 Ctrl+` 进源代码模式——Monaco 实际加载渲染截图确认）→ 22 请求全为 `dist-render/assets/*`（正对照成立），`node_modules/monaco-editor|react-icons` 加载 **0**、CDN 兜底 0、pageerror/console error 0；主进程 `NODE_OPTIONS --require` 钩子对打包应用不生效（Electron 既定行为）→ 以主进程/preload 静态零引用 + `nodeIntegration:false` 组合替代并如实记录。剔除后：asar 副本条目 0 且源代码模式 Monaco 正常挂载——**双向闭环**。
  - **七-3② 体积门禁**：`scripts/sizeGate.mjs`（`postbuild` 自动执行 / `npm run size` 单跑）——exe|msi ≤500MB、win-unpacked ≤1GB 双口径超限 **fail build**；asar 内容断言（必含 `better_sqlite3.node` 防误伤 + 8 类禁含项防 glob 静默失效）；top-N 三段清单（asar 文件/asar 包分组/win-unpacked 文件）；基线写注释与运行输出；纯本地 stat + asar 头解析，零网络依赖。单测 `tests/scripts/sizeGate.test.ts` 18 例（含 asar 字节流解析、超限判定、首轮发现的排序/分组缺陷补测）。
  - **文档**：`docs/guide/packaging.md` 同步（build 生命周期、files 排除逐项依据表、体积门禁章节）。
- **体积前后对比（2026-09-27 实测）**：Setup **147.68MB → 99.16MB（−32.9%）**；msi 154.68 → **109.93MB**；win-unpacked **602.15MB → 368.96MB（−38.7%）**；app.asar **288MB → 85.93MB（−70%）**；asar 条目 11313 → 9228。距 500MB/1GB 双红线余量充足（B12 Docling 转正须重跑本门禁）。
- **门禁**：tsc 0 error / vitest **161 文件 3730 passed 0 failed**（B9 基线 3708 + 22）/ lint 0 error（106 warning 与基线持平）/ vite build exit 0 / E2E **31 failed·1 skipped·101 passed**（failed 构成与基线逐项一致、**零新增失败**）/ **`npm run build` 完整打包 exit 0 + size gate PASSED** + **打包实测可启动**（CDP：欢迎文档渲染 → Ctrl+` 源码模式 Monaco 正常 → 图标齐全 → 0 pageerror/0 console error，前后截图与 report JSON 见 TDD §7）。
- **偏离记录**：react-icons 已是具名按需导入，治理落在打包剔除而非改 import（TDD §8.1）；`vite.config.ts` external 零改动（无同步项）；`@monaco-editor/*` 小副本保留（~1-2MB，范围外）。
- **遗留**：打包形态 `sqlite-vec` 加载失败降级 FTS5-only（**旧包即存在、非本批次引入**，vec0.dll 在 asar.unpacked 但扩展加载疑似未映射——建议 B11/独立批次核查）；Linux AppImage 的 liteparse 排除警示；E2E 存量 31 failed 不属本批次。
- **下一任务**：B11（八 写控制与外发，**L4**）与 B12（Docling PoC，须先过七-3 门禁）。

### B11 完成（2026-09-27）

- **范围**：八-1 外发同意闸（B+C，Q1/Q2）+ 八-2 write_mode 核查（只做两件事）+ 八-3 死通道清理（TDD strict，**L4 安全语义，已获用户二次放行**）。
- **状态**：✅ 完成。证据：`docs/testing/doc-pipeline-b11.tdd.md`。
- **交付**：
  - **八-1① 过滤三层落地（Q1 选定「入 KB + 过滤」）**：附件照常入 KB（保本地检索价值）；`kb_documents.consent_granted` 勾选授权标记（**D5b 追加补列**，计划 §3 未单列但变更清单要求，三断言齐）→ `getGrantedAttachmentDocIds` 白名单（仅 `source_type='attachment' AND consent_granted=1`，笔记永不入列）→ `filterKbEgressResults` 纯函数（`allowSend=false` 仅放行授权附件、best 同步收敛、查询异常空集合 fail-closed）→ **外发唯一出口接线** `agentTaskWorker.buildAgentDeps` searchKb 闭包（preloader/citation 均继承）。
  - **八-1① 注入矩阵（现状锁定 + 勾选授权）**：`kbEgressAuthorized = !needsKbSendConsent` 计算一字未动（无放宽路径断言）；`toolsForIntent` 增第 7 参 `kbAttachmentEgressGranted`——`allowSend=false 且无授权附件 → searchKB 不注入`（现状锁定）、`有勾选授权附件 → 注入且结果被过滤收敛`（该文档显式授权，不追溯其他笔记）。**如实标注**：`useKnowledgeBase` 为 Module 10 移除的硬编码 false（B 类废弃，不恢复），注入矩阵生产 UI 当前不可达，本批落地为主进程安全语义层。
  - **八-1② Q2 勾选链**：`ai_config.upload_kb_default INTEGER DEFAULT 1`（D5 三断言，NULL/旧库/无行收敛默认勾选）→ 新通道 `AI_GET/SET_UPLOAD_KB_DEFAULT`（constants/preload/docs/08 三处同步）→ `agentStore.uploadKbDefault`（init 回读 + toggle 持久化）→ composer 附件区「加入知识库」勾选 UI（默认勾选）→ 发送载荷 `uploadToKb` → AGENT_RUN/AI_CHAT 持久化后 `importAttachmentsAsKb`（仅 file+done；**勾选是入 KB 唯一触发**，fire-and-forget 不阻塞发送；`importAttachmentAsKb` 缺省不写授权键 fail-closed）。
  - **八-2 两件事**：`ai-agent.md`/`security.md` 写控制表改「设计意图 vs 实现现状」双列——`auto` 主进程工具执行路径**无消费点**（仅 UI+IPC 持久化）；staleness **MD5 → xxHash64** 修正；附件/解析产物写入路径核查（工具侧对 `importAttachmentAsKb`/`persistIncomingAttachments` 零引用 grep 实测）→ 全部用户显式触发 = **manual 确认语义天然满足**，结论入档；写模式开关加 title 显式提示（不空转误导）。完整接线=范围外（后续不阻塞）。
  - **八-3 死通道**：取计划裁定「**删除常量**」——`constants.ts` 两行删除 + `docs/modules/08:162` 行同步删除（不留第三种状态）；**零引用断言**=递归扫全 `src/**/*.ts(x)` 四种 token 形态 + IPC 文档。`database.md` kb_documents/kb_chunks 字段表与实际 DDL 全对齐（含 D3/D5b/heading_path/vector 等触及条目，不做全仓重构）；`parsed_attachments` DAO（B3）与陈旧工具名（B8）复核通过。
  - **B10 遗留核查（sqlite-vec 降级）**：**结论=降级路径可用、非本批次引入、不修**——加载失败仅 warn（index.ts）、`vectorSearch` prepare 抛错静默降级空候选走 FTS5（B5 测试已锁定）、回填写 Float32 BLOB 不依赖扩展、imageIndexer 静默跳过；打包形态 vec 未映射时回填正常/检索降级/零报错。结论入 `database.md` images_vec 注记与 TDD §7。
- **门禁**：tsc 0 error / vitest **161 文件 3781 passed 0 failed**（B10 基线 3730 + 51，0 删除）/ lint 0 error（106 warning 与基线持平）/ vite build exit 0 / E2E 见 TDD §5（验收口径：基线 31 failed 存量、**零新增失败**）。新增代码覆盖率（v8 触碰文件口径）：kbHandlers 92.6% / kb.ts 80.1% / ai.ts 79.0%（未覆盖为既有段），新增函数逐一直测 ≥80% 达成。
- **偏离记录**：D5b（`consent_granted` 补列）为计划 §3 未单列项，按 §2-B11 变更清单「kbIndexer 记录勾选授权标记」落地（TDD §6 记录）；`chatHandlers` 上传载荷消费而非 consent 注入点（计划行号 225-232 偏差，consent 注入语义在勾选授权链）。
- **遗留**：`write_mode` 完整接线（auto 消费点）后续不阻塞；`useKnowledgeBase` 废弃开关维持 B 类裁定不得恢复；打包 sqlite-vec 未映射（旧包既有，已核实降级可用不修）；E2E 存量 31 failed 不属本批次。
- **下一任务**：B12（Docling PoC，须先过七-3 体积门禁）——B10/B11 双 L4 已完成。

### B12 完成（2026-09-27）

- **范围**：二-5 Docling PoC（L2 仅验证、随时可停）——量化四项 + 工程评估 + 红线核对，不改 `parseDocument`、不动打包配置。
- **状态**：✅ 完成，**结论=不达标 → 按 Q6 关闭本任务**，主线不受影响。证据：`docs/plan/doc-pipeline.docling-poc.md`（PoC 报告）+ `scripts/docling-poc/poc-result.json`（原始数据）。
- **交付**：
  - **包名核实**：需求所记 `docling-node` npm 404 → 实际包 **`docling.rs`** 1.69.2（docling-rs 官方 napi-rs 绑定，win32-x64 原生件 53.27MB）；依赖隔离在 `scripts/docling-poc/package.json`（独立 node_modules），主仓库 package.json 零改动。
  - **可插拔后端 PoC**：`genSample.mjs`（4 页样例 + 真值：双栏 40 标记全序 / 单页表 4×3 / 跨页表 9×5）+ `runPoc.mjs`（`BACKENDS` 注册表，A 路线直接 bundle `pdfLayout.ts` 对照，`--backend` 可选）——**偏离**：计划写"接入 documentParser 试验分支"，按执行注意改在 runner 内实现，主链路零触碰。
  - **量化四项（完整标准管线 layout+TableFormer+OCR-en，`checkDependencies ready=true`）**：双栏阅读顺序 A **100%** vs docling **100%**；表格行列 A **100%**（57/57，含跨页合并）vs docling **64.9%**（37/57，跨页续行退化为散文不合并）；单页耗时 A **12.5ms** vs docling warm **5000~5308ms**（约 400×，one-shot 冷 10.2~22s）；体积增量 **进包 53.36MB unpacked / 安装包估算 +18.98MB**（模型 407.82MB + pdfium 14.08MB **零进包**）。
  - **工程评估（二-5② 全项）**：electron-builder 24.13.3 本地源码+release 实物——`.node` 打进 asar 可加载（better-sqlite3 现状实证），liteparse 因包内 pdfium.dll 被 auto-unpack（**项目无任何 asarUnpack 配置**）；转正建议显式 `asarUnpack` + sizeGate unpacked 断言。签名现状 N/A（win 未配证书），启用时须 `win.signExts: ['.node']`（`shouldSignFile` 源码实证）。体积投影双门禁通过（Setup 99.16→118.14/500MB、unpacked 368.96→422.32/1GB）；模型 cwd 解析 → 转正须改 `DOCLING_*`/`PDFIUM_DYNAMIC_LIB_PATH` 指 userData。
  - **红线**：模型/pdfium 一个字节不进安装包（结构性成立，§1 自查表）；**替换 A 路线必须先实测重跑七-3（500MB/1GB），未过不得替换**——已写死在报告 §4.3/§6 与范围外清单。
  - **网络坑入档**：GitHub 直连间歇封锁 → 模型改走 `api.github.com` asset 通道（octet-stream 直跳 objects.githubusercontent，按字节数校验）；上游下载脚本 Git-Bash `uname` 误判 Linux 分支不认 Windows pdfium → 复用根项目 liteparse 的 `pdfium.dll` 实测可用。
- **门禁**：tsc 0 error / vitest 全绿（见本批门禁记录）/ lint 0 error / vite build exit 0 / E2E 基线 31 failed 零新增。PoC 文件不在 lint/tsc 覆盖范围（`scripts/` 非源码目录，`runPoc.mjs`/`genSample.mjs` 单跑 0 error 仅 no-console warn）。
- **偏离记录**：见交付第 2 条（可插拔接口落 runner 而非 documentParser 试验分支）；另评分器初版把 markdown 分隔行计入数据行（两后端同被低估），修复后 A 路线恢复 57/57——属 PoC 工具 bug，非产品代码。
- **遗留**：样例为合成单样例（真值可量化，但复杂真实版面对比属后续，如重启需另立任务）；docling 转正重启条件 = 需要真实复杂版面增益且**先重跑七-3**。
- **下一任务**：doc-pipeline 12 批全部收口（B1~B12）；剩余为全量门禁复跑与收尾归档（如派发）。
