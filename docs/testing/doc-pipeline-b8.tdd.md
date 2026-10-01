# doc-pipeline B8 — TDD 证据报告（strict）

> 创建：2026-09-27 | 批次：**B8（六-1 文档工具集 + 六-2 citation 回链 + 六-3 评测闭环 + 四-4 检索质量）** | 强度：strict（RED → 最小实现 GREEN → 重构 → 覆盖率 → 门禁 → 提交）
> 来源：[计划](../specs/knowledge/kb-indexing-egress.md) §1/§2-B8/§4.2-B8 / [需求](../requirements/doc-pipeline.req.md)
> 权威需求源：`C:\Users\lenovo\Desktop\优化方向\优化方向.md` §六-1/六-2/六-3/四-4（拷问细节② = 验收点）
> 调研依据：`docs/research/doc-pipeline-tools.md` §1（工具划分/schema/示例）、§2（前缀缓存稳定与字母序）、§3（只读区与并发）、§4（结果预算与落盘）
> 风险级：**L3**；红线：新工具不进 `WRITE_TOOLS`/`FORCE_CONFIRM`、不削弱 `allowSend`、不删测试、不推送远程

## 1. 测试范围

| 文件 | 类型 | 新增用例 | 覆盖项 |
|------|------|---------|--------|
| `tests/main/ai/docTools.test.ts` | **新建** | 42 | **六-1② 全项**：四工具注册（28 工具 + defer + 字母序）/ READ_ONLY 分区（不进 WRITE/FORCE_CONFIRM）/ 陈旧名清理（selector + concurrency）/ **concurrencyDefs 并发安全**（不落 fail-closed 串行）/ toolsForIntent 意图分区（chat/kbQa/create）/ 系统提示词路由；searchDocument（页码二分 + 章节路径 + top_k + 多附件歧义引导 + 归属/未解析错误 + 无标题降级）；readPage（页切片 + 超范围区间 + 无页码结构指引）；extractTable（清单/完整 CSV/引号感知计列/缺 CSV/非正整数/**大 CSV 不截断**）；analyzeChart（page/image_index 双锚点 + 章节摘录回落 + 关联数据表 + 显式识读说明 + 降级分支）；readLocalFile 超限文案一致性 |
| `tests/main/ai/toolRegistry.test.ts` | 扩展 | +9 | 精确 28 工具字母序清单（改 1 断言）；**HyDE 路径生效断言 2 例**（hyde:true → generateHydeVector → queryVector 透传；未传不调零成本） |
| `tests/main/ai/deferredToolLoading.test.ts` | 扩展 | 改 6 | 24→28 总数、19→23 延迟工具集（+searchDocument/readPage/extractTable/analyzeChart）、字母序/幂等断言同步 |
| `tests/main/ai/concurrencyDefs.test.ts` | 扩展 | 改 3 | 全表 28 工具、四工具并发安全 true、陈旧名 fail-closed 语义注释 |
| `tests/main/ai/kbIndexer.test.ts` | 扩展 | +7 | **六-2 锚点**：buildSourceRef 第 5 参 attachmentId、fileId 锚点、indexImportedText/indexFile 贯通 INSERT source_ref；**四-4② 向量前缀 2 例**（headingPath 非空→embedding 输入带前缀且 FTS content 原文 / 空→原文）；**六-3 页码溯源回归**（多页 chunk 页码单调、首块 page=1、不越页界） |
| `tests/main/ai/vectorBackfill.test.ts` | 扩展 | +1 | 回填侧 heading_path 前缀（与写索引同构）+ 扫描 SQL 含 heading_path 列 |
| `tests/main/ai/agentLoop.test.ts` | 扩展 | +10 | **六-2 透传**：searchKB 命中 → assistant `refsJson` 落库（含 attachmentId/page）+ done 事件携带；无检索 → refsJson null；收集器单测 6（searchKB 数组/clarification 包装/refused/searchDocument 命中合成锚点/非引用工具与坏 JSON→null/merge 去重封顶 10）；**六-3 补齐**：vision 不支持 → `VISION_DEGRADED_NOTICE` 注入且 content 保持纯文本（B6 断言缺口） |
| `tests/main/ai/ipc.test.ts` | 扩展 | +6 | **六-2 附件跳转** `attachment:open-source`：路径解析 + shell.openPath、未找到不调 openPath、相对路径拒绝、**非白名单扩展名拒绝（防伪造 .exe）**、非法载荷边界、openPath 错误文案透传 |
| `tests/components/aiMessageBubbleRefs.test.tsx` | **新建** | 6 | **六-2② 渲染**：页码标签「第 N 页」、附件引用点击 → attachment.openSource、fileId 既有 openFile 回归、历史消息无 sourceRef 兼容、有页码无锚点不可点、refsJson null 零回归 |
| `tests/main/ai/toolResultStorage.test.ts` | 扩展 | +1 | **六-1② extract_table 超预算**：落盘完整（文件内容 === 原文，零丢失）+ 预览带路径 + 显示长度收缩 |
| `tests/main/ai/kbSearch.test.ts` | 扩展 | +1 | **六-3 固定 query 集命中率**：5 条固定样例（BM25 负分语义 + 分属不同文档防段聚合干扰 + heading 加权样本）top1 命中率 100% |
| `tests/main/ai/docPipelineEval.test.ts` | **新建** | 6 | **六-3 评测套件**（指标落点索引写在文件头）：指标① 表格还原固定样例（PDF 无框线 3×4 Markdown/CSV 两态、跨页合并行数与重复表头、md 附件 CSV 两态）；指标④ 多模态降级（buildImageParts 不支持 vision → 零 part + degraded、支持分支不误标、D 路线 no-vision 显式提示含模型名且零渲染零调用） |
| **合计** | | **+81 / 改 16** | （= 全量 vitest **3664** − B7 基线 **3583**；文件 154 → 157，新建3） |

## 2. RED（先写失败测试，实际执行）

分三轮（每轮先落测试再改实现），实测输出：

```
$ 轮1（文档四工具，2026-09-26 23:54）
 npx vitest run tests/main/ai/docTools.test.ts toolRegistry deferredToolLoading concurrencyDefs
 Test Files  4 failed (4)
      Tests  38 failed | 55 passed (93)      ← 四工具未注册/清单 24/并发未注册

$ 轮2（citation 回链，2026-09-27 00:07）
 npx vitest run kbIndexer agentLoop aiMessageBubbleRefs ipc
 Test Files  4 failed (4)
      Tests  19 failed | 94 passed (113)     ← source_ref 无 attachmentId、refsJson 无写入、
                                               页面/附件渲染不识别、通道未注册（模块导入失败连带）
$ 轮2 中途（首轮 GREEN 验证，00:16）4 failed：test 期望 3 处 + browserify path posix 误拒盘符 1 处 → 修断言/改显式盘符判定
```

| 轮 | 首跑失败 | 失败点 → 处置 |
|----|---------|---------------|
| 1 | 38 failed / 93 | 四工具不存在（未知工具）、28 工具清单/23 延迟集缺失、并发表未注册、意图分区缺失、readLocalFile 旧文案 → 最小实现后 93 passed |
| 2 | 19 failed / 113 | buildSourceRef 无第 5 参、writeChunks 不传锚点、collectCitations/mergeCitations 不存在（导入失败）、agentLoop 无 refsJson、气泡不识别 page/attachmentId、`attachment:open-source` 通道缺失 → 实现后首轮 4 failed：① refsJson 断言未按嵌套转义解析（改 JSON.parse 内层 sourceRef）② 测试路径字符串 `\d`/`\r` 转义吃字（改正斜杠）③ buildSourceRef page 期望算错（offset 100 落第 2 页，改期望）④ **`path.isAbsolute` 在 vitest 下为 browserify posix 语义，误拒 `C:\` 盘符路径（实测 `platform: win32, isAbsolute: false`）→ handler 改显式盘符/根/UNC 白名单判定** → 113 passed |
| 3 | 6 failed / 167 | 向量前缀两处未实现（kbIndexer/vectorBackfill）；评测套件 4 处期望问题 → ① markdown 两态行数 4→5（表头+分隔+3 数据行）② md CSV 3 行（跳分隔行）③ runDRoute 缺 userId 落 no-config 分支（补参）④ **固定集 bm 用正值与 bm25 负分语义相反致 top1 反转（实测排序为 bm 升序）→ 按 BM25 负值 + ORDER BY bm 升序注入 + 分属不同文档防段聚合改写** → 167 passed |

RED 即通过的大量用例 = 存量回归断言（28 工具字母序、defer 幂等、既有检索/回填/降级用例）——**接入新工具后既有断言全部保持通过**（唯一同步改动为数量/清单类断言 16 处，见 §1）。

## 3. 最小实现 → GREEN（实际执行）

```
$ 轮1（2026-09-26 23:58）
 npx vitest run docTools toolRegistry deferredToolLoading concurrencyDefs
 Test Files  4 passed (4)
      Tests  93 passed (93)                  ← checkpoint 1ca9dc6

$ 轮2（2026-09-27 00:20）
 npx vitest run kbIndexer agentLoop aiMessageBubbleRefs ipc
 Test Files  4 passed (4)
      Tests  113 passed (113)                ← checkpoint 1d51eb6

$ 轮3（2026-09-27 00:35）
 npx vitest run kbIndexer vectorBackfill docPipelineEval kbSearch toolRegistry toolResultStorage agentLoop
 Test Files  7 passed (7)
      Tests  167 passed (167)                ← checkpoint 80b7f81
```

提交（均 `... (B8)` 结尾 + Co-Authored-By）：

| commit | 内容 |
|--------|------|
| `1ca9dc6` | 四工具新建 + handlerMap/CORE_TOOLS/只读区/并发表/意图分区/提示词路由、陈旧名清理、readLocalFile 文案、IDocumentStructure.images 锚点（16 文件） |
| `1d51eb6` | source_ref attachmentId/fileId 锚点、citation 收集与 refsJson 落库/done 透传/回放恢复、气泡页码标签与附件跳转、attachment:open-source 通道三处同步（21 文件） |
| `80b7f81` | 向量侧上下文前缀（写索引+回填同构）、六-3 评测套件、HyDE 断言、extract_table 落盘断言、架构/模块文档计数同步（12 文件） |

最终全量（全部轮次收口后）：

```
$ npx vitest run
 Test Files  157 passed (157)
      Tests  3664 passed (3664)             ← 2026-09-27 00:38 实测 exit 0（B7 基线 3583 + 81）
```

## 4. 重构（不改行为）

- `searchDocument.ts` 承载四工具共用的 `resolveAttachmentTarget` / `collectHeadingMarks` / `pageAt` 纯函数，其余三工具跨文件复用（**避免为共享逻辑新增范围外源文件**，见 §8.2）；均为导出纯函数、直接被单测覆盖。
- `buildSourceRef` 保持位置参数向后兼容（第 5 参可选），既有 4 参调用点零改动。
- 无行为改写的既有断言同步仅限数量/清单类（16 处，§1 标注「改」）。

## 5. 覆盖率（新增代码）

B8 触及文件定向覆盖（vitest --coverage，13 个相关测试文件）：

```
-------------------|---------|----------|---------|
File               | % Stmts | % Branch | % Funcs |
-------------------|---------|----------|---------|
四工具聚合           |  96.58  |  87.79   |  100   |  （searchDocument 98.26 / readPage 100 /
 analyzeChart 94.19 / extractTable 94.82）
 kbIndexer.ts       |  97.29  |  85.60   |  100   |
 vectorBackfill.ts  |  98.36  |  87.03   |  100   |
 concurrencyDefs.ts |  97.84  |  71.42   |  100   |
 agentToolSelector  |  88.07  |  57.89   |  100   |
 agentToolExecutor  |  62.03  |  57.14   |  76.92 |  ← 整文件口径：未覆盖为存量任务执行分支；
                                                       本批新增 collectCitations/mergeCitations
                                                       6 例单测 + agentLoop 集成直达 100%
-------------------|---------|----------|---------|
```

**新增代码语句覆盖 ≥80% 达标**（四工具 96.58%、新增收集器/前缀函数/通道 handler 全用例直达；agentToolExecutor/agentLoop 低值均为存量未触达分支，非新增代码）。

## 6. 质量门禁（全部实测）

| 门禁 | 命令 | 实测结果 |
|------|------|---------|
| 类型 | `npx tsc --noEmit` | **0 error**（2026-09-27 收口实测；中途修 TS18048×1、TS2339 images×3、TS2741 bridge×1） |
| 单测 | `npx vitest run` | **157 文件 / 3664 passed / 0 failed**（exit 0；B7 基线 3583 + 81） |
| Lint | `npm run lint` | **0 error / 106 warning**（与 B7 基线完全持平，--fix 零改动） |
| 构建 | `npx vite build` | **exit 0**（dist-main + renderer + preload 三段成功） |
| E2E | `npx playwright test` | 见下方 E2E 行（验收口径：**零新增失败**） |

E2E：`31 failed · 1 skipped · 101 passed（133 条）`——failed 名单与基线逐条一致（存量已裁定），**零新增失败**。

## 7. §4.2-B8 验收点逐条对照

| 验收点 | 结论 | 证据 |
|--------|------|------|
| 六-1② 新工具落只读区不进 WRITE_TOOLS | ✅ | docTools「READ_ONLY_TOOLS 包含 / WRITE/FORCE_CONFIRM 不含」 |
| 六-1② 全部注册 concurrencyDefs（不落 fail-closed 串行） | ✅ | docTools「四工具并发安全 true」+ concurrencyDefs.test 全表 28 |
| 六-1② defer 同步意图分区 | ✅ | CORE_TOOLS defer:true + toolsForIntent 三意图断言 |
| 六-1② 陈旧工具名清理（readFileRevision/listFileRevisions/getFileInfo） | ✅ | selector 双处清理（src 内零残留，grep 实证）；concurrency 语义 = 未知 fail-closed 不变 |
| 六-1② extract_table 超预算落盘降级不截断丢数据 | ✅ | handler 大 CSV 原文返回 + S6 落盘 `readFileSync === content` 断言 |
| 六-1② readLocalFile:31 文案/实现不一致修正 | ✅ | **择「改文案」**（§8.1）+ 超限文案测试（不再指向 readFile 分块） |
| 六-2② 页码回链真实 | ✅ | source_ref.page（B7）→ collectCitations → refsJson → 气泡「第 N 页」（组件测试） |
| 六-2② 附件引用可点击跳转原文位置 | ✅ | attachmentId 锚点 + `attachment:open-source`（服务端反查 + 白名单）+ 气泡点击测试 |
| 六-2② refsJson 历史消息兼容 | ✅ | 无 sourceRef/无新字段均可渲染（组件测试 2 例）；JSON 级可选字段、无 DDL |
| 六-2② 与图片引用结构关系有记录 | ✅ | §8.4 |
| 六-3② 四项可自动化指标落地 | ✅ | 指标①④→docPipelineEval；②→kbIndexer 页码溯源回归；③→kbSearch 固定 query 集命中率 100% |
| 六-3② OCR 指标不做 | ✅ | 决策基线，测试集无 OCR 项 |
| 六-3② TDD 报告即证据 | ✅ | 本文件 |
| 四-4② 上下文前缀取舍写明 | ✅ | **仅向量侧加前缀、FTS5 保持原样**（§8.5）+ 双侧测试 |
| 四-4② 页码入 source_ref（本批接检索展示） | ✅ | B7 落库 + B8 检索结果 → refsJson 气泡页码展示全链路测试 |
| 四-4② HyDE 收益复核有结论 | ✅ | §8.6（结构性结论 + 测试证据；量化 A/B 列遗留） |
| 四-4② 拒答阈值 0.6 复核记录（不新增配置） | ✅ | §8.7 |
| 门禁全绿 | ✅ | §6 |

## 8. 偏离与决策记录

1. **readLocalFile 超限：改文案而非实现分块**（六-1②二选一）。理由：分块读取属新能力，全局规则禁止为尚未发生的需求建设；文案改为如实陈述限制（`readLocalFile 不支持分块读取`），不再指向不存在的 readFile 分块参数。分块列 §9 遗留。
2. **四工具共用解析器放 `searchDocument.ts`**：计划仅批 4 个新建工具文件，不为共享逻辑增第 5 个源文件（全局规则：新增文件需说明理由并获批）；以导出纯函数跨文件复用并注释取舍。
3. **`IDocumentStructure` 增可选 `images` 字段**：analyzeChart 的 image_index 定位锚点需要图片序号落库——JSON 级可选字段（历史行无字段向后兼容），同步 `extractStructure` 提取、`sanitizeStructure` IPC 白名单、发送链路回写三处；无 DDL、不动迁移。
4. **citation 与图片引用的结构取舍（六-2②要求写明）**：维持**两套结构**——`refsJson`（assistant 消息的检索出处，B8 扩 `page`/`attachmentId` 可选锚点）与 `attachments_json`（user 消息的上传物元数据，图片缩略图/lightbox 走 B6 通道）。不合并的理由：一物两表语义（出处=检索产物、附件=用户上传）、历史消息均按可选字段解析、图片引用的渲染交互（缩略图/放大）与出处 chip（跳转）职责不同。附件出处点击 = 打开原始文件（OS 默认应用），**应用内无 PDF 预览器故不做页内定位**，页码展示在标签供用户自行跳页（取舍记录）。
5. **四-4② 前缀取舍：仅向量侧加前缀，FTS5 侧保持原样**。理由：前缀会把标题文本混入关键词倒排，污染 BM25 召回（源文档点名的风险）；向量侧前缀（`headingPath + '\n' + text`）注入上下文符合「Chunk 文本 + 上下文说明 → 再索引」。写索引（`writeChunks`）与历史回填（`vectorBackfill`）共用 `chunkEmbeddingText` 保证两侧向量空间同构。**查询侧不加前缀**（避免查询语义漂移，两侧风格差交由 embedding 模型泛化——已知限制如实记录）。
6. **HyDE 收益复核结论（四-4②）**：
   - 结构性结论：B5 前 `kbIndexOpts()` 恒 `{}` → `kb_chunks.vector` 全 NULL → vectorSearch 空扫，`hyde:true` 生成的 queryVector **无消费效果（no-op）**；B5 接通后向量分支按 `embedding_model` 过滤真实参与 RRF，HyDE 路径**已生效**——由本批测试锁定（toolRegistry 2 例：hyde:true → generateHydeVector → queryVector 透传；未传零调用）+ B5 既有（hybrid+queryVector 向量 SQL 过滤）。
   - 量化收益（固定 query 集带 HyDE 的命中率 A/B）需真实 embedding + LLM API 凭据；**本批无凭据环境不编造数据**，列遗留（§9）。
   - 行为变化记录：接通后 `hyde:true` 的一次额外 LLM 调用 + 一次 embedding 开始真实计费；默认 `hyde:false` 不变。
7. **拒答阈值 0.6 复核（四-4②）**：`kbSearch` 阈值仅来自 `opts.threshold ?? 0.6`，附件与笔记 chunk 走同一 `kb_chunks` 管线、无 `source_type` 分支 → 附件文档与笔记同阈值。**本期不新增配置**（计划 §5 范围外已列）；若后续附件场景误拒率高再评估独立配置项。
8. **新增 IPC `attachment:open-source`（§1.3 三处同步）**：constants + preload + `docs/modules/08` 同步；**只收 attachmentId、服务端按 user_id 反查路径**（`attachments_json` 参数化 LIKE + JSON 精确定位，LIMIT 50 防全表扫），渲染层无法直传任意路径；打开前「绝对路径 + 7 格式白名单」双校验（防伪造 `.exe` 打开，ipc.test 锁定）。绝对路径判定不用 `path.isAbsolute`——实测 vitest 环境被 browserify 替换为 posix 语义（`win32` 下 `C:\` 返回 false），改显式盘符/根/UNC 白名单。
9. **done 事件扩 `refsJson` 字段**（非新通道）：渲染层即时展示出处 + 事件回放恢复；`agentLoop` 两处 done 载荷 + preload map + agentStore 三处消费同步。chat 模式（chatHandlers，已废弃）未接收集，列遗留。
10. **文档同步范围**：工具计数 24→28 仅改触及条目（ai-agent/backend/modules-11 共 6 处）+ docs/08 通道行；历史计划/调研文档中的「24 工具」为时点记录，不改。
11. **评测固定集 bm 语义**：BM25 原始分为负值（越小越好，`ORDER BY bm` 升序）——首版正值期望导致 top1 反转，实测修正（记录于 §2 轮3），最终固定集按真实语义注入。

## 9. 遗留（移交后续批次）

- **HyDE 量化 A/B**：需真实 embedding/LLM 凭据的固定 query 集对照（命中率提升 vs 额外 token 成本），列入后续检索调优。
- **chatHandlers citation 收集**：Chat 模式已废弃（统一 Agent），本轮未接；若 Chat 复活需同步 `collectCitations`。
- **附件页内定位**：应用内无 PDF 预览器，`attachment:open-source` 交 OS 默认应用打开，页码仅展示（产品级页内跳转列后续）。
- **analyzeChart 像素级识读**：本期返回图表定位 + 关联数据表 + 上下文（结构化分析输入）；工具期 vision 识读与 D 路线职责重叠，不做（取舍 §8.4 邻接），如需列后续。
- **readLocalFile 分块读取**：仅文案如实（§8.1），offset/limit 分块能力列后续。
- E2E 存量 31 failed 不属本批次；`ab-test`/`cacheMonitor` 性能断言负载 flaky 为已知存量（本轮全量两跑均绿）。
