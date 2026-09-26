# doc-pipeline B7 — TDD 证据报告（strict）

> 创建：2026-09-26 | 批次：**B7（二-3 PDF 版面 + 二-4 D 路线 + 二-6 页码溯源落库）** | 强度：strict（RED → 最小实现 GREEN → 重构 → 覆盖率 → 门禁 → 提交）
> 来源：[计划](../plan/doc-pipeline.plan.md) §1/§2-B7/§4.2-B7 / [需求](../requirements/doc-pipeline.req.md)
> 权威需求源：`C:\Users\lenovo\Desktop\优化方向\优化方向.md` §二-3/二-4/二-6（拷问细节② = 验收点）
> 调研依据：`docs/plan/doc-pipeline.research-pdf-multimodal.md` §1（pdfjs TextItem/transform 坐标、Node 栅格化）、§4（D 路线接入建议 8 条）；`docs/plan/doc-pipeline.research-parse.md` §1（liteparse API 实测结论）
> 风险级：**L3**；红线：本期无 OCR、不削弱 `allowSend`、不删测试、不引入 pdfjs-dist（体积门禁联动 B10）

## 1. 测试范围

| 文件 | 类型 | 新增用例 | 覆盖项 |
|------|------|---------|--------|
| `tests/main/ai/pdfLayout.test.ts` | **新建** | 27 | **二-3② 全项（纯函数）**：无文本层双低判定（字符数/页面积比）、双栏坐标聚类先左后右 + 栏内 y 升序、全宽标题 band 分隔、单栏不误分栏、字号判标题层级 + 章节路径嵌套、**无框线表格行列还原**（网格准确 + Markdown/CSV 两态 + 置信度）、**跨页表格合并**（重复表头丢弃 / 无表头续行 / 相邻独立表不误并）、**页眉页脚跨页重复剔除入 metadata**（顶带重复 + 底带页码数字归一化 + 单页不误剔）、`columnDetectFailed` 判定、pageOffsets 分页溯源、空输入安全；`shouldUseDRoute` 显式触发矩阵 5 例（三信号各触发 + 全正常不触发 + 等于阈值不触发） |
| `tests/main/ai/multimodalParse.test.ts` | **新建** | 20 | **二-4② 全项**：成功识读（按页拼接 + pageOffsets 单调 + token 成本复用 B6 计价）、识读提示词强制结构化表格/数据输出、`.doc` 可走 D（Q3）、页数上限截断显式提示、**并发不超过 D_ROUTE_CONCURRENCY**、降级五路径（no-config 不渲染不识读零烧 token / no-vision 含模型名且不发请求 / 无 userId / render-failed / llm-failed 不产出残缺文本）、`estimateDRouteTokens` 纯函数 |
| `tests/main/ai/documentParser.test.ts` | 扩展 | +12 | **真实 liteparse → pdfLayout 全链路**：双栏固定样例 PDF 左先右、双页 pageOffsets 分页 + 页眉剔除入 metadata、正常文档不触发 D（不全量烧 token）；**无文本层短路转 D**（runDRoute 收到 reason='no-text-layer' + 降级保留 A 文本与显式提示 + 成功采用 D 文本与轨迹）；`.doc` D 优先两分支（成功返回 D 产物 / 降级保留另存为 docx 指引）；**CSV 两态**（md/docx）；KB_PARSE_DOCUMENT 第 5 参 options 签名扩展 |
| `tests/main/ai/kbIndexer.test.ts` | 扩展 | +5 | **二-6② source_ref 真实页码**：pageOffsets → page 字段二分定位（无 line 近似）、无 pageOffsets → line 近似回归防护、indexImportedText 贯通 pageOffsets → INSERT source_ref 含 page |
| `tests/main/db/attachments.test.ts` | 扩展 | +7（改 2） | **structure_json 落库**：sanitize 白名单放行/非法剔除、INSERT 参数化写入、getParsedAttachment 解析 + 坏 JSON 容错、发送链路结构落库 + parseDocument 收到 userId、补解析结构回写、**空文本 degraded 上屏 meta.error**；既有断言改 2 处（INSERT 列数 8→9、parseDocument 签名） |
| `tests/main/db/migrations.test.ts` | 扩展 | +3 | **D7 迁移三断言**：空库首建 / 旧库升级只增不改（无 DROP）/ 重复执行幂等 |
| `tests/main/ai/kbHandlers.test.ts` | 扩展 | +5（改 1） | KB_PARSE_DOCUMENT options.userId 透传 + 向后兼容、importDirAsKb pageOffsets 贯通、importAttachmentAsKb structure.pageOffsets 贯通、KB_IMPORT_FILE 单文件 pageOffsets |
| `tests/components/composerPaste.test.ts` | 扩展 | +4 | **结构随附件载荷透传**：ingestFilePaths 提取 structure（页码偏移不丢失 / 缺 parseVersion 容错）、toAttachmentPayloads 透传、无结构不含字段 |
| **合计** | | **83** | （= 全量 vitest **3583** − B6 基线 **3500**；逐文件：pdfLayout 27 + multimodalParse 20 + documentParser +12 + kbIndexer +5 + attachments +7 + migrations +3 + kbHandlers +5 + composerPaste +4） |

## 2. RED（先写失败测试，实际执行）

分阶段执行（每阶段先落测试再改实现）：

```
$ npx vitest run tests/main/ai/pdfLayout.test.ts
 Test Files  1 failed (1)
      Tests  no tests (0)                    ← 2026-09-26 20:43，模块不存在（transform 失败）
```

其余阶段 RED（如实记录，首跑失败 → 修实现/断言 → 绿）：

| 阶段 | 首跑输出 | 失败点 |
|------|---------|--------|
| pdfLayout（初版实现后首测） | 5 failed / 27 | gutter 被全宽标题的 union 桥接破坏（双栏判不出）、正文基准字号被小样本众数带偏（Mid Section 漏判标题）、跨页续表行数下限过严（2 行续表不吸收）、columnDetectFailed 缺 x0 双峰判据 → 重写管线（表格检测先行 + 填充率区分散文/表格 + coverage 法 gutter + 字符权重 10% 基准字号）→ 27 passed |
| multimodalParse | 1 failed / 12 | 页级 prompt 未携带结构化要求（anthropic 分支无 system 消息）→ 系统提示词并入页 prompt → 12 passed |
| documentParser B7（mock runDRoute 后） | 9 failed / 34 | 接线前：无 pdfLayout/D 短路/.doc D 优先/CSV 两态/options 签名 → 实现后 34 passed |
| kbIndexer buildSourceRef | 3 failed / 33 | page 字段缺失、indexImportedText 不透传、fixture 过短只出 1 块（600/700 字符 < targetSize 800）→ 实现 + fixture 改 2000 字符 → 33 passed |
| migrations D7 | 3 failed / 13 | 函数未导出 → 实现 → 13 passed（含命名统一为 `addB7AttachmentStructureColumn`） |
| attachments structure | 6 failed / 30 | sanitize/insert/结构回写/degraded 上屏未实现 → 实现后改既有 2 断言（INSERT 列数、parseDocument 签名——见 §8.5/§8.6）→ 30 passed |
| kbHandlers 接线 | 6 failed / 27 | options 透传/pageOffsets 贯通未实现；`typeof === 'array'` 笔误（TS2367）→ `Array.isArray`；测试 fn 缺 null 守卫 + setupDir 漏调 → 27 passed |
| composerPaste 结构透传 | 2 failed / 32 | structure 未实现 → 实现后 32 passed |
| multimodalParse 默认依赖补覆盖 | 3 failed / 20 | `depsFor` 默认注入 readPage 掩盖了默认实现 → 移除默认注入、各用例显式控制 → 20 passed；动机：首轮覆盖 **73.38% < 80%**（动态 import 生产分支未覆盖），补 8 例后 **97.15%** |

RED 即通过的大量用例 = 存量回归断言（7 格式白名单、xlsx 合并/公式/错位、md 结构化、docx 结构化、KB handler、附件三态、heading_path 等）——**解析入口大改后既有断言全部保持通过**。

## 3. 最小实现 → GREEN（实际执行）

```
$ npx vitest run tests/main/ai/pdfLayout.test.ts tests/main/ai/multimodalParse.test.ts \
    tests/main/ai/documentParser.test.ts tests/main/ai/kbIndexer.test.ts
 Test Files  4 passed (4)
      Tests  106 passed (106)                ← 阶段 1 checkpoint e9ccf9c

$ npx vitest run tests/main/db/attachments.test.ts tests/main/db/migrations.test.ts \
    tests/main/ai/kbHandlers.test.ts tests/components/composerPaste.test.ts \
    tests/main/ai/documentParser.test.ts tests/main/ai/kbIndexer.test.ts tests/main/ai/ipc.test.ts
 Test Files  7 passed (7)
      Tests  212 passed (212)                ← 阶段 2 checkpoint faed878
```

提交（`feat(parser): ... (B7)`）：

| commit | 内容 |
|--------|------|
| `e9ccf9c` | pdfLayout + multimodalParse 新建、parsePdf/D 短路/`.doc` D 优先/CSV 两态、buildSourceRef 真实页码、契约 v2（11 文件） |
| `faed878` | D7 迁移 structure_json、attachments 结构落库 + userId/degraded 接线、KB IPC pageOffsets 贯通、preload/renderer 全调用点（14 文件） |

最终全量（全部阶段收口后）：

```
$ npx vitest run
 Test Files  154 passed (154)
      Tests  3583 passed (3583)             ← 2026-09-26 23:20 实测 exit 0（B6 基线 3500 + 83）
```

## 4. 重构（不改行为）

1. **`findGutter` 从 interval-union 改为 coverage/成对 gap 法**：全宽标题会把左右栏 union 桥接成连续区间导致 gutter 判不出——改为按行区间成对找 gap + 跨越行数约束（全宽行允许作 band 分隔符而非否决）。
2. **表格检测先行 + 填充率判据**：双栏同 y 左右段落（2 items/行、填充率高）会被列对齐误判为表格——新增 `runFillRatio < TABLE_FILL_MAX(0.55)`（表格单元窄、散文占满行跨度）区分两者；表格行先消费，剩余行再进分栏。
3. **正文基准字号改字符权重 10% 分位**：小样本下众数会被次大字号夺走（标题变正文）——取"累计字符权重 ≥10% 的最小字号"，标题/正文双样本均正确。
4. **`runDRoute` 页数未知路径**：`pageCount<=0`（legacy .doc）→ 渲染全部后按 `MAX_DROUTE_PAGES` 截断，与已知页数路径统一 `truncatedPages` 语义。
5. 重构后目标文件复测通过；全量 3574 passed。

## 5. 覆盖率（新增代码）

```
$ npx vitest run --coverage --coverage.reporter=text     --coverage.include='src/main/ai/files/pdfLayout.ts'     --coverage.include='src/main/ai/files/multimodalParse.ts'     --coverage.include='src/main/ai/files/documentParser.ts'     --coverage.include='src/main/ai/knowledge/kbIndexer.ts'     --coverage.include='src/main/ai/ipc/kbHandlers.ts'     --coverage.include='src/main/db/attachments.ts'     --coverage.include='src/render/components/AIAgent/composer/pasteAttachment.ts'     --coverage.include='src/shared/ai/document.ts'     --exclude '**/cacheMonitor.test.ts' tests/main/ai tests/main/db tests/components tests/utils
```

实际输出（2026-09-26 23:10，79 文件 / 1155 passed 后落报告）：

```
File               | % Stmts | % Branch | % Funcs | % Lines
All files          |   95.79 |    83.22 |   98.13 |   95.79
 pdfLayout.ts      |   98.12 |    85.93 |     100 |   98.12
 multimodalParse.ts|   97.15 |    88.77 |     100 |   97.15
 documentParser.ts |   95.62 |    74.01 |      95 |   95.62
 kbHandlers.ts     |   92.97 |    84.04 |     100 |   92.97
 kbIndexer.ts      |   93.11 |    83.06 |     100 |   93.11
 attachments.ts    |   95.78 |    84.73 |     100 |   95.78
 pasteAttachment   |   96.4  |    86.66 |    90.9 |   96.4
 document.ts       |     100 |    38.46 |     100 |     100
```

- **B7 新增/触及文件语句覆盖率全部 ≥92.9%**（新增代码 ≥80% 达标；首轮 multimodalParse 73.38% 未达标 → 补 8 例默认依赖生产路径覆盖后 97.15%，见 §2）。
- 未覆盖行均为防御/兜底分支：`multimodalParse` 321-322/334-335 = render 空结果与 unknown-page 截断兜底、`pdfLayout` 585-589/610-612 = pageOffsets 回填与空输入早退、`documentParser` 452-453/554-555 = liteparse 降级正则 catch、`kbHandlers` = error message catch。
- `db/index.ts`（28%）为既有大文件（B7 仅新增 `addB7AttachmentStructureColumn` 一个函数，其语句由 migrations.test 三断言直接覆盖），按 B1~B6 同口径不计入本批次新增代码。
- **口径说明**：同 B6——vitest v8 在 tests fail 时不落报告，覆盖率证据取 B7 相关测试子集（全过 → 报告产出）；`tests/benchmarks`（ab-test flaky）不在 include 目录内。

## 6. 质量门禁（全部实测）

| 门禁 | 命令 | 结果 |
|------|------|------|
| 类型检查 | `npx tsc --noEmit` | **exit 0，零错误**（TS strict；首轮修 shared 契约/可选字段收窄等） |
| 单元测试 | `npx vitest run` | **154 文件 / 3583 passed / 0 failed**（2026-09-26 23:20 实测 exit 0；B6 基线 3500 → 3583，净增 83） |
| Lint | `npm run lint` | **0 errors, 106 warnings**（与 B6 基线持平） |
| 构建 | `npx vite build` | **exit 0**（renderer + main + preload 三段全过） |
| E2E | `npx playwright test` | **31 failed / 1 skipped / 101 passed（133 条）**，两轮独立实测（2026-09-26 22:1x / 22:5x）结果一致，与 B6 基线总数逐项相同，**零新增失败**；B7 未新增/修改任何 e2e spec（改动的 renderer 调用点在 e2e 中走 weaveMDBridge mock，签名向后兼容——参数少的实现可赋给参数多的类型）。首轮尾部可见失败含 feedback / floating-toolbar / image-resize / recent-history / thematic-break / welcome —— 与基线 spec 名单相符 |

## 7. §4.2-B7 验收点逐条对照

| 验收点 | 落地 | 证据 |
|--------|------|------|
| 双栏按坐标先左后右 | `pdfLayout` coverage-gutter 分栏：全宽行 band 分隔、段内 left→right；真实 liteparse 链路双栏 PDF 端到端断言 | pdfLayout「左栏文本全部先于右栏」+ documentParser「双栏固定样例」 |
| 无框线表格行列还原 | 列 x-start 聚类对齐 + 置信度命中率；行网格 + Markdown/CSV | pdfLayout「对齐的多行多列还原」「表格同时产出 Markdown 与 CSV 两态」 |
| 跨页表格合并补表头 | 页末表 + 次页页首对齐行吸收：重复表头丢弃、无表头续行、全局保留首表表头 | pdfLayout 跨页 describe 3 例 |
| 页眉页脚跨页重复检测剔除入 metadata | 顶/底带 + 数字归一化 key 跨页计数 → stripKeys 剔除 + `metadata.headersFooters` | pdfLayout 3 例 + documentParser 双页端到端 |
| 无文本层检测命中短路转 D 并提示 | `analyzePdfLayout` 双低判定 → `shouldUseDRoute('no-text-layer')` → `runDRoute`；降级 → `degraded` 显式提示上屏（附件 meta.error / KB 导入 error） | documentParser 无文本层 3 例 + attachments「空文本 + degraded 上屏」 |
| 本期无 OCR | liteparse `ocrEnabled:false` 保持；无 OCR 相关代码 | `grep ocrEnabled` 仅 false |
| 二-4② 触发条件显式（不全量烧 token） | `shouldUseDRoute` 三信号纯函数 + 正常文档 `runDRoute` 零调用断言 | pdfLayout shouldUseDRoute 5 例 + documentParser「正常文档不触发 D」+ attachments「no-config 不渲染不识读」 |
| 渲染选型有实测依据 | liteparse `screenshot()` Node 主进程实测（PNG buffer 返回）→ **不引 pdfjs-dist** | 本报告 §8.1 + research-pdf-multimodal §1.4 |
| 不支持 vision 降级 A 路线且明确提示 | `supportsVision` 前置 → `degraded reason:'no-vision'` 含模型名，不发任何请求；降级保留 A 文本 | multimodalParse「no-vision 降级」「降级保留 A 路线文本」 |
| 页数上限 + 并发 + token 成本估算 | `MAX_D_ROUTE_PAGES=10` 截断显式提示、`D_ROUTE_CONCURRENCY=2` 有界并发、`estimateDRouteTokens` 复用 `estimateImageTokens` | multimodalParse 截断/并发/成本 3 例 |
| 提示词要求结构化表格/数据 | `D_ROUTE_SYSTEM_PROMPT` 强制管道表格/禁评论感想，并入页 prompt | multimodalParse「识读提示词」断言 prompt 全文 |
| `.doc` D 路线优先（Q3 无 vision 提示另存为 docx） | `.doc` 有 userId 先 `runDRoute`（pageCount=0 全渲染截断）；不可用/降级 → 另存为 .docx 文案 | documentParser `.doc` 2 例（D 成功 / 降级文案）+ 无 userId 既有用例回归 |
| 二-6② `source_ref` 真实页码替代 60 字符近似 | `buildSourceRef(..., pageOffsets)` 二分 → `{fileName, page, offset}`；无 pageOffsets（md/txt）保留 line 兼容 | kbIndexer 5 例（含 INSERT 集成断言） |
| 表格 Markdown+CSV 两态 | `IDocumentTable.csv` + `rowsToCsv`；md/docx/xlsx/pdf/D 产物五处产出 | pdfLayout 2 例 + documentParser md/docx 2 例 + D 成功用例 csv 断言 |
| `parseVersion` 落库 | `DOCUMENT_PARSE_VERSION=2`（B7 版面细项契约）→ `parsed_attachments.parse_version` 默认写入；`structure_json.parseVersion` 双写 | attachments insert 断言 args[7]=常量 + structure.parseVersion |

## 8. 偏离与决策记录

1. **坐标与渲染选型：liteparse 全包，不引入 pdfjs-dist**（计划 §2-B7 允许"视选型可能新增 pdfjs-dist，评估体积"）。实测（2026-09-26 probe）：liteparse `textItems` 回传 `x/y/width/height/fontName/fontSize`（viewport top-left、72 DPI，`outputFormat:'text'/'json'` 均回传）；`screenshot(input, pageNumbers)` 在 Node 主进程返回 PNG buffer（单页 49~66KB，支持页码子集与全页）。结论：**坐标与栅格化零新增依赖，体积门禁（B10）零增量**，选型记录于此与 status.md。
2. **`.doc` 页数未知（`pageCount:0`）走"全渲染后截断"路径**：legacy .doc 渲染前无法得知页数，`runDRoute` 对 `pageCount<=0` 请求全页（native `screenshot(buf)` null 语义）再按 `MAX_D_ROUTE_PAGES` 收敛；实际 liteparse 对 .doc 大概率不支持转换 → `render-failed` → 另存为 .docx 文案（Q3 语义）。
3. **D7 数据变更点（计划 §3 未列，按 B7 变更清单补记）**：计划 §3 列 6 个数据变更点（D1~D6）未含 B7，但 §2-B7 明确「页码/章节/表格序号随产物落 `parsed_attachments`」——该表无可用列，按统一迁移纪律**追加第 7 个变更点 D7**：`structure_json TEXT DEFAULT NULL`（`addB7AttachmentStructureColumn` 独立函数，不动 B3/B4 已应用迁移，三断言测试齐备）。此为计划内部不一致的照实补齐，非红线冲突。
4. **`KB_PARSE_DOCUMENT` 扩展第 5 参 `options.userId`**：D 路线需读 `ai_config`（模型/vision 判定）。§1.3 三处同步硬规则约束的是**新增通道**，本变更为既有通道追加可选参数（preload 签名同步、renderer 3 个调用点传 userId、IPC 边界校验 options 形状）；无 options 时向后兼容（测试锁定）。
5. **既有断言调整 2 处（非删除）**：① `attachments.test` INSERT VALUES 断言 `?` 数 8→9（structure_json 追加列，参数化铁律断言保留且更强）；② `attachments.test`/`kbHandlers.test` 的 `parseDocument` calledWith 断言补 `undefined, { userId }`（签名扩展的预期行为）。另 `DOCUMENT_PARSE_VERSION` 升 2 后 `documentParser.test`/`weaveMDBridge.test` 字面量 `toBe(1)` 改引常量（防版本漂移）。全部为断言同步更新，无用例删除。
6. **无 pageOffsets 时保留 line 近似**：验收要求"真实页码替代 60 字符近似"针对二进制格式（源文档原文："对二进制格式不成立"）；md/txt 笔记无页概念，保留 line（既有消费方 `AIMessageBubble` 消费 line 跳转），但 60 字符近似仅存在于该兜底路径，PDF/附件/目录导入全链路均走真实页码。
7. **附件空文本的降级提示上屏**：`persistIncomingAttachments` 解析无文本时把 `parsed.degraded ?? parsed.error` 写入 `IAttachmentMeta.error`——无文本层/识读失败的显式提示随气泡三态展示（二-3②"给用户明确提示"的落点）。
8. **不放宽 `allowSend`**：D 路线发送页面图片给远程模型属用户显式上传文档的解析动作，与 B6 图片识别同口径（模型配置即许可，`needsConsent` 已停用）；未新增任何 consent/权限路径。
9. **`sanitizeStructure` IPC 边界白名单**：renderer 传入的 structure 按字段重建（pageOffsets 限长 100 万项 + 逐项有限数字校验），非法整体丢弃且不影响正文——不信任渲染层输入（SECURITY.md IPC 校验）。

## 9. 遗留（移交后续批次）

- D 路线多页输出**逐页独立识读**，页间跨页表格在 D 产物中不合并（A 路线 pdfLayout 有完整跨页合并）；如需 D 侧跨页上下文留后续批次。
- `KB_PARSE_DOCUMENT` 未传 userId 的调用方（如旧 mock）触发 D 时走 no-config 降级——行为正确但提示为"未配置"，renderer 各真实调用点已补 userId。
- 页眉页脚带内**单页独有**文本不剔除（跨页重复语义），仅出现一次的页码样式文本保留。
- E2E 存量 31 failed 与性能断言负载 flaky 不属本批次。
