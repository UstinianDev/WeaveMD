# doc-pipeline — 实施计划（8 模块 29 任务）

> 权威需求源：`C:\Users\lenovo\Desktop\优化方向\优化方向.md`（§0 决策基线 14 条 + 29 任务拷问细节，执行中不得推翻）
> 需求文档：`docs/requirements/doc-pipeline.req.md`（Q1~Q6 执行级处置已吸收进对应批次）
> 现状核查：2026-09-25 按源文档行号抽查关键文件，结论见 §0（发现偏差照实记录，不修改代码）
> 规范约束：TS strict、Zustand v4、Tailwind；不给 any 风格建议；只实现需求内内容，不引入范围外"顺手优化"
> 执行纪律：每批次完成 = 5 项质量门禁全绿 + 新增行为 TDD 报告（`docs/testing/*.tdd.md`）+ 更新 `docs/plan/doc-pipeline.status.md`（状态/证据/遗留/下一步）

---

## 0. 代码现状核查与行号偏差

### 0.1 关键卡点抽查（全部属实）

| 源文档位置 | 核查结论 |
|---|---|
| `src/main/ipc-handlers.ts:132-151` `DIALOG_OPEN_FILE` | 属实：`filters` 硬编码 `extensions:['md']`（:138）、`properties:['openFile']` 单选、主进程 :147 `fs.readFileSync(filePath,'utf-8')` 全文返回 |
| `src/main/ai/files/documentParser.ts:19-38 / 40-60 / 62-72 / 90-118 / 120-124` | 全部属实：`SUPPORTED_TYPES` 无 xls/xlsx；`parsePdf` 只取纯文本丢坐标；`isSupportedDocument` 全库无调用方；`package.json` 无 `xlsx` 依赖（未安装） |
| `src/main/ai/ipc/kbHandlers.ts:213-226` `KB_PARSE_DOCUMENT` | 属实：IPC 存在但渲染层零调用（`*.tsx` 中无 `parseDocument`；仅 `weaveMDBridge.ts:711` 恒 `success:false` stub） |
| `src/main/ai/knowledge/kbIndexer.ts:63-101` `splitNote` / `:181-187` `buildSourceRef` | 属实：表格中间直接切断；`line = 1 + floor(approxOffset/60)` 60 字符近似换算；`NoteChunk` 无 headingPath；`heading_path` 建列（`db/index.ts:479`）后全库无写入，`kbSearch.ts:280/489/542/608` 只读、`aggregateAndExpand`（:190，调用点 :681）实际失效 |
| `src/shared/constants.ts:173-174` `AGENT_UPLOAD_ATTACHMENT` / `AGENT_UPLOAD_IMAGE` | 属实：主进程无 handler、preload 未暴露、全库零引用；`docs/modules/08-IPC通信机制.md:162` 仍列出（已核对） |
| `src/main/db/index.ts:188-199 / 247-257 / 543-556 / :266` | 属实：`ai_messages` 无附件字段；`addColumnIfMissing` 幂等补列范式现成（函数体在 :309）；`parsed_attachments` 已建全库无读写、注册于 :266 |
| `src/main/ai/llm/llmClient.ts:14-27` / `src/main/ai/contextManager.ts:14-18` | 属实：`content: string` 是多模态硬阻塞；`LlmMessage.content: string` 压缩链路丢图 |
| 死代码零 import | 属实：`imageStorage.ts`（176 行，`storeImageFromBase64` :71）/`agentMedia.ts`（122 行）/`imageRecognition.ts`（108 行，`recognizeImage` :44）/`imageIndexer.ts`（115 行）全库无 import；`IAttachmentPayload`/`IImagePayload` 仅 `mention.ts` 定义处命中 |
| `package.json:12-21 scripts` / `:85-95 build.files` | 属实：无 `clean`/`size` 脚本；`files` 仅 3 条正向 glob、无反向排除/`compression` |
| `agentToolSelector.ts:19-20` + `concurrencyDefs.ts:37-39` 陈旧工具名 | 属实：`readFileRevision`/`listFileRevisions`/`getFileInfo` 均不在 `handlerMap`（24 项已核对）中 |
| `weaveMDBridge.ts:258 / :584` / `ipc-handlers.ts:539 / :584-590` | 属实：openFile mock `accept` 仅 md/txt；`pickImage` mock 恒 `null`；`FOLDER_READ` `.md` 过滤在 :539；`clipboard:read-image` handler 在 :584-586 |
| `agentHelpers.ts:13` | 属实：`CONTEXT_WINDOW = 64_000` |
| 文档行号：`docs/modules/08-IPC通信机制.md:162`、`security.md:51+`、`database.md:134+`、`ai-agent.md:128+`、`docs/README.md:65-67` 门禁 | 全部属实 |
| 其余抽查（`constants.ts:65/160/183-184`、`preload.ts:89-102/265/331`、`AIMessageBubble.tsx:327`、`db/ai.ts:523-555 appendMessage`、`consent.ts:10-12`、`agentContext.ts:282-295`、`kbSearchFts.ts:18/84`、`modelCatalog.ts:51/62`、`modelDiscovery.ts:65`、`db/index.ts:29-37 sqlite-vec 降级`、`readLocalFile.ts:31`、`kbHandlers.ts:247` 导入正则、`agentStore.ts:1345 importDir` 链路） | 与源文档一致或落在所给区间内 |
| `costTracker.ts` 图片 token 计价 | 缺口属实：grep 图片计价零命中，D 路线/多模态计价需新建 |

### 0.2 行号偏差记录（照实记录，不修改源文档）

| 源文档说法 | 实际情况 |
|---|---|
| **`kbIndexer.ts:274-277` 的 `kbIndexOpts()` 恒返回 `{}`（四-1 摆设根因）** | **函数实际定义在 `src/main/ai/ipc/kbHandlers.ts:275-277`**（`function kbIndexOpts(): Record<string, never> { return {}; }`）；`kbIndexer.ts:274-277` 是 `indexImportedText` 的缓存失效代码。调用点：`kbHandlers.ts:45/256/269`；另 `ipc-handlers.ts:69` 保存防抖直接传 `{}`。卡点实质（恒 `{}`、三入口均未接配置）完全属实，仅文件归属偏差 |
| `AIPanelComposer.tsx:405-422` `handleUploadFile` 用 `fs.readFileSync(path,'utf-8')` 全文读取 | composer 侧不直接 readFileSync（:406-422 调 `window.weaveMD.dialog.openFile()`）；utf-8 全文读发生在主进程 `ipc-handlers.ts:147`，渲染层收到的是已读全文。卡点实质（渲染层拿全文、须改"只传 path、内容交解析层"）属实 |
| `handlePaste` `:280-302` | 实际 279-312（函数头 279、返回 false 收尾 311-312） |
| `src/render/components/Common/Icon.tsx:2` react-icons 全量引入 | 行 2 是注释；实际 `from 'react-icons/md'` import 语句在 `Icon.tsx:140` |
| `kbHandlers.ts:212-226` KB_PARSE_DOCUMENT | 实际 handler 为 213-226（212 为注释行）——微偏 |
| `constants.ts:172-174` 死通道 | 常量在 173-174（172 为注释）——一致 |
| `src/shared/ai/document.ts:1-10` `IDocumentParseResult` | 实际 4-11（接口体 5-11）——区间微偏 |
| `src/main/ai/consent.ts:10-12` | 函数实际 11-13——微偏 |

**核查方法**：只读抽查（Read/Grep/sed），未修改任何代码。

---

## 1. 执行批次

### 1.1 依赖链（依据源文档 §执行纪律 4，草案顺序不得违反）

```
B1 二-1(+二-2,二-6契约) 解析入口
 → B2 一-1/一-2/一-3 上传接线
 → B3 一-4 持久化
 → B4 四-3 入库
 → B5 四-1/四-2(+三-2) 检索
 → B6 五-1/五-2/五-3 多模态
 → B7 二-3/二-4/二-6(页码落库) 版面与D路线
 → B8 六(+四-4) 工具与引用
 → B9 三-1/三-3 文件树
B10 七 体积 ‖ B11 八 写控制   （可与 B8/B9 并行穿插，须在 B12 前完成）
B12 二-5 Docling PoC（最后、随时可停）
```

### 1.2 批次总表与草案差异说明

| 批次 | 内容（模块-任务） | 依赖 | 风险级 | TDD |
|---|---|---|---|---|
| B1 | 二-1 统一解析入口 + 二-2 xls/xlsx + 二-6 类型契约 | — | L3 | 是 |
| B2 | 一-1 格式白名单 / 一-2 多选批量 / 一-3 粘贴 | B1 | L3 | 是（含 E2E） |
| B3 | 一-4 附件持久化与消息渲染 | B2 | L3（数据迁移） | 是 |
| B4 | 四-3 批量导入通道 | B3 | L3 | 是 |
| B5 | 四-1 Embedding 接通 + 四-2 heading_path + 三-2 表格 md | B4 | L3 | 是 |
| B6 | 五-1 content 数组 + 五-2 落盘 + 五-3 死代码接活 | B5 | **L4**（核心 LLM 链路全调用点） | 是 |
| B7 | 二-3 PDF 版面 + 二-4 D 路线 + 二-6 页码溯源落库 | B6 | L3 | 是 |
| B8 | 六-1 工具集 + 六-2 citation + 六-3 评测 + 四-4 检索质量 | B7 | L3 | 是 |
| B9 | 三-1 超长 md 发送 + 三-3 相对路径图片 | B8 | L2 | 是 |
| B10 | 七-1 四项瘦身 + 七-2 monaco 验证 + 七-3 体积门禁 | 可与 B8/B9 并行 | **L4**（打包红线） | 门禁脚本单测 + 实测验证 |
| B11 | 八-1 外发闸 + 八-2 write_mode 核查 + 八-3 死通道清理 | B4（勾选通道）+ B8（陈旧工具名已清） | **L4**（安全语义） | 是 |
| B12 | 二-5 Docling PoC | B10（转正须过七-3 门禁） | L2（可停） | PoC 量化报告 |

**对草案的调整（均在许可范围内，不违反依赖顺序）**：
1. **二-2 并入 B1**：一-1 放开 7 格式上传以 xls 解析先就位为前提，二-2 必须在 B2 之前，就近并入 B1。
2. **三-2 并入 B5**：源文档四-2②强制"`heading_path` 与三-2 的标题统领合并必须同一批次实现"，故三-2 从 B9 拆出并入 B5。
3. **B10（二-3/二-6）按许可拆分合并**：二-6 类型契约（产物字段）随 B1 定义，二-3 版面 + 二-6 页码落库随 B7（二-3②"无文本层检测命中直接短路转二-4"两者强耦合）；原 B10 序号取消。
4. **四-4 并入 B8**：四-4 的"页码入 source_ref"与六-2 的"citation 回链"是同一数据链路两端（source_ref → refsJson），同批避免返工；且四-4 依赖 B7 的真实页码。
5. **七/八/二-5 顺延为 B10/B11/B12**；七、八保持可并行（源文档允许），但 B11-八3 的陈旧工具名清理已由 B8 承担（六-1②"本期顺手清理"），B11 只做 upload 通道二选一与文档同步。
6. **三-1 留在 B9**：依赖 B3（占位符不内联）与 B5（超长 md 入 KB 分块），顺序无冲突；三-3 依赖 B6 多模态链路，B9 > B6 满足。

### 1.3 批次间硬规则（每批次自检）

- 不动已应用过的历史迁移；不删除既有测试；不放宽 `allowSend`；体积红线 ≤1GB（目标 500MB）。
- 新增 IPC 通道必须同步 `src/shared/constants.ts`、`src/main/preload.ts`、`docs/modules/08-IPC通信机制.md` 三处（八-3②"不得留下第三种状态"）。
- 与源文档冲突时以源文档为准；发现代码与文档不一致按高优先级文档确认，不静默猜测。

---

## 2. 每批次变更清单

> 风险级定义：**L2** = 局部改动，无 schema/安全/打包影响；**L3** = 跨模块核心链路或涉数据迁移；**L4** = 安全语义 / 打包红线 / 全类型链路重构。
> 每文件一句话说明改什么；"新建"含配套测试。

### B1 解析入口与格式补全（二-1 + 二-2 + 二-6 契约）— 风险 L3｜TDD：是

**目标**：`parseDocument` 返回结构化产物，7 格式全支持，IPC/类型/mock 三端一致，为 B2 上传接线供能。

- 修改 `src/main/ai/files/documentParser.ts` — `SUPPORTED_TYPES`/`inferMimeType` 扩 xls/xlsx；新增 `parseXlsx()`（严格对齐 `parseDocx` 动态 `import()` 写法，多 sheet 全转且 sheet 名作章节标题、合并单元格还原、公式取计算值、空单元格不错位、超宽表转行列结构化文本）；`parseDocument` 改返回结构化产物（标题层级/表格 Markdown/页码/章节路径）；`.doc` 按 Q3 降级（D 路线优先，无 vision 时提示"另存为 docx"）；`isSupportedDocument` 接线（供上传白名单校验）或删除（二-1②二选一，实现时择一并记录）。
- 修改 `src/shared/ai/document.ts` — `IDocumentParseResult` 扩结构化字段：`sections`（章节路径）/`headings` 层级 / `tables`（序号、Markdown；CSV 两态字段随 B7 补全）/ `pageCount` / `parseVersion`（二-6① 溯源契约）。
- 修改 `src/main/ai/ipc/kbHandlers.ts` — `KB_PARSE_DOCUMENT` handler（213-226）返回结构化产物并透传 `parseVersion`。
- 修改 `src/main/preload.ts` — `kb.parseDocument` 返回类型签名同步（:265）。
- 修改 `src/render/utils/weaveMDBridge.ts` — 浏览器 mock `parseDocument` 由恒 `success:false`（:711）改为可测的受控实现，避免 E2E/Web 模式假失败。
- 修改 `package.json` — dependencies 新增 `xlsx`（SheetJS 社区版，二-2①）。
- 新建 `tests/main/ai/documentParser.test.ts` — 7 格式白名单、xls 多 sheet/合并单元格/公式取值/空单元格不错位、`.doc` 降级文案、结构化产物字段断言。

**执行期调研（源文档③）**：Docs MCP 索引 `@llamaindex/liteparse`（坐标输出能力，B7 前置）、`mammoth`（`extractRawText` vs `convertToHtml` 结构保留差异——docx 标题/表格结构保留按此决策）、`xlsx`（`sheet_to_json`/`merge` 处理）。

### B2 上传接线（一-1 + 一-2 + 一-3）— 风险 L3｜TDD：是（含 Playwright E2E）

**目标**：打开/多选/粘贴三个入口只把 path 交解析层，composer 不再持有全文。

- 修改 `src/main/ipc-handlers.ts` — `DIALOG_OPEN_FILE`（132-151）：`filters` 放开 7 格式、`properties` 加 `multiSelections`、返回路径数组且保持用户选择顺序、**删除 :147 的 `readFileSync` 全文读取**（内容由解析层接管，一-1②）。
- 修改 `src/main/preload.ts` — `dialog.openFile` 返回类型改路径数组（:89-102 声明、:331 暴露）。
- 新建 `src/main/ai/files/parseLimiter.ts` — 主进程解析并发限流队列（一-2②：避免同时开 20 个 pdf 阻塞单线程主进程，异步 + 并发上限）。
- 修改 `src/render/components/AIAgent/panel/AIPanelComposer.tsx` — `handleUploadFile`（406-422）改收路径数组、逐个走 `KB_PARSE_DOCUMENT`（经 parseLimiter 限流）、单文件解析失败不断批；附件 chips >5 折叠为「N 个附件」（483-507）；`handlePaste`（279-312）补图片双兜底与 `DataTransfer.files` 7 格式分支、粘贴防 `preventDefault` 文本重复插入（照抄 `ContentBlock.tsx:187-250`）。
- 修改 `src/render/utils/weaveMDBridge.ts` — openFile mock `accept` 白名单放开到 7 格式（:256-262）；`pickImage` mock 恒 `null`（:566-585）同步更新，避免 E2E 假通过（一-1②）。
- 扩展 `tests/main/ipcDialogs.test.ts` — 7 格式 filters、multiSelections 保序、不再返回全文断言。
- 扩展 `e2e/ai-agent-panel.spec.ts` — 多选上传、粘贴图片/文件、chips 折叠流程；新增 composer 粘贴单测（`tests/components/` 或就近目录按既有布局）。

**注意**：文件大小不设硬上限，但超阈值内容不内联进 prompt（落到 B3 占位符方案，一-1②）。

### B3 持久化与渲染（一-4）— 风险 L3（数据迁移）｜TDD：是

**目标**：`attachments_json` 幂等迁移 + `parsed_attachments` 正式启用 + 气泡三态 + 正文只留占位符（解决打爆 `CONTEXT_WINDOW=64000`）。

- 修改 `src/main/db/index.ts` — 按 :247-257 既有范式 `addColumnIfMissing` 补 `ai_messages.attachments_json`；`parsed_attachments`（543-556）补 `parse_status`/`parse_version` 列（见 §3 D1/D2）。
- 新建 `src/main/db/attachments.ts` — `parsed_attachments` DAO（insert/get/remove/listByConversation，启用全库无读写的死表，八-3②要求的读写测试随此文件）。
- 修改 `src/main/db/ai.ts` — `appendMessage`（523-555）写入 `attachments_json`（轻量元数据 id/type/name/path/size/parseStatus，一物两表）。
- 修改 `src/shared/ai/conversation.ts` — `IAIMessage`（30-43）加可选 `attachments` 字段（旧消息无字段向后兼容，渲染按可选处理）。
- 修改 `src/shared/ai/mention.ts` — 复用死类型 `IAttachmentPayload`（12-19）并补 `path`/`size`/`parseStatus` 可选字段。
- 修改 `src/main/ai/ipc/chatHandlers.ts` + `src/main/ai/ipc/agentHandlers.ts` — 发送链路接收附件元数据，落 `attachments_json` 与 `parsed_attachments`（解析状态三态流转）。
- 修改 `src/render/stores/agentStore.ts` — `sendAgentMessage` 携带附件元数据（不内联正文）。
- 修改 `src/render/components/AIAgent/panel/AIPanelComposer.tsx` — `handleSend`（384-395）：`content` 只拼 `[文件: xxx]`/`[图片: xxx]` 占位符，不再拼接 `att.content` 全文。
- 修改 `src/render/components/AIAgent/message/AIMessageBubble.tsx` — user 分支（276-358，纯文本 `:327`）新增附件 chips、图片缩略图、解析中/失败/完成三态渲染。
- 新建 `tests/main/db/attachments.test.ts` — DAO 读写与迁移幂等；扩 `tests/main/ai/ipc.test.ts` — appendMessage 带附件落库；组件测试覆盖气泡三态与旧消息兼容。

### B4 批量导入通道（四-3）— 风险 L3｜TDD：是

**目标**：`importDirAsKb` 扩 7 格式且先解析再入索引，失败可见；附件入 KB 通道打通 `parseDocument → indexImportedText`，带 `parsed_attachments.id` 关联。

- 修改 `src/main/ai/ipc/kbHandlers.ts` — `importDirAsKb`（233-260）：`:247` 正则 `/\.(md|txt)$/i` 扩 7 格式；改为先 `parseDocument` 再 `indexImportedText`（直接 utf-8 读 pdf 必乱码入库）；单文件失败写 `status='error'` 不静默跳过（245-258 的 `continue` 改造）；新增附件入 KB 函数（关联 `parsed_attachments.id`、异步与进度反馈，四-3②）。
- 修改 `src/main/ai/knowledge/kbIndexer.ts` — `indexImportedText`/`indexFile`（250-282 / 193-231）支持 `source_type='attachment'` 与附件关联字段。
- 修改 `src/main/db/kb.ts` — `upsertKbDocument` 支持 `attachmentId`（为 §3 D3 补列供写入方）。
- 修改 `src/main/db/index.ts` — `kb_documents` 幂等补 `attachment_id` 列 + 索引（见 §3 D3；删除附件→清理 KB 对齐 `ipc-handlers.ts:74-84` 模式）。
- 修改 `src/render/components/AIAgent/knowledge/KnowledgeBaseSettings.tsx` — 导入结果显示 `error` 状态可见（现有调用链 `agentStore.ts:1345` → preload:528 → `KB_IMPORT_DIR`）。
- 扩展 `tests/main/ai/kbIndexer.test.ts` / 新增 kbHandlers 测试 — 7 格式目录导入、解析先行（pdf 不乱码入库）、失败 `status='error'`、附件关联与删除清理。

### B5 检索接通（四-1 + 四-2 + 三-2）— 风险 L3｜TDD：是

**目标**：`kbIndexOpts()` 返回真实配置贯通 3 入口、历史回填限速、FTS5 降级；`splitNote` 表格边界 + `heading_path` 真实写入（三-2 与四-2 同批，四-2②强制）。

- 修改 `src/main/ai/ipc/kbHandlers.ts` — `kbIndexOpts()`（275-277，**偏差：非 kbIndexer.ts**）改读真实 embedding 配置（读既有 `getAiConfig` + embedding config 表，`KB_STATUS` :99 已有 `kbEmbeddingProvider`/`apiKeyEnc` 判定可复用），贯通 3 调用点（:45/:256/:269）。
- 修改 `src/main/ipc-handlers.ts` — 保存防抖 `scheduleReindexAfterSave`（62-72，:69 不再传 `{}`）改传真实配置。
- 修改 `src/main/ai/knowledge/kbIndexer.ts` — `NoteChunk`（26-30）扩 `headingPath`；`splitNote`（63-101）识别表格边界并整表独立成 chunk、超长表按逻辑单元切分并重复带表头、标题统领多段落合并、保持 Markdown 表头行与分隔行配对（三-2②）；`writeChunks`（125-178）写入 `heading_path`；向量写分支（145-175）接回填触发。
- 修改 `src/main/db/kb.ts` — `insertChunksBatch` 写 `heading_path` 列。
- 新建 `src/main/ai/knowledge/vectorBackfill.ts` — 历史 chunk 向量回填：后台限速 + 防抖 + 按 `kb_documents.status` 范式可观测状态（pending→done/error），回填期间检索保持 FTS5 可用（四-1②）。
- 修改 `src/main/ai/knowledge/kbSearch.ts` — 按 `embedding_model` 列过滤旧向量（切换模型失效策略，四-1②）；`aggregateAndExpand`（190/681）生效验证用例。
- 修改 `src/main/ai/knowledge/kbSearchFts.ts` — 向量检索模型过滤与降级路径兼容（`sqlite-vec` 加载失败走纯 FTS5，`db/index.ts:29-37` 已有降级，不得破坏 `knowledge.md:61-61~66` 未配置走纯 FTS5 约定）。
- 扩展 `tests/main/ai/kbIndexer.test.ts` — 表格边界/整表独立 chunk/超长表带表头/标题统领/headingPath 携带；新建回填测试（限速、失败降级、状态可观测）；扩 `kbSearch.test.ts` — 聚合生效与模型切换过滤。

### B6 多模态图片（五-1 + 五-2 + 五-3）— 风险 L4｜TDD：是

**目标**：`llmClient` 的 `content` 贯通数组、两套协议分流、压缩丢图显式设计（Q4）、图片落盘相对路径、死代码接活。与二-4 强耦合（五模块引言），B7 紧随。

- 修改 `src/main/ai/llm/llmClient.ts` — `messages` content 类型（14-27）扩 `string | ContentPart[]`；SSE 主入口（229-347）与重试版本（379-402）透传数组；`tool_calls` 增量解析（145-206）不回归。
- 修改 `src/main/ai/contextManager.ts` — `LlmMessage.content`（14-18）扩数组；压缩策略按 Q4：**保留最近 N 张（3）图片，更早图片降级为占位符并显式提示**（:21/:35/:101 触发点）。
- 修改 `src/main/ai/llm/anthropicCompat.ts` — `AnthropicMessage.content`（7-40，:21/:42/:60）加 `image` block 类型。
- 修改 `src/main/ai/llm/anthropicClient.ts` — content 数组序列化（206-276）。
- 修改全部调用点（五-1②"不能只改主循环"）：`src/main/ai/rewrite.ts`（:41/:76）、`src/main/ai/ipc/chatHandlers.ts`、`src/main/ai/skillLoader.ts`（:222）、`src/main/ai/agent/agentLoop.ts`（:271，分流遵循 `docs/architecture/ai-agent.md:18-37` 既有 6 处范式）、`src/main/ai/agent/agentEventStore.ts`（:113/:164 回放存相对路径不存 base64）。
- 修改 `src/main/ai/costTracker.ts` — 图片 token 计价（:80/:93/:244/:255 链路，当前零图片计价）。
- 修改 `src/main/ai/image/imageStorage.ts` — 接活（:39-161）：落盘 `userData/attachments/{userId}/{conversationId}/{id}.{ext}`、返回相对路径（绝对路径启动时重建）、清理接口（五-2②）。
- 修改 `src/main/ipc-handlers.ts` — 图片选择（153-166）/粘贴（584-590）后落盘主进程 handler；删除会话/附件时清理落盘文件（对齐 :74-84 模式）。
- 修改 `src/shared/constants.ts` + `src/main/preload.ts` + `docs/modules/08-IPC通信机制.md` — 如新增 `attachment:store` 类通道，三处同步（§1.3 硬规则）；否则复用既有通道并在此记录取舍。
- 修改 `src/main/ai/agent/agentMedia.ts` + `src/main/ai/image/imageRecognition.ts` — 主进程接活（`prepareAgentContext` 组装消息注入 image block，保证 Chat/Agent/Skill 三链路一致，五-3②）；`recognizeImage`（44-105）接入真实 `llmCall`。
- 修改 `src/render/components/AIAgent/panel/AIPanelComposer.tsx` — 图片 `path` 保留进 `attachments_json`（424-435；:389-391 不再丢弃只留文本）。
- 修改 `src/render/components/AIAgent/message/AIMessageBubble.tsx` — 缩略图 + 点击放大 lightbox + "图片未成功识别"失败态。
- 格式边界（五-2②）：`svg` 拒绝并提示（或栅格化，实现择一记录）、`gif` 首帧 + 提示、单图大小上限提示。
- 发送前 vision 能力检测（`modelDiscovery.ts:65-71 guessCapabilities`）：不支持则降级纯文本 + 显式提示。
- 测试：扩 `tests/main/ai/contextManager.test.ts`（压缩丢图 Q4）、`llmClient.test.ts`（数组 content、双协议分流）、新增 `agentMedia`/`imageRecognition`/`imageStorage` 测试（五-3②"必须补测试覆盖"）、气泡 lightbox 组件测试。

**执行期调研（③）**：`@anthropic-ai/sdk` image content block / OpenAI `image_url`（`detail` 与多模态 token 计费）。

### B7 PDF 版面与 D 路线（二-3 + 二-4 + 二-6 页码落库）— 风险 L3｜TDD：是

**目标**：坐标分栏/无框线表格/跨页合并/页眉页脚；无文本层短路转 D；`source_ref` 换真实页码。

- 修改 `src/main/ai/files/documentParser.ts` — `parsePdf`（40-60）接版面产物；无文本层检测（抽取字符数/页面积比）命中直接短路转 D 并给用户提示（二-3②）；表格同时产出 Markdown 与 CSV 两态（二-6②）。
- 新建 `src/main/ai/files/pdfLayout.ts` — 自研版面规则：(X,Y) 坐标聚类分栏（先左栏后右栏）、字体大小判标题层级、无框线表格按标识拼接还原行列、跨页表格检测切断并合并补全表头、跨页重复文本检测剔除页眉页脚入 metadata（二-3② 全项）。
- 新建 `src/main/ai/files/multimodalParse.ts` — D 路线：**显式触发条件**（无文本层 / 双栏检测失败 / 表格置信度低于阈值，不全量烧 token）；页面渲染成图选型（`pdfjs-dist` vs 复用 pdfium，执行期实测 liteparse 坐标能力后定，二-3③）；页数上限与并发；按页估算 token 成本；模型不支持 vision 降级 A 路线纯文本 + 显式提示（不能静默出垃圾结果）；提示词要求输出结构化表格/数据而非感想（二-4②）；`.doc` D 路线优先（Q3）。
- 修改 `src/main/ai/costTracker.ts` — D 路线图片 token 计价接入（与 B6 合并实现）。
- 修改 `src/main/ai/knowledge/kbIndexer.ts` — `buildSourceRef`（181-187）以真实页码/偏移替代 60 字符近似（二-6②）。
- 修改 `src/main/db/attachments.ts`（B3 新建）— 页码/章节/表格序号随产物落 `parsed_attachments`；`parseVersion` 便于回填重建。
- 修改 `package.json` — 视选型可能新增 `pdfjs-dist` 依赖（**选型同时评估对七-1 体积门禁的影响**）。
- 测试：固定样例 PDF 双栏顺序断言、无框线表格行列准确率、跨页合并、无文本层检测短路、D 触发/降级路径行为断言（六-3②指标的前置用例）。

**执行期调研（③）**：`pdfjs-dist`（`getTextContent()` transform/items 坐标、canvas 栅格化）、`@anthropic-ai/sdk` document block、OpenAI `image_url`、fastcrw「PDF 版面阅读顺序还原与跨页表格合并算法」「Anthropic Claude PDF Support 设计思路」。

### B8 工具、引用与评测（六-1 + 六-2 + 六-3 + 四-4）— 风险 L3｜TDD：是

**目标**：文档四工具只读区落地、citation 真实页码回链、评测指标自动化、检索质量复核。

- 新建 `src/main/ai/tools/searchDocument.ts` / `readPage.ts` / `extractTable.ts` / `analyzeChart.ts` — 文档工具集，对齐 `readLocalFile.ts` 只读范式（1MB 上限、错误文案规范）。
- 修改 `src/main/ai/toolRegistry.ts` — `CORE_TOOLS`/defer 注册 + `handlerMap`（56-81）+ `executeTool` 调度（398-419），保持 :370-374 字母序排序（prompt 前缀缓存稳定）。
- 修改 `src/main/ai/agent/agentToolSelector.ts` — 新工具落 `READ_ONLY_TOOLS`（18-27）与 `toolsForIntent` 意图分区（51-144）；**清理陈旧工具名 `readFileRevision`/`listFileRevisions`/`getFileInfo`（:19-20，六-1②顺手清理，B8 承担以免 B11 重复）**。
- 修改 `src/main/ai/agent/concurrencyDefs.ts` — 新工具注册进并发安全表（15-58），否则 fail-closed 串行（性能陷阱）；清理 :37-39 陈旧名。
- 修改 `src/main/ai/tools/readLocalFile.ts` — `:31` 错误文案"请使用 readFile 分块读取"与实现不一致修正（实现分块或改文案，择一记录，六-1②）。
- 修改 `src/main/ai/agent/toolResultStorage.ts` — `extract_table` 超预算走落盘降级（单结果 10k/聚合 40k，:5/:105/:143-144）不截断丢数据。
- 修改 `src/render/components/AIAgent/message/AIMessageBubble.tsx` — `refsJson` 页码回链（49-91 / 398-430）、附件引用点击跳转原文对应位置、结构向后兼容历史消息（六-2②）；与五-1 图片引用共用结构的取舍在实现时写明。
- 修改 `src/main/ai/knowledge/kbIndexer.ts` — chunk 上下文前缀：**取舍按四-4②写明——仅向量侧加前缀、FTS5 侧保持原样**（避免污染关键词召回）；`source_ref` 页码承接 B7。
- 修改 `src/main/ai/tools/searchKBHandler.ts` + `src/main/ai/agent/agentContext.ts` — HyDE 收益复核（`hyde:true` + 已配向量才触发；接通后查询侧/文档侧均有向量，行为变化需复核并记录结论，四-4②）；拒答阈值 0.6 对附件文档是否独立配置——**本期只复核记录结论，不新增配置项**（新增配置列入 §5）。
- 新建评测用例（六-3②仅收可自动化指标）：表格行列还原固定样例断言、chunk 页码溯源单测、固定 query 集检索命中率回归、多模态降级路径行为断言；OCR 准确率指标不做（无 OCR，决策基线）。
- 新建 `docs/testing/doc-pipeline-tools.tdd.md` 等 TDD 报告（六-3②范式，对齐现有 7 篇）。

### B9 文件树（三-1 + 三-3）— 风险 L2｜TDD：是

**目标**：复杂 md 发送不整篇内联；相对路径图片基准正确、越界拦截、Agent 可识别（文件树不扩格式，三模块引言）。

- 修改 `src/render/components/Editor/panels/FileTreePanel.tsx` — 点树里的 md 发会话只带文件名+路径+摘要（`doSwitchFile` 195-238 / `handleFileClick` 241-260 改发送构造，正文由工具按需读取，三-1②）。
- 修改 `src/render/components/AIAgent/composer/MentionPreview.tsx` — 500 字截断改"摘要 + 前 N 行"（161-203，三-1②）。
- 修改 `src/main/ipc-handlers.ts` — `FOLDER_READ` `.md` 过滤（:539）**保持不变**，加"有意为之"注释防后人误"修复"（三-1②）；`FILE_READ`（418-428）本身不动（不整篇内联在发送侧构造）。
- 修改 `src/render/stores/agentStore.ts` — `fileTreePaths`（906-928）上下文策略配合摘要发送。
- 新建 `src/main/ai/files/mdImageResolver.ts` — 相对路径解析：基准为 md 文件所在目录（非 cwd/userData）、`../../` 越界拦截不读工作区外、图片缺失降级提示、md 移动后失效处理（三-3②）。
- 修改 Agent 图片识别链路 — 复用 B6 `agentMedia`/`imageRecognition`，使 md 图片可被 Agent 看到（三-3②本期目标）；`imageIndexer`/`images_vec` 图片向量**不动**（§5 后续）。
- 测试：越界拦截、基准目录、超长 md 摘要发送、`FOLDER_READ` 过滤行为锁定（防误"修复"回归）。

### B10 打包体积（七-1 + 七-2 + 七-3）— 风险 L4（打包红线）｜TDD：门禁脚本单测 + 实测验证

**目标**：500MB 目标 / 1GB 红线双口径门禁 fail build；四项瘦身不改任何既有功能。

- 修改 `package.json` — `build.files`（85-95）加反向 `!` 排除：`@llamaindex/liteparse` Linux 件（`liteparse.linux-x64-gnu.node`+`libpdfium.so` 共 31.9MB）、`jieba-wasm` 冗余平台件（先确认 `tokenizer.ts:35/:143` 动态 require 实际路径只走一条）、`better-sqlite3` `deps/sqlite3/*.c` 源码（**绝不能误伤 `build/Release/*.node`，误伤应用起不来——七-1②高危点**）；scripts（12-21）加 `clean`（清 `dist-main` 78 个历史哈希分片约 44MB）与 `postbuild`/`size` 门禁。
- 新建 `scripts/sizeGate`（ts/mjs 按项目脚本惯例）— 双口径断言：`release/*.exe|*.msi` ≤500MB、`release/win-unpacked/` ≤1GB，超限直接 fail build；本地 stat 不依赖网络；基线数字（2026-09-25：Setup 147.68MB / win-unpacked 602.1MB / asar 287.09MB）写进注释；输出 top-N 体积贡献者（七-3②）。
- 修改 `src/render/components/Common/Icon.tsx` — `react-icons` 改按需导入（实际 import 在 **:140**，非源文档所记 :2）；**先产出 name→component 图标清单全表 + 视觉回归断言再替换**，任何图标不得消失或变样（七-1②红线）。
- 修改 `src/main/ai/knowledge/tokenizer.ts` — jieba 四份 wasm 去重（35/:143，按实测路径保留一份）。
- 修改 `vite.config.ts` — external 清单（:26）按需同步。
- **七-2 monaco（Q5）**：运行时验证（加载日志/模块解析追踪）asar 内 68.5MB 副本是否被加载（`monacoSetup.ts:9` 渲染层确有引用）；**验证通过才剔除；确在加载则任务立即作废并记录结论，不动配置**——唯一判定出口，不得凭静态分析下结论。
- 修改 `docs/guide/packaging.md` — build 配置变更同步（11-19 / 108-132）。
- 验证：打包后实测应用可启动 + 全量测试通过 + 体积实测记录进 status.md（七-1②完成定义）。

### B11 写控制与外发（八-1 + 八-2 + 八-3）— 风险 L4（安全语义）｜TDD：是

**目标**：B+C 决策落地——附件入库仍受 `allowSend` 约束 + 上传勾选入 KB；write_mode 差异如实记录；死通道二选一并同步文档。**全程不得削弱既有认证/权限控制。**

- 修改 `src/main/ai/ipc/chatHandlers.ts` + `src/main/ai/ipc/agentHandlers.ts` — consent 注入扩展（77-85 / 225-232），不新增任何放宽 `allowSend` 语义的代码路径（硬规则）。
- 修改 `src/main/ai/knowledge/kbSearch.ts` / `searchKBHandler.ts` — **Q1 取舍落地（入 KB + 过滤）**：附件照常索引（保本地检索价值）；`allowSend=false` 时按 `source_type='attachment'` 过滤不返回未授权附件结果；勾选=该文档显式授权（不追溯放宽其他笔记）。**与现状交互**：`agentContext.ts:282` `kbEgressAuthorized=false` 时 `searchKB` 整体不注入（`agentToolSelector.ts:97/110/128/135`）——实现需在此既有语义上写明两条路取舍并测试锁定（八-1②"两条路都要写清取舍"），推荐方案已在 Q1 预对齐，执行不得推翻。
- 修改 `src/main/ai/knowledge/kbIndexer.ts` — 附件入 KB 记录勾选授权标记（供过滤键）。
- 修改 `src/main/db/index.ts` — `ai_config` 幂等补 `upload_kb_default INTEGER DEFAULT 1`（Q2 默认勾选，见 §3 D5）。
- 修改 `src/render/components/AIAgent/panel/AIPanelComposer.tsx` — 「加入知识库」勾选 UI（默认勾选，状态持久化走新字段）。
- 修改 `src/render/stores/agentStore.ts` — 勾选状态随发送/入 KB 传递。
- **八-2（只做两件事，不补完整接线）**：修改 `docs/architecture/ai-agent.md`（128-135）与 `docs/architecture/security.md`（53-67）——如实记录差异（`auto` 分支在主进程工具执行路径无消费点；staleness 实际为 `xxHash64` 非文档所称 MD5）；附件/解析产物写入路径一律按 `manual` 确认语义执行——复用 `agentToolExecutor.ts:118-197` 确认范式，确认 UI 不得"看似生效实则空转"。
- **八-3**：修改 `src/shared/constants.ts` — `AGENT_UPLOAD_ATTACHMENT`/`AGENT_UPLOAD_IMAGE`（173-174）二选一，**本计划取"删除常量"**（一-1/一-3 已走 `DIALOG_OPEN_FILE`/`KB_PARSE_DOCUMENT`/`clipboard:read-image` 既有通道，接线无必要——取舍记录于此，执行时按此为准）；同步删除 `docs/modules/08-IPC通信机制.md:162` 对应行，不留第三种状态。
- 修改 `docs/architecture/database.md`（134-175）— `kb_documents`/`kb_chunks` 字段描述与 `src/main/db/index.ts:201-223` 实际 DDL 对齐（**同步范围仅限本次触及条目，不做全仓文档重构**，八-3②）。
- `parsed_attachments` DAO 已在 B3 启用；陈旧工具名清理已在 B8——B11 验收时核对不留尾巴。
- 测试：扩 `tests/main/ai/consent.test.ts` — 过滤行为矩阵（allowSend × 勾选授权 × source_type）、无放宽路径断言；迁移补列幂等测试。

### B12 Docling PoC（二-5）— 风险 L2（随时可停）｜TDD：否（PoC 量化报告）

**目标**：仅验证、可插拔后端，不硬替换 `parseDocument`（90-118），不阻塞主线。

- 新建 `docs/plan/doc-pipeline.docling-poc.md` — PoC 报告：量化判定四项（双栏阅读顺序正确率、表格行列还原准确率、单页解析耗时、装机体积增量）。
- 新建 PoC 脚本（`scripts/` 下，不进打包）— 以可插拔后端接口接入 `documentParser.ts` 试验分支验证。
- 红线核对：模型与 pdfium 走自带脚本按需下载到开发机，**一个字节不进安装包**；任何"替换 A 路线"决策必须先重跑 B10 的七-3 体积门禁（500MB/1GB），未过不得替换；评估 Windows 原生件 `asarUnpack` 与签名问题（二-5②全项）。
- 出口：不达标即关闭本任务，主线不受影响（Q6：主线完成后执行、量化不达标即关）。

---

## 3. 数据变更专章

> 涉及批次：B3（D1/D2）、B4（D3）、B5（D4）、B8（D6）、B11（D5）。共 **6 个数据变更点**。

### 统一迁移纪律（适用于全部 D 项）

1. **写法**：只用既有范式——`addColumnIfMissing()`（`src/main/db/index.ts:309`，PRAGMA table_info 探测缺失才 `ALTER TABLE ADD COLUMN`，重复执行 no-op）与 `CREATE TABLE/INDEX IF NOT EXISTS`；**照 :247-257 现成范式**，不引迁移框架。
2. **幂等**：空库（全新 `CREATE` 链路跑一遍）与旧版本升级（已有库补列）落到同一终态；重复启动零副作用。
3. **不动历史迁移**：不修改、不删除任何已应用过的迁移块（红线）；新变更只追加。
4. **回滚方式（通用）**：全部为**追加式、可空或带 DEFAULT** 的列/取值扩展 → 旧版本代码 SELECT 明确列名、不读新列，**旧版本可直接打开升级后的库**；回滚 = 代码 revert + 列保留无害；**禁止写 DROP 迁移**。JSON 级变更（D6）按可选字段解析，天然双向兼容。
5. **验收**：每项迁移配"空库首建 + 旧库升级 + 重复执行"三断言单测。

### D1 `ai_messages.attachments_json` 补列（B3）

- **现状**：`ai_messages`（`db/index.ts:188-199`）仅 id/conversation_id/user_id/role/content/refs_json/tool_call_id/tool_calls/created_at，无任何附件字段；`appendMessage`（`db/ai.ts:523-555`）只写 `content`。
- **目标模型**：`attachments_json TEXT DEFAULT NULL`，JSON 数组仅存轻量元数据 `[{id,type,name,path,size,parseStatus}]`；正文内容不入消息表（存 D2），`content` 只留 `[文件: xxx]`/`[图片: xxx]` 占位符（一物两表，避免消息表膨胀）。
- **迁移写法**：`addColumnIfMissing(database, 'ai_messages', 'attachments_json', 'attachments_json TEXT DEFAULT NULL')`，紧邻 :247-251 既有两行之后。
- **回滚**：旧版本不读该列，直接兼容；列保留无害。

### D2 `parsed_attachments` 启用 + 补列（B3）

- **现状**：表已建（`db/index.ts:543-556`，注册 :266）：id/user_id/conversation_id/file_name/file_type/content/created_at；**全库无任何 INSERT/SELECT**（死表）。
- **目标模型**：补 `parse_status TEXT DEFAULT 'done'`（pending/processing/done/error 三态渲染来源）、`parse_version INTEGER DEFAULT 1`（二-6② 回填重建依据）；新增 DAO `src/main/db/attachments.ts` 承担全部读写；`content` 列存解析产物全文。
- **迁移写法**：`CREATE TABLE IF NOT EXISTS`（建表语句保持幂等，新列可不回写建表段）+ `addColumnIfMissing` 补两列；空库与旧库同路径收敛。
- **回滚**：旧版本本就不读该表，零影响。

### D3 `kb_documents` 附件关联（B4 通道，B11 过滤复用）

- **现状**：`kb_documents`（:201-210）`source_type TEXT`（实际取值 `'db'`/`'import'`）+ `file_id`（导入时恒 NULL），无附件关联列。
- **目标模型**：补 `attachment_id TEXT DEFAULT NULL`（关联 `parsed_attachments.id`，删除附件→清理 KB，对齐 `ipc-handlers.ts:74-84`）+ `idx_kb_doc_user_attachment` 索引；`source_type` 增加取值 **`'attachment'`**（TEXT 取值扩展，无 DDL）——B11 的 Q1 过滤键。
- **迁移写法**：`addColumnIfMissing` + `CREATE INDEX IF NOT EXISTS`；取值扩展零迁移。
- **回滚**：列可空旧版忽略；旧版代码遇 `source_type='attachment'` 仅列表展示（TEXT 不校验），行为安全；回滚后新数据不再写入。

### D4 `kb_chunks.heading_path` 写入（B5）— 无 schema 变更

- **现状**：列已建（`db/index.ts:479`）**从无写入**；`kbSearch.ts:280/489/542/608` 只读，`aggregateAndExpand`（:190）因此失效。
- **目标模型**：`splitNote` 输出 `headingPath` → `insertChunksBatch` 写列；`NoteChunk` 类型同步扩展。
- **迁移写法**：无 DDL；**历史 chunk 不强制回填**——读侧按 NULL 降级（老数据、纯文本 txt，四-2②），随保存 reindex 自然补齐；如需主动回填与 D5 向量回填共用后台任务。
- **回滚**：列早已存在，停止写入即回滚；读侧 NULL 容错现状已具备。

### D5 `ai_config.upload_kb_default` 补列（B11 / Q2）

- **现状**：`ai_config`（:162-175 + 补列链 :226-257）无勾选默认字段。
- **目标模型**：`upload_kb_default INTEGER DEFAULT 1`（**默认勾选**「加入知识库」，Q2 与"勾选=显式授权"语义自洽）。
- **迁移写法**：`addColumnIfMissing`，追加在 :253-257 补列组之后。
- **回滚**：DEFAULT 1 可空列，旧版不读，直接兼容。

### D6 `refs_json` 结构扩展（B8 / 六-2）— JSON 级，无 DDL

- **现状**：`IAIMessage.refsJson`（`conversation.ts:30-43`）已存在，气泡解析渲染（`AIMessageBubble.tsx:49-91/398-430`）。
- **目标模型**：JSON 内扩展页码/附件锚点字段（真实页码回链、附件跳转）；历史消息无新字段按可选解析（六-2②向后兼容）。
- **迁移写法**：无 schema 变更；读写均按可选字段。
- **回滚**：旧渲染忽略新增字段，双向兼容。

---

## 4. 验收标准

### 4.1 全局质量门禁（每批次完成的必要条件，`docs/README.md:65-67`）

1. `npx tsc --noEmit` 零错误（TS strict）；
2. `npx vitest run` 全绿（**不删除任何既有测试**）；
3. ESLint 0 error；
4. `npx vite build` 成功；
5. `npx playwright test` 全绿。

**附加红线（§执行纪律 2）**：体积 ≤1GB 硬上限（500MB 目标/门禁）；瘦身不改变任何既有模块功能；不削弱认证与权限控制（尤其 `allowSend`）；不擅自修改已应用过的历史迁移；不删测试。

**过程产物**：新增行为同步 TDD 报告到 `docs/testing/*.tdd.md`；每批次更新 `docs/plan/doc-pipeline.status.md`（状态/证据/遗留问题/下一任务，未验证不得声称完成）。

### 4.2 每批次验收点（引用源文档拷问细节条目）

| 批次 | 验收点（源文档拷问细节） |
|---|---|
| B1 | 二-1②：产物为结构化（标题/表格/页码/章节路径）而非纯文本；`.doc` 降级策略落地（Q3）；`isSupportedDocument` 接线或删除择一有记录；`KB_PARSE_DOCUMENT` 渲染层有调用方。二-2②：多 sheet 全转且 sheet 名作章节、合并单元格还原、超长/超宽表行列结构化、空单元格不错位、公式取计算值、xlsm/xlsb 不做。二-6①：产物含页码/章节/表格序号/图片序号/parseVersion（版面细项随 B7 补全并注明） |
| B2 | 一-1②：只传 path、composer 无 `readFileSync`；单文件失败不断批；大文件不内联（占位符由 B3 落地）；`pickImage` mock 同步无 E2E 假通过。一-2②：返回保用户选择顺序；chips >5 折叠；解析并发限流。一-3②：浏览器 clipboard API 与 Electron 兜底两种图片来源均覆盖；`DataTransfer.files` 走 7 格式；图片走五-2 落盘不 base64 进消息表；粘贴防文本重复插入 |
| B3 | 一-4②：`attachments_json` 只存轻量元数据、内容入 `parsed_attachments`（一物两表）；正文只留占位符不打爆 `CONTEXT_WINDOW=64000`；迁移幂等且空库/旧版升级均可；旧消息无字段向后兼容；气泡 chips/缩略图/解析中/失败三态 |
| B4 | 四-3②：正则扩 7 格式且**先 `parseDocument` 再入索引**（pdf 不乱码入库）；失败 `status='error'` UI 可见不静默；附件入 KB 带 `parsed_attachments.id` 关联（删除附件→清理 KB）；大附件异步与进度反馈；入 KB 勾选取舍在 B11 落地 |
| B5 | 四-1②：`kbIndexOpts()` 真实返回配置并贯通 3 入口（保存防抖/手动重索引/目录导入，漏一条即部分摆设）；历史回填限速+防抖；回填期间 FTS5 可用（降级不报错）；未配置走纯 FTS5 分支不破坏；切换模型旧向量失效策略落地；Float32 BLOB 与 `sqlite-vec` 降级兼容；回填状态可观测。四-2② + 三-2②（同批）：`NoteChunk` 扩 `headingPath`；空路径降级；`aggregateAndExpand` 写入后生效有验证（防历史回归）；表格边界整表独立 chunk；超长表逻辑切分重复表头；标题统领合并；表头行与分隔行配对不破坏 |
| B6 | 五-1②：`LlmMessage.content` 贯通全部调用点（rewrite/chatHandlers/skillLoader/agentLoop/事件回放），非只改主循环；压缩丢图显式设计（Q4：保最近 3 张、更早降级占位符+提示）；OpenAI `image_url` 与 Anthropic `image` 两套分流复用 `isAnthropicModel`；历史回放存相对路径不存 base64；vision 能力检测发送前生效、不支持降级纯文本+提示。五-2②：`userData/attachments/{userId}/{conversationId}/{id}.{ext}` 结构；消息存相对路径、绝对路径启动重建；删除清理对齐既有模式；svg 拒绝/栅格化提示、gif 首帧、大小上限提示。五-3②：接线点在主进程保证三链路一致；`agentMedia`/`imageRecognition` 接活且补测试覆盖；缩略图 lightbox + 识别失败态 |
| B7 | 二-3②：双栏按坐标先左后右；无框线表格行列还原；跨页表格合并补表头；页眉页脚跨页重复检测剔除入 metadata；无文本层检测命中短路转 D 并提示；本期无 OCR。二-4②：触发条件显式（不全量烧 token）；渲染选型有实测依据；不支持 vision 降级 A 路线且明确提示（不静默出垃圾）；页数上限+并发+token 成本估算（计价链路覆盖图片）；提示词要求结构化表格/数据输出。二-6②：`source_ref` 真实页码替代 60 字符近似；表格 Markdown+CSV 两态；`parseVersion` 落库 |
| B8 | 六-1②：新工具落只读区不进 `WRITE_TOOLS`；全部注册 `concurrencyDefs`（不落 fail-closed 串行陷阱）；defer 同步意图分区；陈旧工具名（`readFileRevision`/`listFileRevisions`/`getFileInfo`）清理；`extract_table` 超预算落盘降级；`readLocalFile:31` 文案/实现不一致修正。六-2②：页码回链真实；附件引用可点击跳转原文位置；`refsJson` 历史消息兼容；与图片引用结构关系有记录。六-3②：四项可自动化指标（表格还原/页码溯源/检索命中/降级路径）落地 + TDD 报告；OCR 指标不做；门禁全绿。四-4②：上下文前缀取舍写明（仅向量侧/FTS5 原样）；页码入 `source_ref`；HyDE 收益复核有结论；拒答阈值复核记录（不新增配置） |
| B9 | 三-1②：树 md 发会话只带文件名+路径+摘要不整篇内联；`FOLDER_READ` `.md` 过滤保持 + 注释/文档写明有意为之；`MentionPreview` 改摘要+前 N 行。三-3②：解析基准为 md 所在目录；`../../` 越界拦截不读工作区外；图片可被 Agent 识别（走五链路）；缺失降级提示；图片向量明确标注后续 |
| B10 | 七-1②：图标清单全表 + 视觉回归断言先于替换，无图标消失/变样；`clean` 脚本清历史分片；不排除误伤 `better-sqlite3/build/Release/*.node`；打包后实测可启动 + 全量测试通过。七-2②：运行时验证为唯一判定出口——验证不过（确在加载）即**任务作废并记录**（Q5），不动配置。七-3②：双口径均卡（exe≤500MB、win-unpacked≤1GB）超限 fail build；基线写注释；无网络依赖；输出 top-N 清单 |
| B11 | 八-1②：B+C 落地且取舍写明（入 KB + 按 `source_type` 过滤，Q1）；`allowSend` 不放宽（无新增放宽路径，测试断言）；勾选默认值与持久化落地（Q2 存 `ai_config`）；勾选=该文档显式授权、不追溯其他笔记。八-2②：文档差异如实记录（auto 无消费点、MD5→xxHash64）；附件/解析产物写入按 `manual` 确认语义（复用既有确认范式）；不补完整接线；确认 UI 无空转误导。八-3②：`agent:upload:*` 二选一且 `docs/modules/08-IPC通信机制.md:162` 同步（本计划取删除）；`parsed_attachments` DAO 有读写测试；陈旧工具名清理核对；`database.md` 同步仅限触及条目 |
| B12 | 二-5②：量化四项（双栏正确率/表格行列准确率/单页耗时/体积增量）有数据；模型与 pdfium 零进包；转正决策必须先过七-3 门禁；不达标关闭任务不影响 Windows 原生件 `asarUnpack`/签名评估有结论 |

---

## 5. 范围外清单（后续（不阻塞））

| 项 | 依据 | 备注 |
|---|---|---|
| OCR（Tesseract 字符识别及准确率指标） | 决策基线 + 六-3② | 本期无 OCR；无文本层 PDF 一律降级 D 路线并提示 |
| 图片向量入库（`imageIndexer` + `images_vec` 接活） | 三-3② / 五-3③（Q16=B） | `imageIndexer.ts`/`kb_images` 保持现状不动 |
| 拖拽上传 | 决策基线（上传入口） | 仅打通打开/多选/粘贴三入口 |
| `write_mode` 完整接线（auto 分支消费点、确认卡片+staleness 全链路） | 八-2② | L3 且触及安全；本期只如实记录差异 + 附件写路径按 manual 确认语义 |
| xlsm / xlsb 格式 | 二-2② | 7 格式清单外，不做扩格式 |
| 文件树扩格式（非 md 文件显示） | 决策基线 | 文件树仍只显示 md 与文件夹；任务对象是复杂 md 内容本身 |
| Docling 转正替换 A 路线 | 二-5② / 决策基线 | 本期仅 PoC；转正须先重跑七-3 体积门禁 |
| 附件文档独立拒答阈值配置 | 四-4②开放点 | 本期只复核记录结论；如需配置项列后续 |
| `monaco-editor` asar 剔除（若运行时验证不通过） | 七-2② / Q5 | 验证发现确在加载 → 任务作废、记录结论、不动配置 |

---

## 附：与源文档的对应关系

- 29 任务覆盖核对：一(4)→B2/B3；二(6)→B1(二-1/二-2/二-6 契约)+B7(二-3/二-4/二-6 落库)+B12(二-5)；三(3)→B5(三-2)+B9(三-1/三-3)；四(4)→B4(四-3)+B5(四-1/四-2)+B8(四-4)；五(3)→B6；六(3)→B8；七(3)→B10；八(3)→B11（八-3 陈旧工具名部分由 B8 承担）——共 29 项无遗漏、无越界新增。
- Q1~Q6 处置落点：Q1→B11；Q2→B11/D5；Q3→B1（类型降级）+B7（D 路线）；Q4→B6；Q5→B10；Q6→B12。
