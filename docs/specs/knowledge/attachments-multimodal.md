# 附件与多模态规格（Attachments & Multimodal）

> 规范编号：SPEC-DOC-ATTACH | 版本：v1.0 | 更新：2026-10-01
> 关联需求：[doc-pipeline 需求](../../requirements/doc-pipeline/doc-pipeline.req.md)（8 模块 29 任务：一 会话附件上传、五 多模态图片、三-1/三-3 文件树）
> 关联文档：[document-parsing.md](./document-parsing.md)（解析层，上游）、
> [kb-indexing-egress.md](./kb-indexing-egress.md)（索引 → 检索 → 外发，下游）、
> [ai-agent.md](../../architecture/ai-agent.md)、[database.md](../../architecture/database.md)、[ipc.md](../../architecture/ipc.md)
>
> **性质**：交付契约提炼——`docs/plan/doc-pipeline.*` 系列（后续整体删除）中附件持久化、多模态消息与
> 文件树引用规格的固化快照。每条事实标注来源（文件 §章节）；遗留修复批次只搬**修复后 as-built 行为**，
> 不搬诊断过程。
>
> **边界（与既有文档的去重）**：
> - 解析产物契约、PDF 版面、D 路线、溯源（`structure_json`）归 [document-parsing.md](./document-parsing.md)；
> - 列级 DDL 细节（D3~D6）、外发闸 `allowSend` 语义、R3 四工具过闸归 [kb-indexing-egress.md](./kb-indexing-egress.md)；
> - 29 任务清单、Q1~Q6 决策与验收门禁归 [需求文档](../../requirements/doc-pipeline/doc-pipeline.req.md)。

**来源缩写**（行内 `〔源：xx §yy〕` 按下表展开为相对链接 + 章节）：

| 缩写 | 文件 |
|---|---|
| batch-changes | `docs/plan/doc-pipeline.plan/01-batch-changes.md` |
| migrations | `docs/plan/doc-pipeline.plan/02-data-migrations.md` |
| batch-records | `docs/plan/doc-pipeline.status/01-batch-records.md` |
| status | `docs/plan/doc-pipeline.status.md`（§遗留修复批次 remedial 9 项） |
| req | [requirements/doc-pipeline/doc-pipeline.req.md](../../requirements/doc-pipeline/doc-pipeline.req.md) |

---

## 1. 一物两表持久化模型

### 1.1 `ai_messages.attachments_json`（消息侧轻量元数据，D1）

- JSON 数组**只存轻量元数据** `[{id, type, name, path, size, parseStatus}]`（+ `error` 失败原因上屏字段）；
  `thumb`（data URL）与 `content`（正文）**白名单序列化剔除、不落库**。
  〔源：migrations §D1；batch-records §B3；`src/shared/ai/mention.ts` §IAttachmentMeta〕
- 正文内容**只入** `parsed_attachments.content`——两表分工，避免消息表膨胀。
  〔源：migrations §D1、§D2；batch-changes §B3〕
- `IAIMessage.attachments` 为**可选字段**：旧消息无该字段 / NULL / 坏 JSON 均向后兼容，渲染按可选处理。
  〔源：batch-changes §B3；batch-records §B3〕

### 1.2 `parsed_attachments`（解析正文与状态，D2）

- 补列 `parse_status TEXT DEFAULT 'done'`、`parse_version INTEGER DEFAULT 1`；`content` 列存解析产物全文；
  读写全部收敛到 DAO `src/main/db/attachments.ts`（insert/get/updateStatus/updateContent/remove/listByConversation，
  **全参数化 + user_id 过滤**）。〔源：migrations §D2；batch-records §B3〕
- **状态取值四态** `pending / processing / done / error`（`AttachmentParseStatus`）；DAO 状态机
  `persistIncomingAttachments`：**pending → processing → done|error**（有产物直写 done、无产物有路径经
  parseLimiter 补解析、图片 data URL 转存 content、皆无 error）。**气泡渲染三态** = 解析中 / 失败 / 完成
  ——计划稿「三态」指渲染口径，列值以四态落地值为准。
  〔源：batch-changes §B3；batch-records §B3；`src/shared/ai/mention.ts` §AttachmentParseStatus〕
- 解析结构（页码/章节/表格序号/图片锚点 + parseVersion）落 `structure_json`（D7），
  契约见 [document-parsing.md](./document-parsing.md) §2.3 / §6。〔源：batch-records §B7〕
- 发送链路：AGENT_RUN / AI_CHAT **先落两表** → 元数据随 payloadJson → 回执 `attachments` 回填渲染层乐观态。
  〔源：batch-records §B3〕

### 1.3 正文占位符（防打爆上下文窗口）

- 渲染层 `handleSend` 的 `content` **只拼 `[文件: xxx]` / `[图片: xxx]` 占位符**，不再拼接 `att.content` 全文
  ——附件解析产物由 `parsed_attachments` 承载，**不打进 `CONTEXT_WINDOW = 64000`**。
  〔源：batch-changes §B3；batch-records §B3；`src/main/ai/agent/agentHelpers.ts` §CONTEXT_WINDOW〕
- 气泡渲染：附件 chips + 图片缩略图（thumb 存活态 / `path→media://` / 图标降级）+ 点击 lightbox +
  解析中/失败/完成三态，失败显示 `att.error`（如「图片未成功识别」）。
  〔源：batch-changes §B3；batch-records §B3、§B6〕

## 2. 数据变更契约

- **统一迁移纪律**（摘要，完整条目见 [kb-indexing-egress.md](./kb-indexing-egress.md) §6）：只用
  `addColumnIfMissing()`（PRAGMA 探测幂等补列）与 `CREATE TABLE/INDEX IF NOT EXISTS`；空库首建 +
  旧库升级 + 重复执行**三断言**；**不动已应用历史迁移、禁止 DROP 迁移**。〔源：migrations §统一迁移纪律〕

| # | 契约 |
|---|---|
| **D1** | `ai_messages.attachments_json TEXT DEFAULT NULL`——JSON 数组仅存轻量元数据（一物两表，见 §1.1）；旧版本不读该列直接兼容。〔源：migrations §D1〕 |
| **D2** | `parsed_attachments` 启用 + 补 `parse_status` / `parse_version` 两列（见 §1.2）；旧版本本就不读该表，零影响。〔源：migrations §D2〕 |
| **D3** | `kb_documents` 补 `attachment_id TEXT DEFAULT NULL`（关联 `parsed_attachments.id`）+ `idx_kb_doc_user_attachment`；`source_type` 增取值 **`'attachment'`**（TEXT 取值扩展零 DDL）——**附件过滤键**，删除附件 → 清理 KB。列级细节见 [kb-indexing-egress.md](./kb-indexing-egress.md) §6。〔源：migrations §D3〕 |
| **D5** | `ai_config.upload_kb_default INTEGER DEFAULT 1`——「加入知识库」**默认勾选**（Q2，与「勾选=显式授权」语义自洽）；读侧 `NULL`/无行收敛为 `true`。授权语义见 [kb-indexing-egress.md](./kb-indexing-egress.md) §6/§7。〔源：migrations §D5；`src/main/db/ai.ts` §getUploadKbDefault〕 |
| **D6** | `refs_json` JSON 级扩展**页码/附件锚点可选字段**（无 DDL），历史消息按可选解析、新旧双向兼容。列级细节见 [kb-indexing-egress.md](./kb-indexing-egress.md) §5/§6。〔源：migrations §D6〕 |
| **D7** | `parsed_attachments.structure_json`（解析结构落库）——契约归 [document-parsing.md](./document-parsing.md) §6。〔源：batch-records §B7；migrations §说明行〕 |
| **D8** | `ai_config.vision_override INTEGER DEFAULT NULL` **三态**：`NULL`=自动判定（已知能力表 → 未知模型乐观注入）、`1`=强制支持、`0`=强制不支持；注入与识别两链路经 `resolveVisionSupport` 统一消费。〔源：migrations §D8；status §遗留修复批次 Bug B〕 |

## 3. 多模态消息契约

### 3.1 `content` 类型扩展

- `LlmMessage.content` / `llmClient` 消息 content 扩 **`string | ContentPart[]`**（`text` | `image_url` part）；
  SSE 主入口与重试路径均透传数组；全部调用点类型贯通（rewrite / skillLoader 保持纯文本零改动）。
  〔源：batch-changes §B6；batch-records §B6；`src/main/ai/llm/llmClient.ts`〕
- `resolveContentForWire` 发送前把本地图片路径读成 data URL；**坏路径降级占位文本 part，绝不发破请求**；
  事件回放 `sanitizeEventPayload` 双净化（data URL→占位、绝对路径→相对路径），回放不落 base64。
  〔源：batch-records §B6；`llmClient.ts` §resolveContentForWire〕

### 3.2 两套协议出口层分流

- **收口 `resolveModelProtocol`**：显式 `ai_config.protocol` 优先（既有 6 处范式不变），缺省按
  `isAnthropicModel` 回退。〔源：batch-records §B6；`src/main/ai/llm/anthropicCompat.ts` §resolveModelProtocol〕
- **Anthropic 出口**：`text` / `image` block——data URL → `source: base64`、http(s) → `source: url`；
  异常形态（空 url 等）→ **显式占位文本 block，不静默丢图**。〔源：`anthropicCompat.ts` §toAnthropicContent；batch-records §B6〕
- **OpenAI 出口**：`image_url.url`（data URL 形态）。**设计稿写的 `image_url.detail` 字段未落地**
  ——以现状为准，仅记录差异。〔源：`llmClient.ts` §ContentPart 对照 batch-changes §B6（五-1 设计稿）〕

### 3.3 上下文压缩丢图（Q4，决策出处 req §2）

- `KEEP_RECENT_IMAGES = 3`：压缩保留**最近 3 张**图片 part，更早图片原位降级
  `IMAGE_DEGRADED_PLACEHOLDER`（**显式提示**，不无声消失）；`summarizeViaLlm` 压缩输入剥图
  （非 vision 模型压缩不再失败）。〔源：`src/main/ai/contextManager.ts` §KEEP_RECENT_IMAGES；batch-records §B6；req §2 Q4〕

### 3.4 图片落盘与相对路径

- 落盘目录 **`userData/attachments/{userId}/{conversationId}/{id}.{ext}`**；消息 `attachments_json`
  **存相对路径**（`attachments/...` 正斜杠前缀），读取时 `resolveStoredPath` 重建绝对路径
  （userData 迁移不失效）；落盘在发送链路主进程 `persistIncomingAttachments` 完成，**不新增 IPC 通道**。
  〔源：batch-changes §B6；batch-records §B6；`src/main/ai/image/imageStorage.ts`〕
- 删除会话 / 删除附件同步清理落盘文件（见 §7）。

### 3.5 格式边界

- **单图 10MB**（`MAX_IMAGE_BYTES`）超限拒绝并提示；**svg 三重拒绝**（dialog 过滤 + composer 入口 +
  存储层）；**gif 原样存储 + 首帧处理提示**；**bmp 经 nativeImage 栅格化为 png**（转码失败明确拒绝）；
  白名单 `png/jpg/jpeg/gif/webp/bmp`（`IMAGE_UPLOAD_EXTS` 与 `ALLOWED_IMAGE_EXTS` 对齐）；
  失败原因经 `IAttachmentMeta.error` 上屏。〔源：batch-changes §B6；batch-records §B6；`imageStorage.ts` §常量；`src/shared/ai/document.ts` §IMAGE_UPLOAD_EXTS〕

### 3.6 vision 能力判定与降级（Bug B）

- **`resolveVisionSupport(model, visionOverride)` 三调用点统一**：注入链（`agentContext`、`chatHandlers`）
  与识别链（`imageRecognition`）同源消费。〔源：status §遗留修复批次 Bug B；`src/main/ai/llm/modelDiscovery.ts` §resolveVisionSupport〕
- **能力表扩展 + 未知模型乐观注入**：已知能力表补 vision 正表与非 vision 显式负表；未知模型
  **默认乐观注入**（`vision_override` 三态可强制覆盖，见 §2 D8）。〔源：status §遗留修复批次 Bug B〕
- **降级显式上屏**：注入链 → 不注入图片 + `VISION_DEGRADED_NOTICE`；识别链 → 不发请求直接标失败；
  降级经 `IAttachmentMeta.error` 上屏（识别链回执/消息 + 注入链 appendMessage 前补写失败态），
  **非仅 console.warn**。〔源：status §遗留修复批次 Bug B；batch-records §B6〕

## 4. 附件清单注入与意图路由（Bug A）

- **A-1 附件清单注入 system 段**（`buildAttachmentManifest`）：每条
  `- {name} | 路径: {绝对路径}（文件）/ 图片附件提示（图片） | 附件 id: {id} | 状态: {parseStatus} | 提示: {error}`，
  附检索指引（附件正文优先 `searchDocument`/`readPage`/`extractTable`/`analyzeChart` 按 file_name 或附件 id 检索；
  原始文件按上方路径 `readLocalFile` 读取）；**无附件返回空串不注入**。
  〔源：status §遗留修复批次 Bug A；`src/main/ai/agent/agentPromptBuilder.ts` §buildAttachmentManifest〕
- **A-2 有附件即走 Agent 提示**：`useAgentPrompt = !isChatIntent || needsClarification || hasAttachments`
  ——chat 意图的「不要提及工具」不再锁死 `searchDocument` / `ask_question_card`；
  **纯闲聊（无附件）仍走 `CHAT_SYSTEM_PROMPT`**。〔源：status §遗留修复批次 Bug A；`src/main/ai/agent/agentContext.ts` §useAgentPrompt〕

## 5. 文件树引用模式（B9）

### 5.1 超长 md 发送不整篇内联

- 点文件树里的 md 发会话**只带文件名 + 路径 + 摘要**（`currentFileRef`，全链可选）；
  `buildDocumentContext` 带 ref 走**引用模式**——只注入文件名+路径+规模统计+标题大纲+前 20 行
  （**单行 120 / 总摘录 1200 字符**上限），**正文交 `readLocalFile` 按需读取**；
  无 ref（DB / welcome 文档工具读不到正文）保持旧整篇注入+截断。
  〔源：batch-changes §B9（三-1②）；batch-records §B9〕
- `MentionPreview` 500 字硬截断改「摘要（行/字统计+标题大纲）+ 前 20 行」+「仅预览」提示
  （摘录 4000 字符 / 大纲单条 120 字符上限）。〔源：batch-records §B9〕

### 5.2 `FOLDER_READ` 的 `.md` 过滤是有意为之

- **保持不变**，handler 内加「有意为之」注释**防后人误「修复」**，`docs/modules/08-IPC通信机制.md`
  `folder:read` 行写明决策基线；行为锁定用例防回归。〔源：batch-changes §B9（三-1②）；batch-records §B9〕

### 5.3 `mdImageResolver` 相对路径图片

- 解析基准**恒为 md 所在目录**（非 cwd / userData）；`workspaceRoot` 越界拦截（`../../` / 盘符 / UNC 三形态）
  **先于存在性检查**——工作区外文件真实存在也不读不返回；缺失与 md 移动失效 → `missing` 结构化降级；
  远程 / data URL 静默跳过，svg / 非图片 / `media:` 拒绝。〔源：batch-changes §B9（三-3③）；batch-records §B9；`src/main/ai/files/mdImageResolver.ts`〕
- md 图片经 `buildMdImageContext` 注入当前轮（上限 3 张 = Q4 口径、vision 不支持 degraded 走
  `VISION_DEGRADED_NOTICE`）；`imageIndexer`/`images_vec` 图片向量**不动**（范围外）。
  〔源：batch-records §B9〕

## 6. 发送上限与截断（R6）

- `MAX_ATTACHMENTS_PER_MESSAGE = 20` 抽到 **shared 单一来源**（`src/shared/ai/document.ts`）；
  **渲染层发送前 `slice(0, 20)`**（占位符文本与载荷同口径），主进程 `sanitizeIncomingAttachments` 同常量截断
  ——消除「占位符数 ≠ 落库行数」不一致。〔源：status §遗留修复批次 R6；`src/shared/ai/document.ts` §MAX_ATTACHMENTS_PER_MESSAGE；`src/render/components/AIAgent/composer/pasteAttachment.ts` §R6 注释〕
- chips 可视折叠另有 **5 个**上限（`MAX_VISIBLE_ATTACHMENT_CHIPS = 5`，超出折叠「N 个附件」）。
  〔源：batch-changes §B2；`src/render/components/AIAgent/panel/AIPanelComposer.tsx` §MAX_VISIBLE_ATTACHMENT_CHIPS〕

## 7. 删除级联（R7 / R8）

- **R7 消息级级联**：`deleteMessagesAfter` 收集受影响 `attachments_json` 逐 id `removeParsedAttachment`
  （**KB 行 + 落盘图片一并清**）；裁定**不做** chip 独立删除。〔源：status §遗留修复批次 R7 及裁定结果〕
- **R8 会话删除级联**：先 `listParsedAttachmentsByConversation` 取 id 列表 → 再删会话行 → 逐 id 级联
  （`removeParsedAttachment` 自带 KB/图片清理），`deleteConversationImages` 保留作兜底（幂等）。
  〔源：status §遗留修复批次 R8〕

## 8. 回执与打开路径（R4 / R5）

- **R4 回执**：AGENT_RUN 回执对图片项 `resolveStoredPath` 转**绝对路径**（`toImgSrc` → `media://`，
  否则相对路径被浏览器按页面相对 URL 解析 → 404）；**落库仍存相对路径**（`toRelativePath` 归一，不受影响）。
  〔源：status §遗留修复批次 R4〕
- **R5 打开路径**：`attachment:open-source` 先按 `isRelativeAttachmentPath` 判定再 `resolveStoredPath`
  重建相对路径；扩展名**两档放行**——7 格式文档走 `isSupportedDocFile`、图片扩展（`IMAGE_UPLOAD_EXTS`）
  单独放行；**`.exe` / `svg` 仍拒**，绝对路径与扩展名白名单双校验不削弱。
  〔源：status §遗留修复批次 R5〕

## 9. 常量口径（以现状落地值为准）

| 常量 | 值 | 位置 |
|---|---|---|
| `CONTEXT_WINDOW` | `64_000` | `src/main/ai/agent/agentHelpers.ts` |
| `MAX_ATTACHMENTS_PER_MESSAGE` | `20` | `src/shared/ai/document.ts` |
| `MAX_VISIBLE_ATTACHMENT_CHIPS` | `5` | `AIPanelComposer.tsx` |
| `KEEP_RECENT_IMAGES` | `3` | `src/main/ai/contextManager.ts` |
| `MAX_IMAGE_BYTES` | `10 * 1024 * 1024`（10MB） | `src/main/ai/image/imageStorage.ts` |
| `IMAGE_UPLOAD_EXTS` | `png/jpg/jpeg/gif/webp/bmp` | `src/shared/ai/document.ts` |
| `upload_kb_default` | `DEFAULT 1`（默认勾选） | `src/main/db/index.ts` |

> 数值口径说明：设计稿「压缩保最近 N 张（建议 3）」「并发上限」等未定值一律以落地值为准；
> 「parse_status 三态」为渲染口径（列值四态，见 §1.2）；「`image_url.detail`」设计稿有、落地无（见 §3.2）。

## 10. 遗留与待判断项

- **vision 覆盖无设置页 UI**：裁定枚举未含 UI，`AI_GET/SET_CONFIG.visionOverride` 通道可读写。
  〔源：status §遗留修复批次 裁定结果 3〕
- **识别调用同步阻塞发送**（多图串行、单次 60s 超时，异步三态留后续）；Skill 链路 content 已贯通但
  输入无附件来源故不注入。〔源：batch-records §B6 遗留〕
- **md 图片不持久化**到消息表 / 回放；越界判定大小写敏感（fail-safe 方向）。
  〔源：batch-records §B9 遗留〕
- **`readLocalFile` 无分块**：>1MB 的 md 引用模式读不到全文（依赖解析侧后续）。
  〔源：batch-records §B9 遗留〕

## 11. 与需求文档的分工（去重说明）

- **需求侧唯一出处（本文不复制）**：29 任务清单（req §1 模块一 4 任务、五 3 任务、三-1/三-3）、
  Q1~Q4 执行级处置（req §2，本文只引决策出处并写落地行为）、验收标准与质量门禁（req §3）。
- **本文独有**：一物两表字段级契约、迁移列语义、content 数组与双协议出口行为、压缩丢图/落盘/格式边界、
  附件清单注入与意图路由条件、文件树引用模式、删除级联与回执路径——即「实现级 as-built 行为契约」，
  任务码（一-4、五、三、B3/B6/B9、remedial）仅作回溯锚点。
