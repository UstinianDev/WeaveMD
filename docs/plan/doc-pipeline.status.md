# doc-pipeline — 文档处理优化方向（8 模块 29 任务）执行状态

> 需求来源（唯一权威）：`C:\Users\lenovo\Desktop\优化方向\优化方向.md`
> 本文档随 devflow 各阶段持续追加。

## 阶段 0：任务分级（2026-09-25）

| 项 | 结论 |
|---|---|
| 分类 | 优化（功能开发 + 瘦身 + 安全语义延伸混合） |
| 任务 slug | `doc-pipeline` |
| 影响面 | 跨模块：主进程解析/IPC/DB 迁移、渲染层 Composer/气泡、知识库索引、多模态链路、打包配置、外发同意闸 —— 8 模块 29 任务 |
| 定档 | **L** |
| 裁剪理由 | 涉数据迁移（`attachments_json` 列、`parsed_attachments` DAO、`heading_path` 写入）、权限（`allowSend` 外发闸）、多模块多天 → 全流程：拷问（预对齐）→ 强制技术调研 → 规划 → 按序实现 → TDD strict → 全量门禁 |
| 质量门禁 | `tsc --noEmit` + `vitest run` + ESLint 0 error + `vite build` + `npx playwright test`（docs/README.md:65-67） |
| 分支 | `feat/doc-pipeline`（自 main 创建，WORKFLOW.md 第 1 步） |

### 执行顺序（依据优化方向文档 §执行纪律 4）

```
二-1 解析入口 → 一-1/一-2/一-3 上传接线 → 一-4 持久化 → 四-3 入库
→ 四-1/四-2 检索 → 五-1 多模态 → 二-4 D 路线 → 六 工具与引用
（七 体积、八 写控制 可并行穿插；二-5 Docling PoC 独立可停；二-6/三 随所属批次）
```

### 决策基线（不得推翻，摘自优化方向文档 §0）

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

**规划产出**：`docs/plan/doc-pipeline.plan.md`（386 行）
- 12 批依赖链 B1~B12，29 任务逐项对账、Q1~Q6 全落点，无遗漏无越界。
- 6 个数据变更点（D1~D6）+ 统一迁移纪律（幂等补列、空库/旧版三断言、禁止 DROP）。
- 行号偏差 3 处已记录（kbIndexOpts 归属 kbHandlers.ts、composer 未直接 readFileSync、handlePaste/Icon 实际行号）。

## 阶段 3~8：执行中

- **2026-09-25 计划已获用户放行**（选项：按计划全量放行；L4 批次 B6/B10/B11 执行前再次确认）。

### B1 完成（2026-09-25，commit `7056dcf`）

- **范围**：二-1 统一解析入口 + 二-2 xls/xlsx + 二-6 类型契约（TDD strict）。
- **状态**：✅ 完成。证据：`docs/testing/doc-pipeline-b1.tdd.md`。
- **交付**：`parseDocument` 返回结构化产物（headings/sections/tables/images/pageCount/parseVersion/degraded）；
  新增 `parseXlsx`（多 sheet→章节标题、`!merges` 还原、公式取缓存值、列宽归一防错位）；
  `parsePdf` 按实测适配 `LiteParse` API（`LlamaParseReader` 实测不存在，伪造 shim 已删）；
  `.doc` 按 Q3 降级（D 路线随 B7、无 OCR）；`isSupportedDocument` 接线进 `KB_PARSE_DOCUMENT`（取「接线」，理由见 TDD §8.2）；
  bridge mock 受控实现；依赖新增 `xlsx@0.18.5`。
- **门禁**：tsc 0 error / vitest 139 文件 3250 passed / lint 0 error（108 存量 warning）/
  vite build exit 0 / E2E 31f·97p·1s **与基线完全一致零新增**（反证实验：回退本批次渲染层 2 文件重跑失败子集同 7 条失败，TDD §6）。
- **遗留**：E2E 存量 31 failed 属前序已裁定范围，B1 不处理；`KB_PARSE_DOCUMENT` 的 composer/文件树真实调用方按计划随 **B2**。
- **下一任务**：B2（一-1/一-2/一-3 上传接线，依赖 B1 解析层）。

### B2 完成（2026-09-26）

- **范围**：一-1 格式白名单 + 一-2 多选批量 + 一-3 粘贴上传（TDD strict，含 Playwright E2E）。
- **状态**：✅ 完成。证据：`docs/testing/doc-pipeline-b2.tdd.md`。
- **交付**：`DIALOG_OPEN_FILE` 参数化双模式（`{upload:true}`：7 格式 + `multiSelections` + 返回 `{paths}` 保序 + 无 `readFileSync`；无参数：编辑器 `file.open` 保持 md 单选 + 全文——**双入口共享通道为计划未披露耦合，自检发现并修复，补 2 条回归锁定**）；preload `dialog.openFile` 类型/参数同步；新建 `parseLimiter.ts`（信号量，默认并发 3）并接线 `KB_PARSE_DOCUMENT`；`AIPanelComposer` 收路径数组逐个解析（单文件失败不断批）、chips >5 折叠「N 个附件」、粘贴换 `handleComposerPaste`（图片双兜底 + 7 格式文件分支 + 防重复插入，照 ContentBlock 范式）；新建 `composer/pasteAttachment.ts` 纯函数模块（覆盖率门禁所需，偏离记录见 TDD §8.1）；bridge 拆 openFile/uploadFile 两 mock + `pickImage` 恒 null → 受控返回；`KnowledgeBaseSettings` 契约波及伴随适配（取首路径走 `KB_PARSE_DOCUMENT`）。
- **门禁**：tsc 0 error / vitest **141 文件 3280 passed 0 failed** / lint 0 error（108 存量 warning）/
  vite build exit 0 / E2E **31 failed·1 skipped·101 passed（133 条）**——31 failed 与基线逐条同名单（脚本比对零 B2 失败），4 条新增用例全过，**零新增失败**。
- **遗留**：图片 data URL 仅内存 chips（落盘随 **B6**、正文占位符随 **B3**，批次边界见 TDD §8.4）；粘贴无 path 二进制文件跳过不断批（Electron `File.path` 正常走解析层）；E2E 存量 31 failed 不属本批次。
- **下一任务**：B3（一-4 附件持久化与消息渲染：`attachments_json` 幂等迁移 + `parsed_attachments` DAO + 气泡三态）。

## 进度总览

| 模块 | 任务数 | 状态 |
|---|---|---|
| 一 会话附件上传 | 4 | 一-1/一-2/一-3 完成（B2）；一-4 随 B3 |
| 二 文档解析层 | 6 | 二-1/二-2/二-6契约 完成（B1）；二-3/二-4/二-6落库 随 B7；二-5 随 B12 |
| 三 目录文件树 | 3 | 未开始 |
| 四 知识库/RAG | 4 | 未开始 |
| 五 多模态图片 | 3 | 未开始 |
| 六 工具与引用溯源 | 3 | 未开始 |
| 七 打包体积 | 3 | 未开始 |
| 八 写控制与外发同意 | 3 | 未开始 |
