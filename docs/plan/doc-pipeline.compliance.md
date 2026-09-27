# doc-pipeline — 阶段 7 合规核对报告

> 核对对象：`git diff e223f78...feat/doc-pipeline`（161 文件，+24360 / −750，29 commits）
> 基线说明：**e223f78 为原始 main 位置**（main 现指 7d812b3 系执行期误快进，不作基线；用 7d812b3 会漏 B1~B4 前半段）
> 核对依据：`docs/requirements/doc-pipeline.req.md` §3｜`docs/plan/doc-pipeline.plan.md` §2/§4/§5｜`优化方向.md` §0/§附｜`CONVENTIONS.md`/`SECURITY.md`/`.claude/CLAUDE.md`
> 核对方式：只读审查，未改任何代码。本机实测门禁（2026-09-27）：`tsc --noEmit` 0 error；`eslint` 0 error（106 存量 warning）；`vitest run` **3780/3781 passed**（唯一失败 = `cacheMonitor` 性能断言，单跑 37/37 绿，各批次已记录的负载 flaky）；`vite build` exit 0。E2E 未复跑，基线口径见 §1-A。

---

## 1. 需求验收与红线逐条核对（req §3 / plan §4.1 / 源文档 §附）

| # | 条款 | 结论 | 证据（文件:行） |
|---|---|---|---|
| 1 | 29 任务按依赖顺序逐条实现 | ✅ 合规 | `docs/plan/doc-pipeline.status.md` 进度总览 8 模块 29 任务全完成；批次链 B1→B12 与 plan §1.1 依赖序一致；29 commits 逐批对应 |
| 2 | 质量门禁 5 项全绿（tsc/vitest/eslint/vite build/playwright） | ✅ 四项本机实测绿 / ⚠️ E2E 见 **A 项** | 见本节头部实测记录；E2E 各批 status 记录均为「31 failed 基线同名单、零新增」 |
| 3 | 新增行为同步 TDD 报告到 docs/testing/ | ✅ 合规 | `docs/testing/doc-pipeline-b1~b11.tdd.md` 共 11 篇（+1906 行）；B12 按计划以 PoC 量化报告 `docs/plan/doc-pipeline.docling-poc.md` 替代 |
| 4 | 进度同步 `doc-pipeline.status.md`（状态/证据/遗留/下一任务） | ✅ 合规 | status.md 每批次均有四段式记录 + 门禁实测数字 + 偏离记录 |
| 5 | 红线：体积 ≤1GB | ✅ 合规 | `scripts/sizeGate.mjs:15-17`（exe/msi ≤500MB、unpacked ≤1GB，超限 fail build）+ `postbuild` 自动执行；实测 Setup 99.16MB / unpacked 368.96MB |
| 6 | 红线：瘦身不改功能 | ✅ 合规 | 排除项全部落在 `package.json build.files`（纯打包层）；`tests/components/IconInventory.test.tsx` 132 项图标清单+视觉回归**先于**替换；`sizeGate.mjs:25-26` ASAR_REQUIRED 断言 `better_sqlite3.node` 防误伤；打包启动实测记录于 B10 TDD §7 |
| 7 | 红线：`allowSend` 不放宽 | ✅ 合规 | `src/main/ai/agent/agentContext.ts:302` 计算 `!needsKbSendConsent` 一字未动；`src/main/ai/consent.ts` **零改动**；外发唯一出口 `agentTaskWorker.ts:399-405` allowSend=false→过滤、查询异常→空集合 fail-closed；`kbSearch.ts:427 filterKbEgressResults` 纯函数；`consent.test.ts` 新增「无放宽路径」白盒穷举断言 |
| 8 | 红线：不删除测试 | ✅ 合规 | `--diff-filter=D` 全 diff 仅删 1 文件（`src/types/llamaindex-liteparse.d.ts`，伪造 shim，B1 TDD 记录，非测试）；tests 全为新增/扩展；无新增 `.skip`/`fixme`；被移除断言仅为 24→28 工具计数更新与 consent 用例内重排（断言集合不减） |
| 9 | 红线：不动已应用历史迁移 | ✅ 合规 | `src/main/db/index.ts` diff 仅两个纯追加 hunk（`@@ -265`、`@@ -312`），全部走 `addColumnIfMissing` / `CREATE … IF NOT EXISTS`；**零 DROP**（全 diff grep `DROP TABLE/INDEX/COLUMN` 零命中）；迁移三断言单测 + `scripts/*-migration-smoke.cjs` 真库四态验证 |
| 10 | §附纪律 1：决策基线不推翻 | ✅ 合规 | 14 条基线逐条核对：A+D 路线（B7）、7 格式（`ipc-handlers.ts:149-153`）、无 OCR（documentParser 零 tesseract）、文件树不扩格式（FileTreePanel 零改动）、图片落盘相对路径（B6）、图片向量不动、Docling 仅 PoC（`139aa6c` 仅 scripts/ 十文件） |
| 11 | §附纪律 5：每完成模块更新进度 | ✅ 合规 | 同 #4 |

### A 项（需主会话按裁定口径确认）：E2E 字面非全绿

- **事实**：Playwright 全量为 31 failed / 101 passed，**不是** req §3「全绿」字面态。
- **缓解**：31 failed 在基线 e223f78（前序 agent-cost-optimize 收尾）即为同名单，属已裁定接受态（执行者记忆 `e2e-baseline-known-failures` 在档；B1 曾用反证法证明 7 条失败与批次无关；此后每批均做名单比对零新增、不删不改这些测试）。
- **结论**：按项目既定「基线对照」口径 = 合规；按 req §3 字面 = 不达标。**收尾门禁措辞不得宣称「五项全绿」，应记「E2E 基线 31f 零新增」**；字面口径是否修订由主会话裁定。

---

## 2. 计划范围核对（plan §2 / §4.2 / §5）

### 2.1 批次变更清单（§2）——逐批结论

| 批次 | 结论 | 说明 |
|---|---|---|
| B1 解析入口 | ✅ | 结构化产物/xls 多 sheet/`.doc` 降级/`isSupportedDocument` 接线（择「接线」有记录）；渲染层调用方就位（`KnowledgeBaseSettings.tsx:57`、`AIPanelComposer.tsx:299/417`） |
| B2 上传接线 | ✅ | `ipc-handlers.ts:165-166` upload 模式只返回 paths 保序、**零全文读取**（readFileSync 仅存编辑器打开 :173 与 FILE_READ :447，均计划许可）；parseLimiter 限流；chips 折叠；pasteAttachment 双入口覆盖 |
| B3 持久化 | ✅ | D1/D2 追加式幂等；`attachments_json` 白名单轻量元数据；正文占位符（`AIPanelComposer.tsx:387`）；气泡三态 + 旧消息兼容 |
| B4 批量导入 | ✅ | `kbHandlers.ts:303/328` 先 `parseDocument`（限流）再入索引、fs 直读禁断言；失败 `status='error'`；D3 `attachment_id` + 删除清理链 |
| B5 检索接通 | ✅ | `kbIndexOpts(userId)` 真实配置贯通 3 入口；`vectorBackfill` 分批限速/防抖/模型切换过滤/失败可观测、期间 FTS5 可用（测试锁定）；heading_path 写入 + aggregate 生效验证；表格整表独立 chunk |
| B6 多模态 | ✅ | content 数组贯通全部调用点（rewrite/skillLoader 纯文本零改动有 TDD 记录）；Q4 保最近 3 张；图片落盘相对路径 + 事件回放净化；死代码三件接活 + 测试覆盖；无新增 IPC 通道（三处同步不触发，取舍记录） |
| B7 版面与 D 路线 | ✅ | pdfLayout 自研坐标分栏/无框线表/跨页合并/页眉页脚；`multimodalParse` 显式三信号触发、vision 降级提示、页数上限/并发/token 估算；source_ref 真实页码；**未引入 pdfjs-dist**（计划许可的选型分支） |
| B8 工具与引用 | ✅ | 四工具只读区 + handlerMap/defer/READ_ONLY/concurrencyDefs/意图分区全注册；陈旧工具名 src 零残留；citation 回链 + 新 IPC 三处同步（constants/preload/docs-08 齐）；四-4 前缀仅向量侧取舍记录；评测四项落地。**落点差异**：`toolResultStorage.ts` 计划「修改」实际零改动——`agentToolExecutor.ts:401/209` 既有泛化落盘（10k/40k）已覆盖 extract_table，验收结果等价 |
| B9 文件树 | ✅（偏离有记录） | FileTreePanel 计划「改发送构造」实测该组件只负责 openFile → 零改动，构造移至 agentStore+主进程（TDD b9 §8.1）；`FOLDER_READ` `.md` 过滤保持 + 注释 + docs/08 写明；mdImageResolver 越界拦截先于存在性检查 |
| B10 体积 | ✅（偏离有记录） | 21 条反向排除 + clean + sizeGate 双口径；monaco 运行时验证通过才剔除（Q5 出口执行）；react-icons 治理落打包层（具名导入本就按需，TDD §8.1）；`vite.config.ts`/`tokenizer.ts` 计划提及但零改动（无同步项/jieba 改走 build.files 排除），偏离均已记录 |
| B11 写控制 | ✅ | Q1「入 KB+过滤」三层落地取舍写明；注入矩阵现状锁定 + 勾选授权注入（测试矩阵）；Q2 默认勾选通道三处同步（`configConsentHandlers.ts:131-159` 载荷校验）；八-2 只记档不接线；八-3 删除常量 + docs/08:162 同步，src/preload/docs 零残留（含 ipc.test 递归零引用断言）；database.md 仅同步触及条目 |
| B12 Docling | ✅ | 量化四项有数据、结论=不达标按 Q6 关闭；依赖隔离在 `scripts/docling-poc/package.json`（主 package.json 零改动）；模型/pdfium 零进包；转正须重跑七-3 写死进报告 |

### 2.2 计划 §3 数据变更专章

✅ 全部走统一迁移纪律（追加式/幂等/禁 DROP/三断言）。
⚠️ **文档未回填**：§3 仍写「共 6 个数据变更点」，实际落地 **8 个**——D5b `kb_documents.consent_granted`、D7 `parsed_attachments.structure_json`。二者均有 §2 变更清单依据（B11「kbIndexer 记录勾选授权标记」、B7「页码/章节/表格序号随产物落库」）且 status/TDD 已记偏离，但 plan.md §3 数字未同步。🟢 LOW。

### 2.3 范围外清单（§5）——逐项确认未动

| 项 | 结论 | 证据 |
|---|---|---|
| OCR | ✅ 未动 | 全 src 零 tesseract 命中 |
| 图片向量（imageIndexer/images_vec） | ✅ 未动 | `imageIndexer.ts` 不在 diff；db 追加无 images_vec DDL |
| 拖拽上传 | ✅ 未做 | diff 中 `onDrop`/`dragover` 零新增 |
| write_mode 完整接线 | ✅ 未补 | 仅 `ai-agent.md`/`security.md` 记档 + title 提示（八-2 两件事） |
| xlsm/xlsb | ✅ 不做 | `documentParser.ts:29` 白名单注释 |
| 文件树扩格式 | ✅ 未动 | FileTreePanel 零改动 |
| Docling 转正 | ✅ 未转正 | `139aa6c` 仅 scripts/10 文件，主链零触碰 |
| 附件独立拒答阈值配置 | ✅ 未加 | B8 TDD §8.7 记录「只复核不新增」 |
| monaco 剔除（条件项） | ✅ 条件成立后执行 | Q5 验证通过才剔除——B10 TDD 双向闭环记录；§5 条件是「验证不过→作废」，不冲突 |

---

## 3. 项目规范核对

| 条款 | 结论 | 证据 |
|---|---|---|
| SECURITY：SQL 全参数化 | ✅ | 新增 SQL 全 `?` 占位；`vectorBackfill.ts:184` 的 `${where}` 为**静态常量串**（:181-183）非用户输入；`kb.ts`/`ai.ts` 扩展语句同为参数化 |
| SECURITY：无硬编码密钥 | ✅ | 全 diff 密钥模式 grep 零命中 |
| SECURITY：禁 `dangerouslySetInnerHTML` | ✅ | 全 diff 零命中 |
| SECURITY：IPC 校验来源与参数 | ✅ | 新 handler 均有载荷类型/非空校验 + user_id 归属反查：`agentHandlers.ts:77-106`（attachment:open-source 另有绝对路径 + 7 格式白名单防伪造 `.exe`）、`configConsentHandlers.ts:131-159`；路径解析 `mdImageResolver` 越界拦截先于读取 |
| SECURITY：用户敏感信息入日志 | ✅ | 新增日志仅 4 处 `console.warn`（`err.message` 级别）；事件回放存相对路径不存 base64；附件正文不进消息表 |
| CONVENTIONS：禁 `any` / `@ts-ignore` | ✅ | src 新增行 `: any`/`as any`/`@ts-ignore`/`eslint-disable` 全部零命中 |
| CONVENTIONS：禁内联 `style={{}}` | ✅ | render 新增行零命中 |
| CONVENTIONS：IPC try/catch、async/await | ✅ | 新 handler 全 try/catch 包裹，返回 `{success,…}` 信封 |
| CLAUDE.md：TS strict | ✅ | `tsc --noEmit` exit 0（本机实测） |
| CLAUDE.md：中文注释 | ✅ | 新增代码注释均为中文且无叙述性废话注释（抽查） |
| 死通道无第三种状态 | ✅ | `AGENT_UPLOAD_*` 仅存于 plan 引文；constants/docs-08/preload/src 四处同步删除/从未暴露 |
| N+1 查询 | ✅ | 回填 20/批批量读写、`insertChunksBatch` 批量、授权白名单单查询；目录导入按文件循环属业务必需且 chunk 层批量 |

---

## 4. 计划外改动清单（不在 plan §2 文件清单内）

| 文件 | 性质 | 处置建议 |
|---|---|---|
| `.claude/agent-memory/fullstack-detail-dev/*`（8 文件，经 `docs(memory)` commits 入库） | 执行者记忆，非产品代码 | 留否由主会话定；**本报告提交不含它们** |
| `scripts/attachments-migration-smoke.cjs`、`scripts/kb-attachment-migration-smoke.cjs` | 计划外新建验证脚本（plan §3 要求的三断言单测已另有，此为增强） | 保留（低风险、不进打包） |
| `docs/plan/doc-pipeline.research-*.md`（6 篇） | 阶段 2 调研产物，计划正文多处引用但不在 §2 文件清单 | 视为计划过程产物 |
| `tests/benchmarks/ab-test-suites.ts`、`agent-perf-benchmark.test.ts` | B6/B8 被迫适配（工具数 24→28、content 数组 mock） | 伴随必要改动，保留 |
| `sendRoutes.ts`、`agentPromptBuilder.ts`、`agentToolExecutor.ts`、`configConsentHandlers.ts`、`AgentTab.tsx`、`docs/architecture/{backend,knowledge}.md`、`docs/modules/11` | 计划目标内伴随落点/文档同步（citation 收集、D5 通道、24→28 工具数等） | 保留；无独立越界功能 |
| `scripts/docling-poc/{poc-result.json,out-*.md,sample*.json,sample.pdf}` | B12 PoC 证据产物（计划要求量化报告） | 保留（scripts/ 不进打包） |

**结论：无任何「与 29 任务无关的功能性改动」；计划外项全部为记忆/验证/伴随适配性质。**

---

## 5. 需修正项（交主会话，本报告不改代码）

| 级别 | 项 | 建议 |
|---|---|---|
| 🟠 | **A 项 E2E 口径**：req §3 字面「全绿」与基线 31 failed 的矛盾 | 收尾门禁按「基线零新增」措辞；是否修订 req §3 字面表述由主会话裁定 |
| 🟡 | `xlsx@0.18.5`（`package.json` 新依赖）存在已知 CVE（CVE-2023-30533 原型污染，npm 最新版即 0.18.5，修复版仅 SheetJS 官方源分发） | 跟踪升级至官方源 0.19.3+（需评估打包体积门禁）；不阻塞本次收尾 |
| 🟡 | `vitest run` 全量并行下 `cacheMonitor.test.ts:531` 性能断言间歇失败（单跑绿，非本分支引入） | 后续改为负载不敏感断言或重试机制；当前各批已按 flaky 记录 |
| 🟢 | plan §3「6 个数据变更点」未回填 D5b/D7（status/TDD 已记录） | 收尾时同步 plan §3 数字 |

---

## 6. 结论

**APPROVED WITH COMMENTS**（无 Critical；仅 1 项口径裁定 + 2 项风险跟踪 + 1 项文档回填）。
红线七项（体积/瘦身不改功能/allowSend/不删测试/不动历史迁移/基线不推翻/进度同步）全部通过；范围外九项零触碰；计划外改动无功能性越界。
