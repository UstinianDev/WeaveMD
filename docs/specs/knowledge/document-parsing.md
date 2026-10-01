# 文档解析层规格（Document Parsing）

> 规范编号：SPEC-DOC-PARSE | 版本：v1.0 | 更新：2026-10-01
> 关联需求：[doc-pipeline 需求](../../requirements/doc-pipeline.req.md)（8 模块 29 任务：二 文档解析层、四-3 批量导入）
> 关联文档：[kb-indexing-egress.md](./kb-indexing-egress.md)（索引 → 检索 → 外发，本链路下游）、
> [attachments-multimodal.md](./attachments-multimodal.md)（附件持久化与多模态）、
> [knowledge.md](../../architecture/knowledge.md)、[ai-agent.md](../../architecture/ai-agent.md)
>
> **性质**：交付契约提炼——`docs/plan/doc-pipeline.*` 系列（后续整体删除）中文档解析层规格的固化快照。
> 每条事实标注来源（文件 §章节）。
>
> **链路定位**：`parseDocument`（本文）→ `indexImportedText` / 附件入 KB → `searchKB` → egress 外发闸。
> 与同目录 [kb-indexing-egress.md](./kb-indexing-egress.md) 构成 `parseDocument → indexImported → searchKB → egress`
> 完整数据链路。
>
> **边界（与既有文档的去重）**：
> - 29 任务清单、Q1~Q6 决策与验收门禁归 [需求文档](../../requirements/doc-pipeline.req.md)（本文任务码仅作追溯锚点）；
> - 附件表结构、多模态消息契约、文件树引用模式归 [attachments-multimodal.md](./attachments-multimodal.md)；
> - 分块消费契约（整表独立 chunk / headingPath）与列级 DDL 归 [kb-indexing-egress.md](./kb-indexing-egress.md)。

**来源缩写**（行内 `〔源：xx §yy〕` 按下表展开为相对链接 + 章节）：

| 缩写 | 文件 |
|---|---|
| batch-changes | `docs/plan/doc-pipeline.plan/01-batch-changes.md` |
| migrations | `docs/plan/doc-pipeline.plan/02-data-migrations.md` |
| batch-records | `docs/plan/doc-pipeline.status/01-batch-records.md` |
| status | `docs/plan/doc-pipeline.status.md` |
| poc | [research/doc-pipeline-docling-poc.md](../../research/doc-pipeline-docling-poc.md) |
| res-parse / res-chunk | [research/doc-pipeline-parse.md](../../research/doc-pipeline-parse.md) / [research/doc-pipeline-chunking.md](../../research/doc-pipeline-chunking.md) |
| req | [requirements/doc-pipeline.req.md](../../requirements/doc-pipeline.req.md) |

---

## 1. 支持格式与白名单

- **7 格式白名单**：`.md` / `.txt` / `.pdf` / `.doc` / `.docx` / `.xls` / `.xlsx`，大小写不敏感；
  **`xlsm`/`xlsb` 不在清单内、不做扩格式**。渲染/主进程共用 `SUPPORTED_DOC_EXTENSIONS`
  与 `documentParser.SUPPORTED_TYPES` 两侧口径一致。〔源：batch-changes §B1；`src/shared/ai/document.ts`〕
- **入口校验**：`isSupportedDocFile` 供上传 / IPC 入口白名单校验；`isSupportedDocument` **取「接线」**
  （接进 `KB_PARSE_DOCUMENT`，非删除）。〔源：batch-changes §B1；batch-records §B1〕
- **白名单外文件**：`parseDocument` 返回 `Unsupported file type` 错误产物（`error` 字段），不抛异常。
  〔源：`src/main/ai/files/documentParser.ts` §parseDocument〕
- **`.doc` 降级（决策出处 req §2 Q3，此处只写落地行为）**：
  - 无 `userId`（D 路线不可用）→ **不读文件**，直接返回 `degraded` 降级文案
    「旧版 .doc 格式暂不支持本地解析……模型不支持视觉能力时请另存为 .docx 后重试」；
  - 有 `userId` → **D 路线优先**（`pageCount=0`：渲染前页数未知 → 全渲染后按上限截断），
    渲染/识读失败或异常 → 同降级文案。〔源：batch-changes §B1（Q3）；batch-records §B7；`documentParser.ts` §parseDocument〕

## 2. `parseDocument` 结构化产物契约

### 2.1 `IDocumentParseResult` 字段

| 字段 | 语义 |
|---|---|
| `text` / `fileName` / `fileType` | 正文、原始文件名、短类型（pdf/docx/doc/xls/xlsx/md/txt） |
| `pageCount?` | 页数（PDF 版面与 D 路线产物给；xlsx/md/txt/docx 不给） |
| `error?` | 失败原因（读取失败 / 不支持类型 / 解析异常，**返回错误产物而非抛异常**） |
| `headings[]` | `{text, level(1-6), path}`——`path` 为祖先标题路径（不含自身） |
| `sections[]` | `{title, path}`——含自身的完整章节链路（溯源用） |
| `tables[]` | `{index(1 起全局), markdown, csv?, sectionPath, pageIndex?}`——**Markdown + CSV 两态** |
| `images[]` | `{index(1 起全局), sectionPath, pageIndex?}`——图片/图表锚点（`analyzeChart` 定位用） |
| `parseVersion` | 产物契约版本（见 §2.2） |
| `pageOffsets?` | 各页 `text` 起始偏移：`pageOffsets[i] = 第 i+1 页在 text 中的起点`（真实页码溯源） |
| `metadata?` | 版面元数据：`headersFooters`（跨页重复剔除的页眉页脚原文，去重） |
| `dRoute?` | D 路线轨迹：`triggered / used / reasons / pagesRendered / estimatedTokens / truncatedPages` |
| `degraded?` | 降级提示（如 `.doc` 另存为 docx、D 路线降级原因） |

〔源：batch-changes §B1（二-6 契约）、§B7；`src/shared/ai/document.ts` §IDocumentParseResult〕

### 2.2 `parseVersion` 溯源契约

- `DOCUMENT_PARSE_VERSION = 2`：**v1** = B1 结构化产物（headings/sections/tables/pageCount）；
  **v2** = B7 版面细项补全（pageOffsets 真实页码 / metadata 页眉页脚 / table.csv 两态 / dRoute 轨迹）。
  〔源：`src/shared/ai/document.ts` §DOCUMENT_PARSE_VERSION；batch-records §B7〕
- `parseVersion` 随 `KB_PARSE_DOCUMENT` 透传到 IPC/类型/mock 三端，并随附件落
  `parsed_attachments.parse_version`，作为**回填重建依据**（契约升级后可识别旧产物并重建）。
  〔源：batch-changes §B1（二-6①）、§B7；migrations §D2〕

### 2.3 跨进程结构 `IDocumentStructure`

- 由 `extractStructure` 从产物提取：**去掉 `text` 正文**，只保留 `pageCount / pageOffsets / sections /
  tables(index·sectionPath·pageIndex·csv) / images / metadata / parseVersion`——一物两表的「结构侧」，
  经附件载荷落 `parsed_attachments.structure_json`。〔源：`src/shared/ai/document.ts` §extractStructure；batch-records §B7〕
- 主进程侧 `sanitizeStructure` **白名单校验后落库**；`IDocumentStructure.images` 为 B8 可选字段，
  历史行无该字段向后兼容。〔源：batch-records §B7、§B8〕

## 3. 分格式解析规则

### 3.1 xls / xlsx（SheetJS）

- **多 sheet 全转**：遍历 `wb.SheetNames`，每个 sheet 名作二级标题章节（`## {sheetName}`）。
  〔源：batch-changes §B1；`documentParser.ts` §parseXlsx〕
- **合并单元格**：自读 `ws["!merges"]` 还原——左上角值铺满合并区并清除覆盖格陈旧残留值（防行列错位）。
  SheetJS 的 `sheet_to_json` / `sheet_to_csv` **不支持合并区间且会原样输出 covered cells**，
  行列还原必须自己读后处理。〔源：res-parse §3（merges）；`documentParser.ts` §sheetToMarkdown〕
- **公式**：`XLSX.read(..., { cellFormula: true })` 保留公式串，展示取 `v` 字段（**文件内缓存的计算值**）；
  SheetJS **不计算公式**（计算器属 Pro）。〔源：res-parse §3（formulae）；batch-changes §B1〕
- **空单元格不错位**：`sheet_to_json({ header: 1, defval: '', raw: true, blankrows: true })` 取 AOA，
  再**归一列宽**（每行不足处补 `''`）；合并处理完成后再剔除全空行（保持合并区行号对齐）。
  〔源：batch-records §B1；`documentParser.ts` §sheetToMarkdown〕
- 每 sheet 产出 **Markdown + CSV 两态**（`builder.addTable(markdown, { csv })`）。
  〔源：`documentParser.ts` §parseXlsx；batch-changes §B7（二-6② 两态口径）〕
- 依赖 SheetJS 社区版 `xlsx`（动态 `import()`，与 `parseDocx` 同写法）。〔源：batch-changes §B1〕

### 3.2 md / txt

- `parseStructuredText`：md 抽标题层级（`#{1,6}`）、章节路径、表格序号——**围栏代码块内跳过**；
  表格块 = 起始行 + 紧随分隔行，连续收集至非表格行；txt 只保留正文（无结构）。
  〔源：`documentParser.ts` §parseStructuredText〕

### 3.3 docx

- mammoth `convertToHtml`（**结构保留**：标题/列表/表格/图片）+ cheerio 单次文档序遍历
  （`h1..h6, p, table, ul, ol, blockquote, img`）填充结构产物。
  〔源：`documentParser.ts` §parseDocx；res-parse §2（`extractRawText` 会完全丢弃结构，故不采用）〕

### 3.4 pdf

- liteparse `textItems`（x/y/width/height/fontSize 坐标）→ `analyzePdfLayout` → 结构化产物
  （pageOffsets 分页溯源）。〔源：batch-records §B7〕

## 4. PDF 版面算法（`pdfLayout.ts`，纯函数、零 native 依赖）

- **分栏**：(X,Y) 坐标聚类——coverage-gutter 切分、全宽行 band 分隔，阅读顺序**先左栏后右栏**。
  〔源：batch-changes §B7；batch-records §B7〕
- **标题层级**：字号相对字符权重 10% 基准 → 层级 1-6。〔源：batch-records §B7〕
- **无框线表**：按列 x-start 对齐还原行列，**填充率判据**防双栏散文误判；产物 Markdown + CSV 两态。
  〔源：batch-changes §B7；batch-records §B7〕
- **跨页表合并**：页末表 + 次页页首对齐行吸收、**重复表头丢弃**、全局保留首表表头。
  〔源：batch-changes §B7；batch-records §B7〕
- **页眉页脚**：跨页重复文本剔除（顶/底带 + 数字归一化）入 `metadata.headersFooters`；
  **单页独有的文本不剔**（跨页语义）。〔源：batch-changes §B7；batch-records §B7 遗留〕
- **无文本层检测**：字符数 / 页面积比**双低判定** → `no-text-layer` 信号（命中短路转 D 路线）。
  〔源：batch-changes §B7；batch-records §B7〕
- 对外信号：`columnDetectFailed` / `tableConfidence`（阈值 `TABLE_CONFIDENCE_THRESHOLD = 0.6`）
  供 D 路线触发判定。〔源：batch-records §B7；`src/main/ai/files/pdfLayout.ts` §shouldUseDRoute〕

## 5. D 路线契约（`multimodalParse.ts`，远程多模态兜底）

- **显式三信号触发** `shouldUseDRoute`：`no-text-layer` / `column-detect-failed` /
  `low-table-confidence`——**正常文档不烧 token**，无信号不触发。〔源：batch-changes §B7；`pdfLayout.ts` §shouldUseDRoute〕
- **常量**：`MAX_D_ROUTE_PAGES = 10`（页数上限截断，**截断显式提示**）、`D_ROUTE_CONCURRENCY = 2`（有界并发）。
  〔源：`src/main/ai/files/multimodalParse.ts` §常量；batch-records §B7〕
- **降级四态**（原因显式上屏）：`no-config` / `no-vision` / `render-failed` / `llm-failed`——
  **任一环节失败整体降级**回 A 路线纯文本 + 显式提示，**绝不产出残缺 D 文本**；
  模型不支持 vision → **零请求**降级（含模型名的显式提示，不静默出垃圾结果）。
  〔源：batch-changes §B7；batch-records §B7；`multimodalParse.ts` §runDRoute〕
- **提示词**：`D_ROUTE_SYSTEM_PROMPT` 强制输出管道表格 / 结构化数据、禁评论感想。
  〔源：batch-changes §B7（二-4②）；`multimodalParse.ts` §D_ROUTE_SYSTEM_PROMPT〕
- **计价**：`estimateDRouteTokens` 复用多模态链路 `estimateImageTokens`，调用后 `recordUsage` 图片归因。
  〔源：batch-records §B7、§B6〕
- **可观测**：触发 / 使用 / 原因 / 渲染页数 / 估算 token / 截断页数落产物 `dRoute` 字段；
  发送链路空文本 `degraded` 随 `IAttachmentMeta.error` 上屏（无文本层给用户明确提示）。
  〔源：batch-records §B7；`src/shared/ai/document.ts` §IDocumentDRouteInfo〕

## 6. 溯源契约（真实页码）

- `buildSourceRef` 以 **pageOffsets 二分** → `{fileName, page, offset}` **真实页码**，
  替代原 `1 + floor(approxOffset/60)` 的 **60 字符行号近似**；md/txt 无页码结构保留 `line` 兼容。
  〔源：batch-changes §B7（二-6②）；batch-records §B7；res-chunk §2（近似法误差记录）〕
- `KbIndexOpts.pageOffsets` 贯通**目录导入 / 附件导入 / 单文件导入**三条链路。
  〔源：batch-records §B7〕
- 页码 / 章节 / 表格序号 + `parseVersion` 随产物落 `parsed_attachments.structure_json`（**D7 列**，
  独立幂等迁移、不动已应用迁移）；composer `extractStructure` 随附件载荷透传。
  〔源：batch-changes §B7；batch-records §B7；migrations §D7 说明行〕

## 7. 表格判定与分块边界（GFM 最小判定）

- **GFM 表格最小判定条件**：表格 = 1 行表头 + 1 行分隔行 + 0..n 行数据行；分隔行单元只能是 `-`（可带 `:` 对齐）；
  **表头行单元格数必须等于分隔行，否则整段不被识别为表格**；数据行单元数可以不齐（少补空、多截断）；
  **表格在第一个空行或新块级结构开始处中断**。〔源：res-chunk §1（GFM 规范 Example 201/203/204）〕
- **落地形态**：O(n) 行扫描状态机——「非空含 `|` 行 + 下一行匹配分隔行正则」→ 表格开始；
  之后逐行并入，遇空行或不匹配行结束。判定逻辑须照 GFM（表头/分隔行单元数不等 → 不成表），
  避免把散落 `|` 的段落误判成表。〔源：res-chunk §1 §改法建议 2〕
- **消费方**：`splitNote` 表格区间预扫描 → **整表独立成 chunk 不与正文混切**、超长表按行切片
  **每片重复表头行 + 分隔行**（片间零 overlap）；不变式 = **任意 chunk 不落在表格区间内部**。
  分块侧完整契约见 [kb-indexing-egress.md](./kb-indexing-egress.md) §1。〔源：res-chunk §1 §改法建议 1/4；batch-records §B5〕

## 8. 目录导入与附件入 KB 通道

- **目录导入 `importDirAsKb`**：7 格式白名单（`isSupportedDocFile`）——原 `/\.(md|txt)$/i` 正则扩至 7 格式。
  〔源：batch-changes §B4；batch-records §B4〕
- **解析先行**：**先 `parseDocument`（parseLimiter 限流，默认并发 3）再 `indexImportedText`**，
  **导入路径零文件字节读取**（fs 直读断言锁定）——直接 utf-8 读 pdf 必乱码入库。
  〔源：batch-changes §B4；batch-records §B4；`src/main/ai/files/parseLimiter.ts` §PARSE_MAX_CONCURRENCY〕
- **失败可见**：单文件解析失败 / 抛异常写 `recordImportFailure`（`status='error'` + 原因进
  `IKbImportResult.error`），**不静默跳过、不断批**。〔源：batch-changes §B4；batch-records §B4〕
- **附件入 KB**：`importAttachmentAsKb` 读 `parsed_attachments`（**user_id 归属过滤**）→
  `source_type='attachment'` + `attachment_id` 关联入索引；**不存在的附件不落孤儿行**、
  未解析完成写 error 行；删除附件（`removeParsedAttachment`）→ `removeByAttachment` 清理 KB 行 +
  搜索缓存失效。〔源：batch-records §B4；字段语义见 [kb-indexing-egress.md](./kb-indexing-egress.md) §6 D3〕

## 9. 解析引擎选型裁定

- **A 路线为唯一生产路线**：liteparse（坐标 `textItems` + `screenshot()` 栅格化）+ 自研 `pdfLayout.ts`；
  B7 选型**不引入 `pdfjs-dist`** → 体积门禁零增量。〔源：batch-records §B7 选型记录〕
- **Docling PoC 已裁定关闭（决策出处 req §2 Q6，此处只写判定与红线）**：
  - **转正判定标准**：双栏阅读顺序正确率、表格行列还原准确率**均 ≥95% 且不低于 A 路线**
    （不优于对照即无转正价值）；体积须过双门禁（500MB / 1GB）；工程项（asarUnpack / 签名 / 模型分发）须有可执行结论。
    〔源：poc §3.3〕
  - **实测结论 → 不达标关闭**：docling 表格行列还原 **64.9%**（A 路线 **100%**，跨页表断裂是硬伤）、
    耗时约 **400×** → 按 Q6 关闭本任务，`parseDocument` 主链路与打包配置零改动，主线不受影响。〔源：poc §3.4、§6〕
  - **红线（重启条件）**：模型与 pdfium **零进安装包**；任何「替换 A 路线」决策**必须先重跑体积门禁
    （500MB / 1GB 双口径），未过不得替换**；重启 = 需要真实复杂版面增益时**另立任务**。
    〔源：poc §5、§6；batch-changes §B12〕

## 10. 常量口径（以现状落地值为准）

| 常量 | 值 | 位置 |
|---|---|---|
| `SUPPORTED_DOC_EXTENSIONS` | 7 项（md/txt/pdf/doc/docx/xls/xlsx） | `src/shared/ai/document.ts` |
| `DOCUMENT_PARSE_VERSION` | `2` | `src/shared/ai/document.ts` |
| `PARSE_MAX_CONCURRENCY` | `3` | `src/main/ai/files/parseLimiter.ts` |
| `MAX_D_ROUTE_PAGES` | `10` | `src/main/ai/files/multimodalParse.ts` |
| `D_ROUTE_CONCURRENCY` | `2` | `src/main/ai/files/multimodalParse.ts` |
| `TABLE_CONFIDENCE_THRESHOLD` | `0.6` | `src/main/ai/files/pdfLayout.ts` |

> 数值口径说明：计划稿只写「并发上限」「保留最近 N 张」等未定值处，一律以上表现有落地值为准
> （例：parseLimiter 计划未定数 → 落地 3；D 路线上限/并发 → 落地 10/2）。

## 11. 遗留与待判断项

- **D 路线逐页独立识读**：D 产物不合并页间跨页表（A 路线有完整跨页合并）——已知限制，如实记录。〔源：batch-records §B7 遗留〕
- **超宽表转行列结构化文本**：计划 B1 提出，现有 `parseXlsx` 未见转置实现（只归一列宽 + 全宽表）——待判断是否仍需。〔源：batch-changes §B1 对照 `documentParser.ts` §parseXlsx〕
- **Docling 重启**：列入范围外清单，重启须另立任务并先重跑体积门禁。〔源：poc §6；status 进度总览（二-5 关闭）〕
- **`xlsm`/`xlsb`**：范围外，长期不做（决策基线条目）。〔源：batch-changes §B1；`src/shared/ai/document.ts`〕

## 12. 与需求文档的分工（去重说明）

- **需求侧唯一出处（本文不复制）**：29 任务清单（req §1 模块二 6 任务 + 四-3）、Q1~Q6 执行级处置（req §2）、
  验收标准与 5 项质量门禁（req §3）、14 条决策基线与 29 任务覆盖核对（req §0.1 / §0.2，全机唯一副本）。
- **本文独有**：字段级产物契约、分格式算法行为、D 路线触发/降级契约、溯源契约、表格判定规则、
  引擎选型裁定的判定标准与重启红线——即「实现级行为契约」，任务码（二-1 ~ 二-6、四-3、B1/B4/B7/B12）
  仅作回溯锚点，不构成清单复制。
