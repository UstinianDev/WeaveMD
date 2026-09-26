# doc-pipeline B5 — TDD 证据报告（strict）

> 创建：2026-09-26 | 批次：**B5（四-1 Embedding 接通 + 四-2 heading_path + 三-2 表格 md）** | 强度：strict（RED → 最小实现 GREEN → 重构 → 覆盖率 → 门禁 → 提交）
> 来源：[计划](../plan/doc-pipeline.plan.md) §1/§2-B5/§3-D4/§4.2-B5 / [需求](../requirements/doc-pipeline.req.md)
> 权威需求源：`C:\Users\lenovo\Desktop\优化方向\优化方向.md` §四-1/四-2/三-2（拷问细节② = 验收点）
> 调研依据：`docs/plan/doc-pipeline.research-chunking.md`（表格边界/表头重复/标题统领改法）+ `research-storage.md`（回填策略）

## 1. 测试范围

| 文件 | 类型 | 新增用例 | 覆盖项 |
|------|------|---------|--------|
| `tests/main/ai/vectorBackfill.test.ts` | **新建** | 15 | **resolveEmbedding 判定** 6（provider+key 齐全、无 ai_config、无 apiKeyEnc、解密空/抛、读取异常全降级 null）；**runVectorBackfill** 5（无配置不扫库纯 FTS5、正常回填 Float32 BLOB+`embedding_model` 写回+扫描 `IS NOT ?`、限速分批 batchSize、失败 phase=error 可观测不抛、running 重入防并发）；**防抖与检索可用** 4（pending 可观测→到期执行一次、连续调度合并仅一次、回填 pending/error 期间 searchKB 走 FTS5 正常返回不阻塞） |
| `tests/main/ai/kbIndexer.test.ts` | 扩展 | +10 | **表格边界（三-2②）** 4（整表独立不混正文、表头/分隔单元数不等不识别为表、超长表按行切分每片重复表头+分隔且数据行不丢不重、片间零 overlap 数据行无重复）；**标题统领** 1（标题+多段落 ≤targetSize 合并 1 chunk）；**headingPath（四-2②）** 3（多级 " > " 路径携带到段内每个块、无标题空串降级、超 80 字符截断）；**D4 落库** 2（INSERT 携 `heading_path` 与路径值、无标题写 NULL） |
| `tests/main/ai/kbSearch.test.ts` | 扩展 | +9 | **vectorSearch 模型过滤（四-1②）** 3（携模型 SQL 过滤 `embedding_model = ?`、不携模型不过滤兼容、sqlite-vec prepare 抛错静默降级空 Map）；**searchKB 模型透传** 2（hybrid+queryVector 传当前配置模型、未配置无过滤降级）；**aggregateAndExpand 生效（四-2②）** 4（heading 30% 分数提升生效、headingPath 全空不误触发分数原样、searchKB 候选非空路径 isHeading+headingBoost(+0.1)、历史 NULL 数据不加成） |
| `tests/main/ai/kbHandlers.test.ts` | 扩展 | +6 | **三入口贯通（四-1②）**：KB_IMPORT_FILE 文本导入携 embedding+触发回填、目录导入携 embedding、KB_REINDEX 手动重索引携 embedding、附件入 KB 携 embedding、未配置三入口均 `{}` 纯 FTS5 回归、resolveEmbedding 抛异常降级 `{}` 不断导入 |
| `tests/main/ipcDialogs.test.ts` | 扩展 | +3 | **保存防抖入口（三入口之一）**：1200ms 防抖后 reindexAfterSave 携 `{embedding}` 并触发回填、未配置传 `{}`、连续两次保存合并为一次且末次内容生效 |
| `tests/main/db/kbDao.test.ts` | 扩展 | +3 | **D4 写入方**：insertChunksBatch INSERT 携 `heading_path` 列与值、缺省写 NULL、空串归一 NULL（FakeDatabase 补 `transaction` 方法面） |
| **合计** | | **46** | （= 全量 vitest 3416 − B4 基线 3370） |

## 2. RED（先写失败测试，实际执行）

```
$ npx vitest run tests/main/ai/kbIndexer.test.ts tests/main/db/kbDao.test.ts \
    tests/main/ai/kbSearch.test.ts tests/main/ai/kbHandlers.test.ts \
    tests/main/ipcDialogs.test.ts tests/main/ai/vectorBackfill.test.ts
```

实际输出（2026-09-26 14:09）：

```
 Test Files  6 failed (6)
      Tests  19 failed | 85 passed (104)
```

失败构成（原始输出摘录）：

```
FAIL  vectorBackfill.test — 模块不存在（src/main/ai/knowledge/vectorBackfill.ts 未创建，引用即失败）
FAIL  kbIndexer.test > 表格边界（整表独立 / 超长表带表头 / 零 overlap）
      — 旧 splitNote 无表格边界概念：len≤target 单块混切、字符窗口直接切断表格中部
FAIL  kbIndexer.test > headingPath 携带 3 条 + D4 落库 2 条
      — NoteChunk 无 headingPath 字段；INSERT INTO kb_chunks 无 heading_path 列
FAIL  kbSearch.test > vectorSearch 携模型过滤 / searchKB 模型透传
      — vectorSearch 无 embeddingModel 参数，SQL 不含 embedding_model 过滤
FAIL  kbHandlers.test > 三入口 embedding 贯通 4 条
      — kbIndexOpts() 恒返回 {}（摆设根因），indexImportedText/indexFile 收到空 opts
FAIL  ipcDialogs.test > FILE_SAVE 携配置 / 防抖合并 2 条
      — scheduleReindexAfterSave 硬编码传 {}（ipc-handlers.ts:69 卡点）
FAIL  kbDao.test > heading_path 写入 3 条
      — insertChunksBatch 无 heading_path 列（args[5] undefined）
```

RED 即通过的 85 条 = 存量回归断言 + 新测试中的守护用例（表头/分隔单元数不等不触发表格切分、未配置三入口传 `{}`、resolve 异常降级——旧实现本就满足，防 GREEN 后回归）。

## 3. 最小实现 → GREEN（实际执行）

实现顺序：**vectorBackfill.ts 新建**（resolveEmbedding 单点判定 + pending→running→done|error 状态机 + 2s 防抖 + 分批限速 300ms）→ **kbHandlers.ts**（`kbIndexOpts(userId)` 改读 `resolveEmbedding`、四调用点贯通、三入口 `scheduleVectorBackfill` 触发）→ **ipc-handlers.ts**（保存防抖改传 `kbIndexOpts(userId)` + 回填触发）→ **db/kb.ts**（insertChunk/insertChunksBatch 写 `heading_path`、空串归一 NULL）→ **kbIndexer.ts**（NoteChunk 扩 `headingPath`；splitNote 重写为「结构单元扫描（GFM 表格判定 + header stack）→ 贪心合并 → 表格原子/超长行切片带表头」；writeChunks 传路径）→ **kbSearchFts.ts**（vectorSearch 加 `embeddingModel` 参数化过滤 + 降级保持）→ **kbSearch.ts**（searchKB 读当前配置模型透传）。

```
$ npx vitest run <同上 6 文件>
 Test Files  6 passed (6)
      Tests  119 passed (119)

$ npx vitest run                       # 全量
 Test Files  146 passed (146)
      Tests  3416 passed (3416)        # B4 基线 3370 + 46
```

GREEN 期修复 5 条（实现正确、测试面精度问题）：vectorBackfill 测试补 `vi.clearAllMocks()`（not.toHaveBeenCalled 需清历史调用）、kbIndexer D4 断言改查全部 INSERT（首个 chunk 是上级标题路径）、ipcDialogs `updateFileContent` mock 改签名实现（返回传入 content 而非固定值）。

## 4. 重构（不改行为）

1. **splitNote 结构化**：`findBreakpoint` 的 `HEADING_SEP` 提升为模块常量（消除每次调用重建数组）；标题主断点职责移交结构扫描，兜底函数保留 `---` 断点与 overlap 语义。
2. **scanUnits 闭包修正**：`openUnit` 改为返回 `StructuralUnit` 并在调用点直接赋值（消除 TS 对闭包内赋值的 never narrowing；行为不变）。
3. **表格片偏移**：flushPiece 偏移取片内首个数据行原文位置（表头/分隔为复制行），保证 approxOffset 单调递增。
4. 重构后目标 6 文件 119 passed 复测通过；全量 3416 passed。

## 5. 覆盖率（新增代码）

```
$ npx vitest run --coverage \
    --coverage.include='src/main/ai/knowledge/vectorBackfill.ts' \
    --coverage.include='src/main/ai/knowledge/kbIndexer.ts' \
    --coverage.include='src/main/ai/knowledge/kbSearchFts.ts' \
    --coverage.include='src/main/ai/knowledge/kbSearch.ts' \
    --coverage.include='src/main/ai/ipc/kbHandlers.ts' \
    --coverage.include='src/main/db/kb.ts' \
    --coverage.reporter=text tests/main/ai/kbIndexer.test.ts tests/main/ai/kbSearch.test.ts \
    tests/main/ai/kbHandlers.test.ts tests/main/ai/vectorBackfill.test.ts \
    tests/main/ipcDialogs.test.ts tests/main/db/kbDao.test.ts
```

实际输出（2026-09-26）：

```
File               | % Stmts | % Branch | % Funcs | % Lines
All files          |   82.93 |    77.55 |   87.67 |   82.93
 vectorBackfill.ts |   98.31 |    87.27 |     100 |   98.31   ← 新建文件
 kbIndexer.ts      |   92.74 |     82.2 |     100 |   92.74   ← splitNote 重写区全覆
 kbSearchFts.ts    |   95.36 |    74.19 |     100 |   95.36
 kbSearch.ts       |   77.27 |    64.77 |      75 |   77.27
 kbHandlers.ts     |   64.78 |    77.77 |     100 |   64.78
 kb.ts             |   79.22 |    80.43 |   68.18 |   79.22
```

- **新增代码全部覆盖**：vectorBackfill（新建）98.3%（未覆盖 139 行 = `delay(ms≤0)` 短路、215-217 = `maxBatches` 耗尽边界，均有守卫测试非必达路径）；kbIndexer 92.7%（未覆盖 561-568 为 `recordImportFailure`/`removeBy*` 既有块，splitNote/scanUnits/emitUnit 新增语句 0 未覆盖）；kbSearchFts 95.4%（未覆盖为 titleMatchSearch/rankCandidates 既有行）。
- kbSearch.ts 未覆盖 614-645/767-779 为既有 vecDocRows 合并与 searchKBCompat 区；**本批次新增的 getEmbeddingConfig 透传段被 2 条透传用例命中**。
- kbHandlers.ts 未覆盖 240-254/375-376 为 KB_PARSE_DOCUMENT/KB_SET_SETTINGS 等既有 handler（本批次改动的 kbIndexOpts 与全部入口已覆）。
- **口径说明**：同 B1~B4——vitest v8 在 tests fail 时不落报告，全量+覆盖率含 `cacheMonitor` 性能用例负载 flaky（§6），故覆盖率证据取 B5 相关子集（全过 → 报告产出），按「新增代码 ≥80%」验收。

## 6. 质量门禁（全部实测）

| 门禁 | 命令 | 结果 |
|------|------|------|
| 类型检查 | `npx tsc --noEmit` | **exit 0，零错误**（TS strict；首轮 9 错已修：闭包 narrowing×2、FakeDb 断言×5、mock 签名×2） |
| 单元测试 | `npx vitest run` | **146 文件 / 3416 passed / 0 failed**（exit 0，收尾实测；B4 基线 3370 + 本批次 46） |
| Lint | `npm run lint` | **0 errors, 108 warnings**（与 B1~B4 基线完全一致的存量 warning） |
| 构建 | `npx vite build` | **exit 0**（renderer + main + preload 三段全过） |
| E2E | `npx playwright test` | **31 failed / 1 skipped / 101 passed（133 条）**——failed 按 spec 构成与基线逐条同名单（ai-agent-panel 4 / drag 5 / table 7 / feedback 5 / float-toolbar 2 / thematic 2 / exit 2 / editor 1 / image-resize 1 / recent-history 1 / welcome 1），**零新增失败** |

**过程 flaky 记录（如实）**：存量性能断言 `tests/main/ai/cacheMonitor.test.ts > getStats 10 万次 < 50ms` 在全量负载下超阈 1 次（同 B4 记录的同一问题，B5 未触及 cacheMonitor 代码路径），单独重跑 **37 passed**，收尾全量 **146 文件 3416 passed 全绿**。

**E2E 基线对照**：基线 31 failed 存量已裁定（前序批次），B5 未新增/删除任何 e2e spec；两次运行失败 spec 构成与基线名单一致。

## 7. 四-1② 三入口贯通验证（专项）

| 入口 | 代码路径 | 验证用例 |
|------|---------|---------|
| 保存防抖 | `FILE_SAVE` → `scheduleReindexAfterSave`（1200ms）→ `reindexAfterSave(userId, file, kbIndexOpts(userId))` | ipcDialogs「防抖 1200ms 后重索引携带真实 embedding 配置并触发回填」+「未配置传 `{}`」+「连续两次保存合并」 |
| 手动重索引 | `KB_REINDEX` → `reindexFromKbOrFile` → `indexFile(..., kbIndexOpts(userId))` | kbHandlers「手动重索引 → indexFile 收到 embedding 配置」 |
| 目录导入 | `KB_IMPORT_DIR` → `importDirAsKb` → `indexImportedText(..., kbIndexOpts(userId))` | kbHandlers「目录导入 → indexImportedText 收到 embedding 配置」 |
| （+文本/附件导入） | `KB_IMPORT_FILE` 文本与 attachmentId 分支 | kbHandlers 各 1 条 |

- 每个索引入口完成后调 `scheduleVectorBackfill(userId)`（历史缺口回填触发，2s 防抖合并）。
- `resolveEmbedding` 任一环节失败 → `kbIndexOpts` 返回 `{}` → writeChunks 跳过向量分支（纯 FTS5 约定不破坏，`docs/architecture/knowledge.md`）。
- 解析异常降级：kbHandlers「resolveEmbedding 解析异常 → 降级 `{}` 不断导入」。

## 8. 偏离与决策记录

1. **kbIndexOpts 留在 kbHandlers.ts 并 export**（计划 §0 行号偏差处已注明函数归属）：`ipc-handlers.ts` 直接 import，避免把配置解析逻辑挪进 kbIndexer 造成 kbIndexer ↔ vectorBackfill 潜在循环依赖。
2. **resolveEmbedding 放 vectorBackfill.ts 作为单点**：kbHandlers（索引选项）与回填任务共用同一判定（KB_STATUS 的 provider/apiKeyEnc 语义），不新建第二个配置解析文件（全局规则：新增文件先说明——本批次仅计划内的 vectorBackfill.ts 一个新文件）。
3. **回填触发点选择**：计划要求「后台回填任务」但未指定触发时机；实现取「三索引入口 + 保存防抖完成后」触发（全部经 `scheduleVectorBackfill` 防抖），**不新增 IPC 通道**（状态为进程内存态 `getVectorBackfillStatus`，可观测性由测试与代码 API 承担；UI 展示需求未在 B5 验收点内，避免 §1.3 三处同步范围外扩散）。
4. **模型切换失效策略双层落地**：检索侧 `vectorSearch` 按当前配置 `embedding_model` 参数化过滤（旧向量不参与、不改数据）；回填侧扫描 `embedding_model IS NOT ?` 渐进重算——两者都有独立测试（四-1②「按 embedding_model 列过滤**或**强制重建」的并集实现）。
5. **headingPath 语义**：块起始处 header stack 路径（含当前标题、不含外部文档标题、80 字符截断），与读侧 `isHeading = !!headingPath` 对齐；空串由 DAO 归一 NULL（历史行/纯文本读侧 NULL 降级现状已具备，D4 无 DDL）。
6. **表格片不带 overlap、每片重复表头+分隔**（research-chunking §2 建议 1/3：表头重复已承担语义衔接，STC overlap-free 结论）；单行超长不切单元格（该行独占一片，仅保证不破坏表头配对，未实现 STC 的按单元格 emergency split——research 标注其为超宽表场景，本期无此样例需求，记录为可选增强）。
7. **headingPath 只入列、不前置进 content**：research §3.2 建议前缀进 content+BM25 双路，但计划把「chunk 上下文前缀取舍」归 **B8 四-4②**（仅向量侧/FTS5 原样的取舍需写明），B5 不越界。
