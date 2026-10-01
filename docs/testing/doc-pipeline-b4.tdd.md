# doc-pipeline B4 — TDD 证据报告（strict）

> 创建：2026-09-26 | 批次：**B4（四-3 批量导入通道）** | 强度：strict（RED → 最小实现 GREEN → 重构 → 覆盖率 → 门禁 → 提交）
> 来源：[计划](../specs/knowledge/kb-indexing-egress.md) §1/§2-B4/§3-D3/§4.2-B4 / [需求](../requirements/doc-pipeline.req.md)
> 权威需求源：`C:\Users\lenovo\Desktop\优化方向\优化方向.md` §四-3（拷问细节② = 验收点）

## 1. 测试范围

| 文件 | 类型 | 新增用例 | 覆盖项 |
|------|------|---------|--------|
| `tests/main/ai/kbHandlers.test.ts` | 新建 | 16 | **7 格式目录导入** 6（7 格式全解析+非白名单跳过、**解析先行 pdf 不经 utf-8 读**、失败 `status='error'` 不静默不断批、解析抛异常同记 error、逐文件经 parseLimiter、空路径/目录读失败返回空）；**附件入 KB** 3（`source_type=attachment`+`attachment_id` 贯穿、附件不存在不落孤儿行、未解析完成写 error 行）；**IPC 分派** 7（attachmentId 通道、title/content 回归、缺参拒绝、KB_IMPORT_DIR 逐文件 results、KB_DELETE fileId 回归/docId 分派/双缺参拒绝） |
| `tests/main/ai/kbIndexer.test.ts` | 扩展 | +9 | 附件关联 3（INSERT 携 `source_type+attachment_id`、默认 `import` 回归、indexFile 默认 db/显式 attachment 贯穿）；`recordImportFailure` 3（默认 error 行、attachment 选项带关联、DB 异常不抛）；删除清理 3（`removeByAttachment`/`removeByDocId` 参数化+归属、changes=0 不算成功） |
| `tests/main/db/kbDao.test.ts` | 扩展 | +5 | D3 写入方 5（upsert INSERT 尾列 `attachment_id`+先按关联查找、既有附件行 UPDATE 收敛不产生重复行、get/deleteKbDocumentByAttachment 归属过滤、旧库行缺列映射归一 null） |
| `tests/main/db/migrations.test.ts` | 扩展 | +3 | **D3 迁移三断言**（FakeDb 驱动真实 `addKbAttachmentColumns`）：态1 空库首建（列+索引 DDL 精确）、态2 旧库升级（仅 ALTER/CREATE INDEX、无 DROP/DELETE/UPDATE、`source_type` 零 DDL）、态3 重复执行零 ALTER 幂等 |
| `tests/main/db/attachments.test.ts` | 扩展 | +2 | 删除附件→清理 KB（成功删除调 `removeByAttachment(userId,id)`；changes=0 不触发清理） |
| `tests/main/ai/ipc.test.ts` | 扩展 | +4 | KB_IMPORT_FILE attachmentId（归属过滤+索引参数）、未命中附件 error 且不入索引、KB_DELETE docId/fileId 双路径、双缺参拒绝 |
| `tests/components/knowledgeBaseSettings.test.tsx` | 新建 | 6 | **error 状态红标可见**、file_id 为 NULL 行可删、删除携 docId/fileId+docId 调用、目录导入入口、空列表态 |
| `tests/main/ai/documentParser.test.ts` | 仅 mock 面 | 0 | kbHandlers 新增 import 的 mock 补齐（不删改既有用例） |
| **合计** | | **45** | （= 全量 vitest 3370 − B3 基线 3325；另有 `scripts/kb-attachment-migration-smoke.cjs` 真库四态，见 §6） |

## 2. RED（先写失败测试，实际执行）

```
$ npx vitest run tests/main/ai/kbHandlers.test.ts tests/main/ai/kbIndexer.test.ts \
    tests/main/db/kbDao.test.ts tests/main/db/migrations.test.ts \
    tests/main/db/attachments.test.ts tests/main/ai/ipc.test.ts \
    tests/main/ai/documentParser.test.ts tests/components/knowledgeBaseSettings.test.tsx
```

实际输出（2026-09-26 02:12）：

```
 Test Files  7 failed | 1 passed (8)
      Tests  38 failed | 112 passed (150)
```

失败构成（原始输出摘录）：

```
FAIL  kbHandlers.test > importDirAsKb 7 格式（6 条）
      — 模块未导出 importDirAsKb/importAttachmentAsKb（引用即失败）
FAIL  kbHandlers.test > importAttachmentAsKb（3 条） + IPC 分派（4 条）
      — KB_DELETE 无 docId 分支；KB_IMPORT_FILE 无 attachmentId 通道
FAIL  kbIndexer.test > 附件关联 / recordImportFailure / 删除清理（9 条）
      — recordImportFailure/removeByAttachment/removeByDocId 不存在；
        INSERT 无 attachment_id 列（args[3]/args[7] 断言失败）
FAIL  kbDao.test > attachment_id 关联（5 条）— getKbDocumentByAttachment 等未导出
FAIL  migrations.test > addKbAttachmentColumns 态1/态2/态3（3 条）
      — TypeError: addKbAttachmentColumns is not a function（db/index.ts 未导出）
FAIL  attachments.test > B4 删除成功→清理 KB（1 条）
      — removeParsedAttachment 不触发 removeByAttachment（另一条「未命中不触发」RED 即通过）
FAIL  ipc.test > attachmentId 通道 / KB_DELETE docId（4 条）— 载荷走旧校验路径
FAIL  knowledgeBaseSettings.test > 删除按钮/参数（3 条）
      — fileId 为 NULL 不渲染删除按钮；triggerKbDelete 收到字符串而非对象
```

通过的 112 条为存量兼容项 + 新测试中的回归断言（KB_IMPORT_FILE 文本路径、KB_DELETE fileId 路径、D3 之外的既有迁移断言等，旧实现本就满足）。

## 3. 最小实现 → GREEN（实际执行）

实现顺序：shared 类型（`sourceType` 扩 `'attachment'` / `IKbImportResult.error?` / `KbImportFileRequest`）→ **D3 迁移**（`db/index.ts addKbAttachmentColumns`）→ `db/kb.ts`（`attachment_id` 行映射 + upsert 双键查找 + get/deleteKbDocumentByAttachment）→ `kbIndexer.ts`（`KbIndexOpts.sourceType/attachmentId` 贯穿 indexFile/indexImportedText + `recordImportFailure` + `removeByAttachment/removeByDocId`）→ `kbHandlers.ts`（importDirAsKb 解析先行改造 + `importAttachmentAsKb` + KB_IMPORT_FILE/KB_DELETE 入参分派）→ `attachments.ts`（唯一删除点收口 KB 清理）→ preload/store/UI（删除入口 docId 化）→ 组件测试与 mock 面补齐。

```
$ npx vitest run <同上 8 文件>
 Test Files  8 passed (8)
      Tests  150 passed (150)          # 02:14

$ npx vitest run                       # 全量
 Test Files  145 passed (145)
      Tests  3370 passed (3370)        # 02:35
```

## 4. 重构（不改行为）

1. **KB_IMPORT_FILE 边界判定收敛**：附件分支的 `payload &&` 冗余类型守卫移除（TS 已保证非空；运行期缺载荷仍由 try/catch 兜底），重构后 `kbHandlers.test + ipc.test` 58 passed 复测通过。
2. **实现期结构决策（GREEN 前后一致）**：`stripExtension` 单点去扩展名（目录导入与附件标题共用）；`upsertKbDocument` 查找优先级收敛为 `attachmentId > fileId > 新建行`（附件重试幂等收敛到同一行）；附件删除清理收口在 DAO 唯一删除点（§8.3）。
3. **既有 9 处 mock 面适配**：documentParser/ipc 两文件的 kbIndexer、db/attachments mock 补齐新导出（只加不删，零用例改动）。

## 5. 覆盖率（新增代码）

```
$ npx vitest run --coverage \
    --coverage.include='src/main/ai/ipc/kbHandlers.ts' \
    --coverage.include='src/main/ai/knowledge/kbIndexer.ts' \
    --coverage.include='src/main/db/kb.ts' \
    --coverage.include='src/main/db/attachments.ts' \
    --coverage.include='src/render/components/AIAgent/knowledge/KnowledgeBaseSettings.tsx' \
    --coverage.reporter=text tests/main/ai/kbHandlers.test.ts tests/main/ai/kbIndexer.test.ts \
    tests/main/ai/kbSearch.test.ts tests/main/ai/documentParser.test.ts tests/main/ai/ipc.test.ts \
    tests/main/ipcDialogs.test.ts tests/main/db/kbDao.test.ts tests/main/db/migrations.test.ts \
    tests/main/db/attachments.test.ts tests/components/knowledgeBaseSettings.test.tsx
```

实际输出（2026-09-26）：

```
File               | % Stmts | % Branch | % Funcs | % Lines
All files          |    87.5 |    80.89 |   81.48 |    87.5
 kbHandlers.ts     |   91.78 |    77.61 |     100 |   91.78
 kbIndexer.ts      |   89.75 |    77.77 |     100 |   89.75
 attachments.ts    |   93.54 |    91.66 |   88.88 |   93.54
 kb.ts             |   78.33 |       75 |   68.18 |   78.33
 KnowledgeBaseSettings.tsx | 86.09 |  80.95 |  66.66 |   86.09
```

- **新增代码全部覆盖**：对 `kb.ts` 逐条比对未覆盖语句行，全部落在**既有未测块**（`listKbDocumentsWithChunkCount` 167-202、`mapChunkRow` 265-274、`countChunksByDoc` 346-355、`kb_images` 379-420、`getKbDocumentByFile` 命中行 132-133——FakeDb file_id 查询恒未命中所致）；B4 新增的 upsert 附件分支 / `getKbDocumentByAttachment` / `deleteKbDocumentByAttachment` 语句行 0 未覆盖。
- `kbHandlers.ts` 未覆盖为既有 catch 分支与 KB_PARSE_DOCUMENT 未含于本次子集的行（其 handler 由 `documentParser.test` 覆盖，见 §6 补充运行）；`KnowledgeBaseSettings.tsx` 未覆盖 44-63 为既有 `handleImportFile`（本批次未动），新增删除按钮全分支覆盖。
- **口径说明**：vitest v8 reporter 在 `tests fail` 时默认不落报告（`coverage.reportOnFailure=false`）；全量+覆盖率运行中既有性能用例 `cacheMonitor getStats` 因插桩减速必然超阈（§6 flaky 记录），故覆盖率证据取 B4 相关子集（全部通过 → 报告正常产出），全量覆盖率不作为口径（同 B1~B3「新增代码 ≥80%」口径）。

## 6. 质量门禁（全部实测）

| 门禁 | 命令 | 结果 |
|------|------|------|
| 类型检查 | `npx tsc --noEmit` | **exit 0，零错误**（TS strict） |
| 单元测试 | `npx vitest run` | **145 文件 / 3370 passed / 0 failed**（exit 0，2026-09-26 02:35；B3 基线 3325 + 本批次 45） |
| Lint | `npm run lint` | **0 errors, 108 warnings**（与 B1~B3 基线完全一致的存量 warning） |
| 构建 | `npx vite build` | **exit 0**（renderer + main + preload 三段全过） |
| E2E | `npx playwright test` | **31 failed / 1 skipped / 101 passed（133 条）**——与基线逐条同名单，**零新增失败**（见下方基线对照） |

**过程 flaky 记录（如实）**：存量性能断言 `tests/main/ai/cacheMonitor.test.ts > getStats 10 万次 < 50ms` 在全量负载下多次超阈（实测 62.8~85.7ms；插桩覆盖率运行必现），单独重跑 37 passed；收尾全量运行 **145 文件 3370 passed 全绿**（2026-09-26 03:14 实测，其前一次全量仅该性能用例 1 failed、重跑即绿）。该用例与 B4 改动无代码路径交集（cacheMonitor 不依赖 kb 链路），判定为**负载 flaky 存量问题**，非本批次引入、未修改该测试。

### 数据迁移三断言（§3 统一纪律，双轨验证）

| 断言 | vitest（FakeDb 驱动真实迁移函数） | 真库（`npx electron scripts/kb-attachment-migration-smoke.cjs`） |
|------|------|------|
| 空库首建 | ✅ 态1：列 + `idx_kb_doc_user_attachment` DDL 精确断言 | ✅ 态1：9 列终态、`attachment_id DEFAULT NULL`、索引 1 个 |
| 旧库升级 | ✅ 态2：仅 ALTER/CREATE INDEX、无 DROP/DELETE/UPDATE、`source_type` 零 DDL | ✅ 态2：2 旧行留存，`attachment_id=NULL`、`source_type` 不变 |
| 重复执行 | ✅ 态3：第二遍零 ALTER | ✅ 态3：幂等不抛错、列/索引不重复 |
| 读写闭环 | ✅ DAO/索引 SQL+参数断言（upsert/get/delete 按 `user_id` 过滤） | ✅ 态4：按 `(user_id, attachment_id)` 写读一致、跨用户隔离、按关联删除 |

真库脚本退出码 0（2026-09-26 实测）；pre-B4 CREATE 与迁移 DDL **运行时从 `db/index.ts` 源码正则抽取**（防漂移，与 B3 smoke 同惯例）。B3 回归：`npx electron scripts/attachments-migration-smoke.cjs` 4 态全过退出码 0。

### E2E 基线对照（验收口径：零新增失败）

1. 基线：**31 failed / 1 skipped / 101 passed（133 条）**（B2/B3 收尾口径）。
2. 本次（2026-09-26 03:03，`E2E_EXIT=1` 仅因存量失败）：**31 failed / 1 skipped / 101 passed（133 条）**——数字完全一致。
3. **31 failed 名单按 spec 构成与基线逐条相同**：ai-agent-panel 恰 4 条（A2/A3/A4/①整块高亮选区改写）、drag-selection-markers 5、editor-table 7、feedback 5、floating-toolbar 2、thematic-break 2、exit-behavior 2、editor 1、image-resize 1、recent-history-restore 1、welcome-doc 1 = 31；**无任何知识库设置/导入/删除/附件相关用例失败**。
4. B2 上传链路用例（多选折叠、上传图片按钮）与 B3 发送链路用例全部通过。

## 7. B4 批次变更文件（21 个，见 commit）

- **src（9）**：`shared/ai/kb.ts`（sourceType 扩 `attachment` / `IKbImportResult.error?` / `KbImportFileRequest`）、`main/db/index.ts`（D3 `addKbAttachmentColumns` 幂等补列+索引）、`main/db/kb.ts`（`attachment_id` 行映射 + upsert 双键查找 + get/delete by attachment）、`main/db/attachments.ts`（唯一删除点收口 KB 清理）、`main/ai/knowledge/kbIndexer.ts`（opts 贯穿 + `recordImportFailure` + `removeByAttachment/removeByDocId`）、`main/ai/ipc/kbHandlers.ts`（解析先行目录导入 + 附件入 KB + 双键入参分派）、`main/preload.ts`（importFile 联合类型 / delete 双键载荷）、`render/stores/agentStore.ts`（triggerKbDelete 对象入参）、`render/components/AIAgent/knowledge/KnowledgeBaseSettings.tsx`（删除入口全量渲染）。
- **tests（8）**：`kbHandlers.test.ts`（新建）、`knowledgeBaseSettings.test.tsx`（新建）、`kbIndexer/kbDao/migrations/attachments/ipc/documentParser` 扩展。
- **docs（3）**：本报告、`plan/doc-pipeline.status.md`（B4 小节）、`architecture/knowledge.md`（导入通道与 `kb_documents` 模型同步）。
- **scripts（1）**：`kb-attachment-migration-smoke.cjs`（新建，真库四态）。
- **不改**：历史迁移块（只追加 `addKbAttachmentColumns`）、`docs/architecture/database.md` 的 kb_documents 字段表（按计划归 B11 八-3② 统一对齐，见 §8.7）。

## 8. 决策与偏离记录

### 8.1 复用 KB_IMPORT_FILE 载荷扩展，不新增 IPC 通道
附件入 KB 以 `{userId, attachmentId}` 复用 `kb:import:file`（`KbImportFileRequest` 二选一联合类型），**不新增通道** → §1.3「新增通道三处同步」硬规则不触发（constants/preload 声明已同步，docs/08 通道行不变）。取舍：B11 勾选 UI 直接调 `kb.importFile({userId, attachmentId})` 即可，避免再造通道与第三种状态。

### 8.2 KB_DELETE 扩 docId 分派 + 设置页删除按钮全量渲染（计划外最小补充）
计划只要求「失败 `status='error'` UI 可见」。但失败/导入行 `file_id` 恒 NULL，原 UI「`doc.fileId` 才渲染删除按钮」使这些行**不可处置**（错误行永久堆积）。故：KB_DELETE 载荷扩可选 `docId`（fileId 优先，既有语义回归锁定）、删除按钮对全部文档渲染、`triggerKbDelete` 改对象入参。偏离度：局部 UI 行为扩展，未动删除语义本身（仍是 `removeByFile`/`removeByDocId` 各自参数化归属删除）。

### 8.3 删除附件→清理 KB 收口在 DAO 唯一删除点
`removeParsedAttachment` 是全库唯一附件删除入口（当前无附件删除 IPC），删除成功即调 `removeByAttachment(userId, id)`（对齐 `cleanupKbAfterFileDelete` 的调用方收口语义）。层向依赖 `db/attachments → ai/knowledge/kbIndexer` 单向，无环（kbIndexer 不反向依赖 attachments）。**未来任何附件删除 IPC 必须走本函数**，否则清理旁路。

### 8.4 目录导入的重复行语义（既有，未在 B4 修）
`file_id`/`attachment_id` 皆无的纯导入行每次导入新建（重复导入同目录产生重复文档）——**B4 前即为此语义**（`upsertKbDocument` 仅按 file/attachment 收敛），本批次不改以免范围外重构；附件行因带 `attachment_id` 收敛，重试幂等。记录为已知限制。

### 8.5 进度反馈取舍（四-3②「异步与进度反馈」）
不新增进度事件通道：异步 = IPC handler 全 async + 解析经 `parseLimiter` 限流（并发 3）；进度 = KB 文档状态行（`importing → done/error`，设置页列表红/绿标）+ 设置页 busy 态 + `KB_IMPORT_DIR` 逐文件 `IKbImportResult[]`。勾选「加入知识库」UI 按计划随 **B11** 落地。

### 8.6 单文件导入（设置页 openFile）解析失败仍静默 —— 遗留
计划 B4 的 UI 条目只覆盖「导入结果 error 状态可见（列表）」；设置页单文件导入在 `kb.parseDocument` 失败时仅不导入、无行内提示（现状即如此）。列入遗留，待后续批次补 UI 反馈（不属四-3② 验收点）。

### 8.7 `docs/architecture/database.md` 字段表不同步 —— 归 B11
database.md 的 kb_documents/kb_chunks 字段表当前为陈旧形态（`source_path`/`chunk_count` 等与 DDL 不符，B4 前已不一致）。计划 §2-B11 八-3② 明确该对齐归 B11，本批次只同步 `knowledge.md`（导入通道与数据模型，本次实际触及），避免与 B11 范围冲突。

### 8.8 `.doc` 与无文本产物的失败语义
`.doc` 降级产物（`text=''` + `degraded` 提示）与无文本层文件统一走 `recordImportFailure`（`status='error'`，原因进 `IKbImportResult.error`），B7 D 路线接入后复评是否改为「降级成功」语义。

## 9. 结论

**B4 完成。** TDD strict 全程：RED 7 文件 38 failed 实测在先 → 最小实现 GREEN（8 文件 150 passed → 全量 145 文件 3370 passed）→ 重构 1 项（冗余守卫）+ 实现期结构收敛 3 项；B4 相关子集覆盖 87.5% 语句（新增语句行 0 未覆盖，逐行比对见 §5）；五门禁全绿（tsc 0 / vitest 3370 passed 0 failed / lint 0 error·108 存量 warning / vite build 0 / E2E 31f·1s·101p 与基线逐条同名单零新增）；**迁移三断言双轨全过**（vitest FakeDb + Electron 真库 smoke 退出码 0，空库/旧库/重复/读写四态），B3 附件迁移 smoke 回归亦全过。

验收点对照（四-3②）：正则扩 7 格式且**先 `parseDocument` 再入索引**（fs 读禁断言证 pdf 不经 utf-8 直读）✅ / 单文件失败写 `status='error'` UI 红标可见、不断批、可删除 ✅ / 附件入 KB 带 `parsed_attachments.id` 关联（`source_type='attachment'` + `attachment_id`），**删除附件→清理 KB** 收口唯一删除点 ✅ / 大附件解析走 parseLimiter 限流 + 异步状态行进度反馈（取舍 §8.5）✅ / 入 KB 勾选取舍按计划留待 **B11** ✅ / **D3** 幂等补列+索引三断言双轨 ✅。

**遗留**：设置页单文件导入解析失败无行内提示（§8.6）；目录导入重复行语义为既有状态未改（§8.4）；`database.md` 字段表归 B11 八-3② 对齐（§8.7）；E2E 存量 31 failed 不属本批次；`cacheMonitor` 性能用例负载 flaky（§6）。**下一任务：B5（四-1/四-2 + 三-2 检索接通）**。
