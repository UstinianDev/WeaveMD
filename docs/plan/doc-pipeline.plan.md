# doc-pipeline — 实施计划（8 模块 29 任务）

> 权威需求源：`C:\Users\lenovo\Desktop\优化方向\优化方向.md`（§0 决策基线 14 条 + 29 任务拷问细节，执行中不得推翻）
>
> ⚠️ **2026-10-01 核实：该桌面路径已被覆盖、原件全机 0 副本 → 以本仓库为准**（决策基线见 `doc-pipeline.status.md:31`，29 任务覆盖核对见本文「29 任务覆盖核对」段）。
> 需求文档：`docs/requirements/doc-pipeline.req.md`（Q1~Q6 执行级处置已吸收进对应批次）
> 现状核查：2026-09-25 按源文档行号抽查关键文件，结论见 §0（发现偏差照实记录，不修改代码）
> 规范约束：TS strict、Zustand v4、Tailwind；不给 any 风格建议；只实现需求内内容，不引入范围外"顺手优化"
> 执行纪律：每批次完成 = 5 项质量门禁全绿 + 新增行为 TDD 报告（`docs/testing/*.tdd.md`）+ 更新 `docs/plan/doc-pipeline.status.md`（状态/证据/遗留/下一步）

**分册（按需展开）：**

| 文档 | 内容 |
|------|------|
| [doc-pipeline.plan/01-batch-changes.md](./doc-pipeline.plan/01-batch-changes.md) | §2 每批次变更清单（B1~B12：任务映射、变更点、验收、TDD） |
| [doc-pipeline.plan/02-data-migrations.md](./doc-pipeline.plan/02-data-migrations.md) | §3 数据变更专章（D1~D8：迁移纪律与列定义） |

> 本文档保留 §0 现状核查与行号偏差、§1 执行批次与依赖链、§4 验收标准、§5 范围外清单、附录。
> §2/§3 原编号不变：TDD 与合规报告里的 `§2-Bx`、`§3-Dx` 引用，按上表到对应分册查找。

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
| 文档行号：`docs/modules/08-IPC通信机制.md:162`、`security.md:51+`、`database.md:134+`、`ai-agent.md:128+`、`docs/README.md:68-70` 门禁 | 全部属实 |
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

## 4. 验收标准

### 4.1 全局质量门禁（每批次完成的必要条件，`docs/README.md:68-70`）

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
