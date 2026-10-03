# 知识库索引、检索与外发规格（KB Indexing & Egress）

> 规范编号：SPEC-KB-IDX | 版本：v1.0 | 更新：2026-10-01
> 关联需求：[doc-pipeline 需求](../../requirements/doc-pipeline/doc-pipeline.req.md)（8 模块 29 任务：四 知识库/RAG、六 引用溯源、八 外发闸）
> 关联文档：[embedding-architecture.md](./embedding-architecture.md)、[indexing-compatibility.md](./indexing-compatibility.md)（既有设计文档）、
> [knowledge.md](../../architecture/knowledge.md)、[database.md](../../architecture/database.md)、[ai-agent.md](../../architecture/ai-agent.md)、[security.md](../../architecture/security.md)
>
> **性质**：交付契约提炼——`docs/plan/doc-pipeline.*` 系列（后续整体删除）中知识库索引/检索/外发规格的固化快照。
> 每条事实标注来源（文件 §章节）；「生产不可达」「待校准」「遗留」等状态标注**原样保留**。
>
> **边界（与既有文档的去重）**：
> - 列级 DDL 逐列定义归 [database.md](../../architecture/database.md)（§6 只留契约摘要与指向）；
> - `agent_memory` 向量、记忆召回与遗忘机制归 `specs/ai-agent/agent-memory.md`（本文**只收笔记/知识库侧**）；
> - Embedding 抽象层与三模式定义归 [embedding-architecture.md](./embedding-architecture.md)（§7 只收已交付参数与红线）。
> 「来源：」中出现的 `docs/plan/*` 均为**已归档的过程文档**（2026-10-04 精简，正文见 git 历史），此处保留仅作溯源。

---

## 1. 分块契约（`splitNote` 结构化分块 / headingPath）

- **GFM 表格判定**：表头行与分隔行单元数相等 + 未转义管道计数；**表格边界整表独立成 chunk，不与正文混切**。
- **超长表按行切分**：每片**重复表头行 + 分隔行**（Markdown 表头/分隔配对保持）；**片间零 overlap**（数据行不丢不重）；单行超限不切单元格。
- **标题统领合并**：标题 + 其下段落 ≤ targetSize 合并为 1 chunk；超长段保留旧断点 + overlap 兜底语义。
- **headingPath 计算**：`splitNote` 内维护 header stack（遇 `#{1,6} ` 弹栈/入栈），以 `" > "` 连接成路径，**截到当前标题为止、不含文档标题**，**80 字符硬上限截断**；无标题为空串，落库由 DAO **归一为 NULL**，历史行/纯文本读侧按 NULL 降级（D4 无 DDL）。
- **读侧消费**：`aggregateAndExpand` 以 `headingPath` 非空判 `isHeading`，heading 30% 分数提升（+0.1 headingBoost）；全空不误触发、历史 NULL 数据不加成（4 用例验证，防历史回归）。

> 来源：`docs/plan/doc-pipeline.plan/01-batch-changes.md` §B5；`docs/plan/doc-pipeline.status/01-batch-records.md` §B5（三-2 表格分块 / 四-2 heading_path）；`docs/research/doc-pipeline/doc-pipeline-chunking.md` §3（80 字符上限、不含文档标题）；`doc-pipeline-b5.tdd.md` §测试清单。

## 2. `kbIndexOpts` 真实配置贯通 4 个索引入口

- `kbIndexOpts(userId)` 读真实 embedding 配置（`ai_embedding_config` 真实 key 解密，复用 `KB_STATUS` 的 `kbEmbeddingProvider`+`apiKeyEnc` 判定语义）；`resolveEmbedding` 任一环节失败降级 `null` → 纯 FTS5 不破坏。
- 真实配置**必须贯通全部 4 个索引入口**（每入口完成后 `scheduleVectorBackfill(userId)` 触发回填）：
  1. 保存防抖（`scheduleReindexAfterSave`，原硬编码 `{}` 已替换）；
  2. 手动重索引（`KB_REINDEX` → `reindexFromKbOrFile`）；
  3. 目录导入（`importDirAsKb`，另带 `pageOffsets`）；
  4. 文本与附件导入（`KB_IMPORT_FILE` 文本 / 附件 `importAttachmentAsKb`）。
- **漏一条即部分摆设**（四-1 卡点原话）——计划期记录为「3 入口」，交付实测为上述 4 入口，以连通性核对为准。

> 来源：`docs/plan/doc-pipeline.plan/01-batch-changes.md` §B5（3 入口卡点与 `kbIndexOpts` 归属 `kbHandlers.ts` 的偏差记录）；`docs/plan/doc-pipeline.status/01-batch-records.md` §B5「四-1 接通」；`docs/plan/doc-pipeline.connectivity.md` §链路 3（4 入口核对表）。

## 3. 向量回填契约（`vectorBackfill`）

- **节奏**：分批 20 条/批、批间限速 300ms、2s 防抖合并高频调度、`running` 重入保护防并发。
- **失效策略**：扫描 `vector IS NULL OR embedding_model IS NOT ?` → 切模型后旧向量**按 `embedding_model` 渐进重算**；检索侧 `vectorSearch` 加 `embeddingModel` 参数化子句（切模型后旧向量不参与 RRF）。
- **可观测**：状态机 `pending → running → done|error`（对齐 `kb_documents.status` 范式），进程内存态不加 DDL、不新增 IPC；失败收敛 `phase='error'`。
- **降级红线**：回填不经检索链路，**`pending`/`error` 期间 `searchKB` 走 FTS5 正常返回**（测试锁定）；未配置 embedding 直接不扫库；`sqlite-vec` prepare 抛错静默降级纯 FTS5。

> 来源：`docs/plan/doc-pipeline.status/01-batch-records.md` §B5「向量回填任务 / 模型过滤」；`docs/plan/doc-pipeline.plan/01-batch-changes.md` §B5；`docs/plan/doc-pipeline.connectivity.md` §链路 3。

## 4. `headingPath` 前缀策略（B5/B8 四-4②）

- **仅向量侧加前缀**：`chunkEmbeddingText = headingPath + '\n' + text`；**FTS5 content 保持原样**——前缀会把标题文本混入关键词倒排、污染 BM25 召回（源文档点名的风险），故不前置进 `content`。
- 写索引（`writeChunks`）与历史回填（`vectorBackfill` 扫描 SQL 补 `heading_path`）共用 `chunkEmbeddingText`，保证两侧向量空间同构。
- **查询侧不加前缀**（避免查询语义漂移，两侧风格差交由 embedding 模型泛化）——**已知限制，如实记录**。
- 取舍裁定：research 曾建议前缀进 content + BM25 双路，计划将其归 B8 四-4②「上下文前缀取舍写明」，最终裁定只走向量侧。

> 来源：`docs/plan/doc-pipeline.plan/01-batch-changes.md` §B8（四-4② 前缀取舍行）；`docs/plan/doc-pipeline.status/01-batch-records.md` §B8「四-4 检索质量」；`doc-pipeline-b8.tdd.md` §8.5；`doc-pipeline-b5.tdd.md` §headingPath 语义注。

## 5. 引用回链（citation → refsJson，B8 六-2）

- `executeOneTool` 收集 searchKB/searchDocument 引用 → **`collectCitations` / `mergeCitations` 去重封顶 10** → assistant `refsJson` **落库** + **done 事件携带 `refsJson`**（渲染即时展示 + 回放恢复；preload map / agentStore 三处消费同步）。
- `source_ref` 页码来自 B7 `pageOffsets` 二分（替代 60 字符行号近似；md/txt 保留 line 兼容）；附件锚点由 `indexImportedText` 传入。
- 附件引用点击经 IPC `attachment:open-source` 跳原文：服务端按 user_id 反查路径（参数化查询）+ 绝对路径/7 格式白名单双校验（防伪造 `.exe`）。
- `refsJson` 为 JSON 级可选字段（D6，无 DDL）：历史消息无该字段/`null` 正常渲染（组件测试锁定），done 事件缺字段 preload `?? null`。

> 来源：`docs/plan/doc-pipeline.plan/01-batch-changes.md` §B8（六-2）；`docs/plan/doc-pipeline.status/01-batch-records.md` §B8「六-2 citation 回链」；`docs/plan/doc-pipeline.connectivity.md` §链路 4；`docs/plan/doc-pipeline.plan/02-data-migrations.md` §D6。

## 6. 数据列级契约（D3~D6，与 database.md 去重后的摘要）

| # | 列级契约（DDL 逐列定义归 `docs/architecture/database.md`） |
|---|---|
| D3 | `kb_documents` 补 `attachment_id TEXT DEFAULT NULL`（关联 `parsed_attachments.id`）+ `idx_kb_doc_user_attachment` 索引；`source_type` 增取值 **`'attachment'`**（TEXT 取值扩展，零 DDL）；删除附件 → 清理 KB |
| D4 | `kb_chunks.heading_path` **列已建、无 schema 变更**：`splitNote` 输出 `headingPath` → `insertChunksBatch` 写列；**历史 chunk 不强制回填**，读侧 NULL 降级，随保存 reindex 自然补齐 |
| D5 | `ai_config.upload_kb_default INTEGER DEFAULT 1`（「加入知识库」默认勾选，Q2，与「勾选=显式授权」语义自洽） |
| D6 | `refs_json` JSON 级扩展（页码/附件锚点），无 DDL；读写均按可选字段，新旧双向兼容 |

**统一迁移纪律**：只用 `addColumnIfMissing()`（PRAGMA 探测幂等补列）与 `CREATE TABLE/INDEX IF NOT EXISTS`；空库首建 + 旧库升级 + 重复执行**三断言**；**不动已应用历史迁移、禁止 DROP 迁移**。

> 来源：`docs/plan/doc-pipeline.plan/02-data-migrations.md` §统一迁移纪律、§D3~§D6。

## 7. 检索与外发参数（笔记侧，红线不变）

- `searchMode` 三模式 `fts5` / `vector` / `hybrid`（默认 `hybrid`）：**`vector` 模式无 `queryVector` 时不回退 FTS5**（FTS5 路与向量路都不跑，只剩标题匹配，无候选按 0.6 拒答）；`hybrid` 默认但无 `queryVector` → 纯 FTS5+标题。`queryVector` 仅在 `searchKB` 传 `hyde: true` 且已配置 embedding 时生成。
- **知识库三参数红线**：拒答阈值 **0.6**、置顶权重 **×1.5**、threshold/pinnedWeight 配置不变（agent-memory-3 批次 D6 对笔记侧只改文档、零代码触碰）。
- **`filterKbEgressResults` 是外发唯一出口，fail-closed**：笔记永不入列、best 同步收敛；白名单查询失败用空集合兜底；`consent.allowSend` 早返回。
- 附件与笔记**同管线同阈值、无 `source_type` 分支**——附件独立拒答阈值本期只复核记录结论、**不新增配置项**（列入范围外，见 §9）。
- HyDE 收益：B5 前文档侧无向量时 `hyde:true` 为 no-op，B5 接通后路径生效（2 例断言锁定）；**量化 A/B 需真实 embedding+LLM 凭据，无凭据不编造数据——遗留（待校准）**。
- **不碰清单（跨批次红线）**：`kbSearch.ts` 4 条硬编码笔记 SQL、`kbSearchFts.ts` 两处、`sourceType` 枚举、`searchMode` 语义、`filterKbEgressResults`。

> 来源：`agent-memory-optimize-3.plan.md`（已归档，见 git 历史） §6 D6（「笔记侧零影响核验」行、§1「D6 不碰」行、§4 红线行）；`docs/architecture/knowledge.md` §searchMode 表与 §三参数表；`docs/plan/doc-pipeline.connectivity.md` §2 附注；`docs/plan/doc-pipeline.status/01-batch-records.md` §B8「HyDE 收益复核 / 拒答阈值 0.6 复核」；`doc-pipeline-b8.tdd.md` §8.6~§8.7。

## 8. 已知限制（原「生产不可达」判定，R1/R2 已解除 @agent-kb-ux，状态标注原样保留）

| ID | 限制（原判定**生产不可达**，R1/R2 已解除） | 影响 |
|---|---|---|
| R1 | ~~`useKnowledgeBase` 初值 `false`、零调用方~~ **已解除 @agent-kb-ux（2026-10-03）**：热修后初值 `true`、composer 无 UI（默认开启），`toolsForIntent` 四分支生产可达，`searchKB` 检索/citation/外发闸注入矩阵均触发 | 原「恒不触发」失效 |
| R2 | ~~`ConsentOverlay` 触发依赖 R1 死链~~ **已解除 @agent-kb-ux**：三态发送闸 `checkKbEgressGate`（空库/已授权/读取失败 → allow；有文档无授权 → prompt）使 `pendingConsent` 生产可达，`filterKbEgressResults` 随 allowSend=false + 授权行路径**生产执行** | 原「生产不执行」失效 |
| R3（附带） | `searchDocument` 不经 `filterKbEgressResults`，与 `searchKB` 闸形成旁路 | **已修复**（遗留修复批次）：`ToolCtx.attachmentEgressAllowed = allowSend ∨ 该文档勾选授权`（**fail-closed**）；`resolveAttachmentTarget` 双检 = **会话边界 + 外发闸**（文档四工具共闸）；**本会话附件豁免、跨会话恒拒**（8 格矩阵）。工具执行侧契约见 `../ai-agent/agent-tool-runtime.md` §11.2 |

处置口径（2026-10-03 更新）：R1/R2 已随 agent-kb-ux 交付解除（历史处置：属废弃开关不可达、修复批次不在范围）；本表保留历史判定与解除记录。全仓判定依据为静态 grep，未做运行时插桩。

> 来源：`docs/plan/doc-pipeline.connectivity.md` §2 R1~R3、§链路 4/链路 5、§4 方法与局限；`docs/plan/doc-pipeline.status.md` §遗留修复批次（R1/R2 不在本批次）；**R3 修复后契约**另见 `docs/plan/doc-pipeline.remedial.diagnosis.md`（四工具共闸 + 8 格矩阵）。

## 9. 范围外边界（9 项，长期有效）

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

> 来源：`docs/plan/doc-pipeline.plan.md` §5 范围外清单（后续（不阻塞））。

## 10. 遗留与待判断项

- 回填状态无 UI/IPC 展示（B5 验收只要求可观测，测试与 `getVectorBackfillStatus` 承担；设置页展示列后续）。
- 超宽表按单元格 emergency split（STC）未实现——无样例需求，记录为可选增强。
- HyDE 量化 A/B 需真实凭据——**待校准**；拒答阈值附件独立配置——**后续（不阻塞）**（§9）。
- `chatHandlers` 未接 citation 收集（其 IPC 通道当前无渲染层调用方）；附件页内定位无应用内预览（打开交 OS 默认应用）。
- R1~R10 是否修复由需求方裁定；R1/R2 已随 agent-kb-ux 解除（2026-10-03，见 §8 解除记录），其余维持原裁定。

> 来源：`docs/plan/doc-pipeline.status/01-batch-records.md` §B5/§B8 遗留；`docs/plan/doc-pipeline.connectivity.md` §0 总览、§2 风险清单。
