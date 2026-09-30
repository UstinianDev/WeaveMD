# doc-pipeline — 文档处理优化方向（8 模块 29 任务）执行状态

> 需求来源（唯一权威）：`C:\Users\lenovo\Desktop\优化方向\优化方向.md`
> 本文档随 devflow 各阶段持续追加。

> **逐批执行记录已拆分**：阶段 3~8 的 B1~B12 完成记录（交付、门禁、偏离、遗留、提交）见
> [doc-pipeline.status/01-batch-records.md](./doc-pipeline.status/01-batch-records.md)。
> 本文档保留任务分级、需求对齐、技术调研、收尾阶段、遗留修复批次与进度总览。
> 各批 `B1~B12` 编号不变，正文中「Bx 完成」「阶段 3~8」的引用按上表到分册查找。

## 阶段 0：任务分级（2026-09-25）

| 项 | 结论 |
|---|---|
| 分类 | 优化（功能开发 + 瘦身 + 安全语义延伸混合） |
| 任务 slug | `doc-pipeline` |
| 影响面 | 跨模块：主进程解析/IPC/DB 迁移、渲染层 Composer/气泡、知识库索引、多模态链路、打包配置、外发同意闸 —— 8 模块 29 任务 |
| 定档 | **L** |
| 裁剪理由 | 涉数据迁移（`attachments_json` 列、`parsed_attachments` DAO、`heading_path` 写入）、权限（`allowSend` 外发闸）、多模块多天 → 全流程：拷问（预对齐）→ 强制技术调研 → 规划 → 按序实现 → TDD strict → 全量门禁 |
| 质量门禁 | `tsc --noEmit` + `vitest run` + ESLint 0 error + `vite build` + `npx playwright test`（docs/README.md:68-70） |
| 分支 | `feat/doc-pipeline`（自 main 创建，WORKFLOW.md 第 1 步） |

### 执行顺序（依据优化方向文档 §执行纪律 4）

```
二-1 解析入口 → 一-1/一-2/一-3 上传接线 → 一-4 持久化 → 四-3 入库
→ 四-1/四-2 检索 → 五-1 多模态 → 二-4 D 路线 → 六 工具与引用
（七 体积、八 写控制 可并行穿插；二-5 Docling PoC 独立可停；二-6/三 随所属批次）
```

### 决策基线（不得推翻，摘自优化方向文档 §0）

> ⚠️ 2026-10-01：源文件 `C:\Users\lenovo\Desktop\优化方向\优化方向.md` 已被《Agent Memory 优化方向》覆盖、原件全机 0 副本，**以下 14 条摘录是其现存唯一副本**。核对需求原文时以本文与 `docs/requirements/doc-pipeline.req.md` 为准，不要按该路径去找。

体积 500MB 目标/1GB 红线、解析路线 A+D、Docling 仅 PoC、本期无 OCR、7 格式清单、
文件树不扩格式、附件走 `parsed_attachments` + KB、图片落盘存相对路径、embedding 只接通文本侧、
外发闸 `allowSend` 不放宽、范围外项标 `后续（不阻塞）`。

### 索引状态（docs-cli）

已索引：electron、react、openai-api、tailwindcss、tiptap、zustand、commonmark、gfm…
待建（按任务需要）：better-sqlite3、mammoth、@llamaindex/liteparse、xlsx、pdfjs-dist、
@anthropic-ai/sdk、electron-builder（Phase 2 按需 scrape）。

## 阶段 1：需求对齐

- 优化方向文档已含全部 29 任务的「拷问细节」并锁定决策基线 = 预对齐完成，不重复拷问已锁定项。
- 需求文档：`docs/requirements/doc-pipeline.req.md`。

## 阶段 2：技术调研 + 规划（完成，2026-09-25）

**新建索引（docs-cli）**：liteparse(102)、mammoth(58)、xlsx(100)、better-sqlite3(2642/85URL)、
pdfjs-dist(110)、@anthropic-ai/sdk(107)、electron-builder(308) —— 全部 completed。
既有 openai-api 索引实为 Cloudflare 拦截页（**无效，待重建**）；已用 openai-openapi 权威源兜底。

**调研产出**（6 篇）：`docs/plan/doc-pipeline.research-{parse,pdf-multimodal,storage,chunking,packaging,tools}.md`
- crw search 后端不可用（本地 SearXNG 需 Docker / 公共实例超时 / Cloud 无 key），全部智能体改用
  crw scrape 直抓 + arXiv/官方文档/Bing 兜底并在各笔记中如实标注。
- 关键发现：LlamaParseReader API 在 liteparse 索引不存在（B1 需实测现状代码）；xlsx 不支持合并单元格
  （须自读 `!merges`）；pdfjs 官方 Node 栅格化示例可用；electron-builder 索引为 v26/v27 语义 vs 项目
  ^24.13.0 需实测；实测 better_sqlite3.node 仍在 asar 内未 unpack（与源文档假设不符，B10 高危核实点）。

**规划产出**：`docs/plan/doc-pipeline.plan.md`（拆分前 386 行；2026-09-28 按渐进式披露拆分后主文档 163 行 + 分册 2 篇）
- 12 批依赖链 B1~B12，29 任务逐项对账、Q1~Q6 全落点，无遗漏无越界。
- 6 个数据变更点（D1~D6）+ 统一迁移纪律（幂等补列、空库/旧版三断言、禁止 DROP）。
- 行号偏差 3 处已记录（kbIndexOpts 归属 kbHandlers.ts、composer 未直接 readFileSync、handlePaste/Icon 实际行号）。

## 收尾阶段（2026-09-27）

- **阶段 6 全量门禁** ✅：报告 `docs/testing/doc-pipeline.final.md`（commit 58d71d7）。tsc 0 / vitest 3781 全绿 / lint 0 error（106 warning 持平）/ vite build 0 / E2E 31f·1s·101p 与裁定基线逐 spec 一致零新增。覆盖率：新增 8 文件 lines 97.64%、改动 55 文件聚合 79.40%。
- **阶段 6.5 连通性** ✅：报告 `docs/plan/doc-pipeline.connectivity.md`（commit b52cbeb）。12 链路 ✅6/⚠️6/❌0 **无断裂**；风险 R1~R10（R1/R2=既有废弃开关不可达；R3 searchDocument 旁路；R4/R5/R6 图片回执 404/引用被拒/20 附件截断；R7/R8 删除清理休眠与孤儿行；R9 linux target 互斥；R10 AI_CHAT 休眠契约）——处置待需求方裁定。
- **阶段 7 合规** ✅：报告 `docs/plan/doc-pipeline.compliance.md`（commit 35180f7）。**APPROVED WITH COMMENTS，无 Critical**；161 文件 +24360/−750；红线七项全过；范围外九项零触碰。非阻断：xlsx@0.18.5 CVE 跟踪、E2E 措辞按裁定口径、cacheMonitor 负载 flaky（非本分支引入）。
- **阶段 8 交付核对** ✅：29 任务/12 批与计划变更清单对账无遗漏、无越界功能性改动；plan §3 数据变更点 6→8 已回填。**交付完成，未推送远程**（待用户授权）。

## 遗留修复批次（remedial，2026-09-27）

> 蓝图：`docs/plan/doc-pipeline.remedial.diagnosis.md`（commit aca71fd）；TDD 证据：`docs/testing/doc-pipeline-remedial.tdd.md`。
> 范围：Bug A（上传文件）、Bug B（上传图片）、R3~R8 遗留修复点；R1/R2/R9/R10 不在本批次（废弃开关/打包互斥/休眠契约，维持裁定）。

- **完成项（9 项，TDD strict 分项小步提交）**：
  - **Bug A**：A-1 附件清单注入 system 段（文件名+**绝对路径**+attachment_id+状态+searchDocument/readLocalFile 指引，`buildAttachmentManifest`）；A-2 附件消息即走 Agent 提示（chat 意图的「不要提及工具」不再锁死 searchDocument/ask_question_card，纯闲聊仍 CHAT_SYSTEM_PROMPT）——`4d0b07b`。
  - **Bug B**：D8 迁移 `ai_config.vision_override INTEGER DEFAULT NULL`（三态：NULL=自动/1=强制支持/0=强制不支持，幂等补列三断言）**且**扩展已知能力表（vision +glm-4v/minicpm 等、非 vision 显式负表）；未知模型**默认乐观注入**；`resolveVisionSupport` 统一注入（agentContext/chatHandlers）与识别（imageRecognition）三调用点；降级经 `IAttachmentMeta.error` 上屏（识别链回执/消息 + 注入链 appendMessage 前补写失败态），非仅 console.warn——`d6a7bef`。
  - **R3（L4）**：`ToolCtx.attachmentEgressAllowed = allowSend ∨ 勾选授权`（fail-closed）+ `resolveAttachmentTarget` 会话边界/外发双检（四工具共闸）——`442a028`。
  - **R4**：AGENT_RUN 回执图片 `resolveStoredPath` 转绝对（toImgSrc→media://，落库仍相对归一）——`76928e2`。
  - **R5**：open-source 先按 `isRelativeAttachmentPath` resolve 相对路径 + 图片扩展档放行（.exe/svg 仍拒）——`1a2070b`。
  - **R6**：渲染层发送前 `slice(0,20)`，`MAX_ATTACHMENTS_PER_MESSAGE`/`IMAGE_UPLOAD_EXTS` 抽 shared 单一来源——`925fe20`。
  - **R7**：消息级级联——`deleteMessagesAfter` 收集受影响 attachments_json 逐 id `removeParsedAttachment`（KB+图片一并清）——`db7e6f8`。
  - **R8**：会话删除先取 `listParsedAttachmentsByConversation` 再删会话行，逐 id 级联（`deleteConversationImages` 兜底保留）——`59b8bf6`。
- **诊断开放点裁定结果（三项，均按裁定执行零偏离）**：
  1. **R3**：本会话附件豁免、拦跨会话——当前会话用户主动上传且落库的附件不受 allowSend 拦截；跨会话/未授权一律 fail-closed（8 格矩阵 + fail-closed 断言见 TDD §2，跨会话 4 格恒拒、本会话 4 格恒放行）。
  2. **R7**：消息级级联（`deleteMessagesAfter` 内聚实现），**不做** chip 独立删除。
  3. **BugB**：D8 配置列（三态语义已记录）**且**扩展能力表；未知模型乐观注入由既有降级链兜底；降级提示用户端可见。附带遗留：设置页 vision 开关 UI 未做（裁定枚举未含 UI；`AI_GET/SET_CONFIG.visionOverride` 通道可读写）。
- **门禁**：tsc 0 error / vitest **3847 全过**（3788=剔除 2 个存量负载 flaky 后 160 文件 EXIT0 + 59=2 文件单跑；两次全量整跑 3837/3845 全绿实录）/ lint src 0 error（106 warning 持平）/ vite build exit 0 / E2E **31 failed·1 skipped·101 passed（133 条）与裁定基线逐 spec 同名单，零新增失败**。新增代码覆盖率：触及 16 文件聚合 78.35%（剔除既有 runMigrations DDL 的 db/index.ts 后 **87.5%**），新增行经 40+ 专属用例全覆盖（8 条定向补测）。D8 三断言 FakeDb 全过。
- **数据变更**：+1（D8 `ai_config.vision_override`，plan §3 8→9 已同步）。
- **偏离记录**：无功能性偏离；`ToolCtx` 字段按蓝图命名 `attachmentEgressAllowed`（任务书 "`ToolCtx.egession`" 为同一语义的简写）。
- **遗留**：E2E 存量 31 failed（基线口径）；`cacheMonitor`/`ab-test` 存量性能断言负载 flaky（单跑全绿，B4/B5/B6 已入档）；诊断 A-3（readLocalFile cwd 相对解析）与开放点 4（agentLoop anthropic 不分流）维持观察不动；vision 覆盖无设置页 UI。
- **提交**：`aca71fd`（蓝图）→ `925fe20`/`1a2070b`/`76928e2`/`59b8bf6`/`db7e6f8`/`442a028`/`4d0b07b`/`d6a7bef`（分项 fix）→ 收尾（覆盖补齐 tests + 本两份文档）。**未推送远程**（待用户授权）。

## 进度总览

| 模块 | 任务数 | 状态 |
|---|---|---|
| 一 会话附件上传 | 4 | **全部完成**（一-1/一-2/一-3=B2，一-4=B3） |
| 二 文档解析层 | 6 | **全部完成**（二-1/二-2=B1，二-3/二-4/二-6落库=B7，二-5=B12 PoC 不达标关闭） |
| 三 目录文件树 | 3 | **全部完成**（三-2=B5，三-1/三-3=B9） |
| 四 知识库/RAG | 4 | **全部完成**（四-1/四-2=B5、四-3=B4、四-4=B8） |
| 五 多模态图片 | 3 | **全部完成**（B6） |
| 六 工具与引用溯源 | 3 | **全部完成**（B8） |
| 七 打包体积 | 3 | **全部完成**（B10，2026-09-27，L4 已二次放行执行） |
| 八 写控制与外发同意 | 3 | **全部完成**（B11，2026-09-27，L4 已二次放行执行） |
