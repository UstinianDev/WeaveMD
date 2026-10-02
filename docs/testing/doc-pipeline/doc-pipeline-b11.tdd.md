# doc-pipeline B11 — TDD 证据报告（strict）

> 创建：2026-09-27 | 批次：**B11（八-1 外发同意闸 + 八-2 write_mode 核查 + 八-3 死通道清理）** | 强度：strict（RED → 最小实现 GREEN → 重构 → 门禁 → 提交）
> 来源：[计划](../../specs/knowledge/kb-indexing-egress.md) §1/§2-B11/§3-D5/§4.2-B11 / [需求](../../requirements/doc-pipeline/doc-pipeline.req.md) Q1/Q2
> 权威需求源：`C:\Users\lenovo\Desktop\优化方向\优化方向.md` §八-1/八-2/八-3
> 风险级：**L4（安全语义）**，已获用户二次放行；红线：**不削弱 `allowSend`（最高红线）**、不动历史迁移、不删测试、不用 `any`、范围外（write_mode 完整接线）不动、不推送远程

## 1. 测试范围

| 文件 | 类型 | 新增用例 | 覆盖项 |
|------|------|---------|--------|
| `tests/main/ai/consent.test.ts` | 扩展 | +11 | **八-1② 过滤行为矩阵**（allowSend × 勾选授权 × source_type 5 条）；**searchKB 注入矩阵**（toolsForIntent 第 7 参 4 条：现状锁定/勾选授权注入/既有不回归/useKB 前置）；**无放宽路径断言**（needsKbSendConsent 只看 allowSend、放行结果 ⊆ 授权集合白盒穷举） |
| `tests/main/db/migrations.test.ts` | 扩展 | +6 | **D5/D5b 迁移三断言**（空库首建 DDL+DEFAULT 精确 / 旧库升级只增不改 / 重复执行零 ALTER）——`upload_kb_default INTEGER DEFAULT 1`、`consent_granted INTEGER DEFAULT 0` |
| `tests/main/db/kbDao.test.ts` | 扩展 | +7 | `consent_granted` 写入方（INSERT 带/缺省、UPDATE 显式写/缺省不触碰）+ 过滤白名单读取（`getGrantedAttachmentDocIds` 参数化三条件、`hasGrantedAttachmentDocs` 有/无行、旧库行归一 false） |
| `tests/main/db/aiDao.test.ts` | 扩展 | +5 | D5 读写方（1/0/NULL/缺省/无行四态 GET、SET 参数化 UPDATE、UPDATE 0 行 INSERT 补建） |
| `tests/main/ai/kbHandlers.test.ts` | 扩展 | +8 | `importAttachmentAsKb` 勾选授权贯通（true 贯通 / 缺省不加键 fail-closed / KB_IMPORT_FILE payload 分派两态）；`importAttachmentsAsKb` 批量（file+done 入、图片与未解析跳过、未勾选不入、空载荷零调用） |
| `tests/main/ai/ipc.test.ts` | 扩展 | +11 | **八-3 死通道零引用**（递归扫 `src/**/*.ts(x)` + `docs/modules/08-IPC通信机制.md` 四种 token 形态）；D5 通道注册/GET/SET/非法载荷 4 条；**外发过滤接线**（allowSend=false 查授权集合+调过滤层 / true 不触发）；**发送链路 uploadToKb**（AGENT_RUN/AI_CHAT 勾选入 KB 带 consentGranted / 缺省与 false 不入） |
| `tests/render/components/AIAgent/AIPanelComposer.test.tsx` | 扩展 | +3 | 勾选 UI（无附件不显示 / 挂附件默认勾选 / 切换调 `setUploadKbDefault` 持久化） |
| **合计** | | **+51** | 全量 vitest 3730（B10 基线）→ **3781**；测试文件 161 → 161（无新建文件） |

**新增代码覆盖率**（`--coverage.include` 触碰文件口径，v8）：`kbHandlers.ts` 92.6% stmts / `kb.ts` 80.1% / `ai.ts` 79.0%（未覆盖行全为既有消息/会话 DAO 段）；新增函数级逐一直测（`filterKbEgressResults`、两迁移函数、两 DAO、两通道 handler、`toolsForIntent` 第 7 参、`buildAgentDeps` 闭包）——**新增代码段 ≥80% 达成**。

## 2. RED（先写失败测试，实际执行）

```
$ 2026-09-27 15:44
 npx vitest run tests/main/ai/consent.test.ts tests/main/db/migrations.test.ts \
               tests/main/ai/kbHandlers.test.ts tests/main/ai/ipc.test.ts
 Test Files  4 failed (4)
   Tests  27 failed | 105 passed (132)
     ← consent.test：filterKbEgressResults / toolsForIntent 第 7 参不存在
        （import 链失败 + 注入条件未扩）
     ← migrations：TypeError: addUploadKbDefaultColumn / addKbConsentGrantedColumn
        is not a function（导出不存在）
     ← kbHandlers：importAttachmentsAsKb 不存在；consentGranted 未贯通
        （opts 断言 undefined）
     ← ipc：AI_GET/SET_UPLOAD_KB_DEFAULT 通道未注册；死通道 token 仍在
        constants.ts:173-174 与 docs/modules/08:162（零引用扫描命中 5 处）
```

27 条失败全部为「新契约缺失」类（导出/通道/字段/文档行），105 条通过 = 存量行为回归基线。

## 3. 最小实现 → GREEN（实际执行）

实现顺序（每步后复跑相关文件）：

1. **D5/D5b 迁移**：`db/index.ts` 新增导出 `addUploadKbDefaultColumn` / `addKbConsentGrantedColumn`（`addColumnIfMissing` 幂等，追加在 B4 `addKbAttachmentColumns` 调用后）。
2. **过滤键数据层**：`db/kb.ts` 行映射 + `UpsertKbDocumentInput.consentGranted`（undefined=不改既有授权）+ `getGrantedAttachmentDocIds` / `hasGrantedAttachmentDocs`（参数化三条件，笔记永不入列）。
3. **索引贯通**：`kbIndexer.ts` `KbIndexOpts.consentGranted` → `indexImportedText` / `recordImportFailure` → `upsertKbDocument`。
4. **过滤层（Q1 核心）**：`kbSearch.ts` 纯函数 `filterKbEgressResults`（allowSend=true 原样 / false 收敛到授权附件、best 同步收敛）。
5. **外发唯一出口接线**：`agentTaskWorker.buildAgentDeps` 的 `searchKb` 闭包包过滤（allowSend=false 查授权集合；查询异常 → 空白名单 fail-closed）。
6. **注入矩阵**：`agentToolSelector.toolsForIntent` 第 7 参 `kbAttachmentEgressGranted`，4 处条件改 `useKnowledgeBase && (kbEgressAuthorized || granted)`；`agentContext` 计算 `kbEgressAuthorized = !needsKbSendConsent` **不变**，勾选授权存在性查询 try/catch fail-closed。
7. **勾选入 KB 链**：`kbHandlers.importAttachmentAsKb` 第三参 + `importAttachmentsAsKb` 批量 helper（file+done only）→ `agentHandlers.AGENT_RUN` / `chatHandlers.AI_CHAT` 消费 `uploadToKb`（fire-and-forget 不阻塞发送）。
8. **Q2 持久化**：`db/ai.get/setUploadKbDefault`（NULL→true 默认勾选、UPDATE 0 行 INSERT 补建）+ `configConsentHandlers` 两通道（载荷校验）+ preload 类型/暴露 + `weaveMDBridge` mock。
9. **渲染层**：`agentStore.uploadKbDefault`（初值 true、init 回读、setter 持久化、`runAgent` 载荷 `uploadToKb`）+ composer 附件区勾选 UI + 写模式开关 title 提示（八-2②）。
10. **八-3**：删 `constants.ts` 两死通道常量；`docs/modules/08` 删对应行 + 加 2 新通道行。

```
$ 2026-09-27 15:57（四文件复跑）
 Test Files  1 failed | 3 passed (4)
   Tests  1 failed | 131 passed (132)
     ← 唯一失败：死通道扫描命中 docs/modules/08:162（文档步未做）

$ 文档步后 → 2026-09-27 16:04（全量）
 Test Files  161 passed (161)
   Tests  3769 passed (3769)      ← composer +3 后
$ 16:08（补 DAO 测试）
 tests/main/db/kbDao.test.ts 24 passed / aiDao.test.ts 23 passed
```

## 4. 重构（不改行为）

- `importAttachmentAsKb` 内部索引 opts 变量更名 `indexOpts`（避免与入参 `opts` 混淆）；授权键 spread 收敛为「`!== undefined 才加键」单语义（漏传不撤销 / 缺省 fail-closed）。
- `toolsForIntent` 抽 `kbSearchAllowed = kbEgressAuthorized || kbAttachmentEgressGranted` 局部量，4 处共用（条件一致，防漏改一处）。
- 无行为变更；重构后 kbHandlers 35 / consent 16 复跑全绿。

## 5. 质量门禁（全部实测，2026-09-27）

| 门禁 | 命令 | 结果 |
|------|------|------|
| 类型检查 | `npx tsc --noEmit` | **0 错误**（首跑发现 weaveMDBridge mock 参数签名不符，已修） |
| 单元测试 | `npx vitest run` | **161 文件 / 3781 用例全绿**（B10 基线 3730 → +51，0 删除） |
| Lint | `npm run lint` | **0 error**（106 warning 均为存量 no-console/unused-vars） |
| 构建 | `npx vite build` | **成功**（10.96s renderer + preload；告警为存量 dynamic import 提示） |
| E2E | `npx playwright test` | **31 failed · 1 skipped · 101 passed（6.8m，rc=1）**——failed 数量与基线 31 精确一致；逐条核对 31 条全为存量类（editor-table / drag-selection-markers 当前 RED / feedback / exit-behavior / image-resize / thematic-break / welcome-doc / recent-history / floating-toolbar G1·E5 / ai-agent-panel A2·A3·A4·①），**零条涉及 upload/知识库/composer/勾选** → **零新增失败**（基线 31 failed 为既有裁定存量） |

## 6. Q1/Q2 取舍记录（八-1②「两条路都要写清」）

### Q1：入 KB 后按 `source_type` 过滤 vs 干脆不入 KB —— 选「入 KB + 过滤」

| 路线 | 权衡 |
|------|------|
| **不入 KB**（`allowSend=false` 时拒绝索引） | 语义最简单，但附件本地检索价值归零（知识库面板、`attachment_id` 关联、删除清理链全部空转），且与「勾选=该文档显式授权」正交——用户勾选了却什么都得不到 |
| **入 KB + 过滤（选定）** | 附件照常索引（`source_type='attachment'` + `consent_granted`），**本地检索价值保留**；外发口由 `filterKbEgressResults` 收敛：`allowSend=false` 时仅放行 `consent_granted=1` 的附件命中，笔记（db/import）与未授权附件一律滤除。纵深：即使注入闸（`toolsForIntent`）未来变化，过滤层仍兜底不放宽 |

**与现状交互语义（测试锁定）**：`kbEgressAuthorized = !needsKbSendConsent` 计算**一字未动**（无放宽路径断言）；`allowSend=false 且无勾选授权附件 → searchKB 整体不注入`（consent.test 矩阵第 1 条 = 现状锁定）；`allowSend=false 且存在勾选授权附件 → 注入`（第 2 条 = 八-1②「勾选=该文档显式授权，不追溯放宽其他笔记」），注入的结果经闭包过滤只剩授权附件。

**标注（如实记录）**：渲染层 `useKnowledgeBase` 为 Module 10 移除开关后的硬编码 `false`（B 类废弃特性，不得恢复），故 searchKB 注入矩阵在生产 UI 当前不可达——本批次落地的是**主进程安全语义层**（过滤/注入/授权标记三层契约），开关语义属既有废弃状态，不属 B11 范围。

### Q2：勾选默认值 —— 默认勾选，存 `ai_config.upload_kb_default`（D5）

- `INTEGER DEFAULT 1`（幂等补列，三断言）；GET 层 NULL/缺行/旧库一律收敛 `true`（Q2 默认勾选，与「勾选=显式授权」自洽）。
- UI：附件 chips 区「加入知识库」勾选（有附件才显示），toggle 即持久化（`AI_SET_UPLOAD_KB_DEFAULT`）；发送时 `uploadToKb` 随载荷传递，**勾选是入 KB 唯一触发**（未勾选零调用，fail-closed）。
- 授权边界：勾选授权写 `kb_documents.consent_granted=1`，**只作用于该附件文档**；历史笔记与其它附件不受影响（`getGrantedAttachmentDocIds` SQL 仅收 `source_type='attachment' AND consent_granted=1`）。取消勾选不追溯撤销已授权行（漏传不撤销——`upsertKbDocument` undefined 分支不触碰该列；撤销途径=删除附件→清理 KB）。

### D5b 偏离说明（计划 §3 未单列）

计划 §3 只列 D5（`upload_kb_default`），但 §2-B11 变更清单要求「`kbIndexer` 附件入 KB 记录勾选授权标记（供过滤键）」——过滤键需 per-document 存储，故追加 **D5b：`kb_documents.consent_granted INTEGER DEFAULT 0`**（同一 `addColumnIfMissing` 幂等范式、同三断言、追加式零 DROP、旧版不读无害）。此为计划文内部（变更清单 vs D 章）的缺口，按变更清单落地并在此记录。

## 7. 八-2 / 八-3 核查记录

### 八-2 write_mode（只做两件事）

- **差异如实记录**：`docs/architecture/ai-agent.md` 写控制表与写入工具表、`docs/architecture/security.md` 写控制表均已改为「设计意图 vs 实现现状」双列——`auto` 分支在主进程工具执行路径**无消费点**（仅 UI toggle + `AI_GET/SET_WRITE_MODE` 持久化）；`ai-agent.md` staleness `MD5` 表述**修正为 xxHash64**（`src/shared/utils/hashUtil.ts`）。
- **附件写路径 manual 确认语义**：核查 `toolRegistry`/`agent` 侧对 `importAttachmentAsKb`/`persistIncomingAttachments` **零引用**（grep 实测 rc=1）——附件/解析产物写入全部由用户显式动作（勾选+发送、设置页导入）触发，AI 工具集无触发点，天然 manual 语义；结论写入 `ai-agent.md`。
- **确认 UI 不空转**：Composer 写模式开关加 `title` 显式提示（auto=偏好预设、当前按手动语义执行）。
- `write_mode` 完整接线=范围外（标注后续不阻塞）。

### 八-3 死通道与文档同步

- 取「**删除常量**」（计划 §2-B11 已裁定：一-1/一-3 走 `DIALOG_OPEN_FILE`/`KB_PARSE_DOCUMENT`/`clipboard:read-image` 既有通道，接线无必要）：`constants.ts` 两行删除，`docs/modules/08-IPC通信机制.md:162` 对应行同步删除（不留第三种状态），零引用断言 = 递归扫全 `src/` 四种 token 形态 + IPC 文档。
- `database.md` kb_documents/kb_chunks 字段表与 `db/index.ts` 实际 DDL 对齐（含 B3/B4/B5/B11 全部补列），同步仅限该两表 + images_vec 注记（134-175 触及区间），未做全仓重构。
- `parsed_attachments` DAO 读写测试：B3 已建（`tests/main/db/attachments.test.ts`），本批未动；陈旧工具名：B8 已清——复核 `agentToolSelector`/`concurrencyDefs` 仅剩 concurrencyDefs.ts:32 的「已清理」历史注记，无任何实际引用。

### B10 遗留核查：打包形态 sqlite-vec 降级

**结论：降级路径可用，非本批次引入，不修。** 证据链：
1. `db/index.ts` 扩展加载 try/catch → 失败仅 `console.warn` 不阻断（`:29-37`）；
2. `kbSearchFts.vectorSearch` prepare 抛错 → 静默降级空 Map，检索走 FTS5+标题（`:84/:127`，B5 测试 `kbSearch.test` 已有「prepare 抛错→不抛」用例锁定）；
3. `vectorBackfill` 写 Float32 BLOB **不依赖扩展**（`vectorBackfill.ts:218` 注释：sqlite-vec 缺失时列仅存储、检索侧降级）；
4. `imageIndexer` vec0 虚拟表写入 try/catch 静默跳过（`:79/:112`）。
即打包形态 vec.dll 未映射时：回填正常写、检索降 FTS5、零报错——B10 记录的「疑似未映射」不影响功能，维持旧包既有行为。

## 8. §4.2-B11 验收点逐条对照

| 验收点 | 结论 | 证据 |
|--------|------|------|
| 八-1②：B+C 落地且取舍写明（入 KB + 按 source_type 过滤，Q1） | ✅ | §6 Q1 双路线取舍表；`filterKbEgressResults` + 授权标记数据链 |
| 八-1②：allowSend 不放宽（无新增放宽路径，测试断言） | ✅ | `consent.test` 无放宽 describe（needsKbSendConsent 语义不变 + 白盒穷举）；`kbEgressAuthorized` 计算未动；过滤层 fail-closed 双保险（查询异常→空集合） |
| 八-1②：勾选默认值与持久化落地（Q2 存 ai_config） | ✅ | D5 三断言 + `get/setUploadKbDefault` 5 用例 + 通道 4 用例 + composer UI 3 用例 |
| 八-1②：勾选=该文档显式授权、不追溯其他笔记 | ✅ | 授权集合 SQL 仅收附件授权行；注入矩阵 4 条（useKB 前置不放宽、笔记结果被滤） |
| 八-2②：文档差异如实记录（auto 无消费点、MD5→xxHash64） | ✅ | `ai-agent.md`/`security.md` 双列表 + MD5 行修正 |
| 八-2②：附件/解析产物写入按 manual 确认语义 | ✅ | 工具侧零引用 grep 实测 + `ai-agent.md` 结论记录；确认 UI title 提示 |
| 八-2②：不补完整接线；确认 UI 无空转误导 | ✅ | 范围外未动；title 显式提示 auto 现状 |
| 八-3②：`agent:upload:*` 删除且 08 文档同步（本计划取删除） | ✅ | 死通道零引用扫描用例（src 全递归 + 08 文档） |
| 八-3②：`parsed_attachments` DAO 有读写测试 | ✅（B3 既有） | `tests/main/db/attachments.test.ts`（B3 交付，本批复核未删未弱化） |
| 八-3②：陈旧工具名清理核对 | ✅（B8 既有） | `agentToolSelector.ts`/`concurrencyDefs.ts` grep `readFileRevision` 等零命中 |
| 八-3②：`database.md` 同步仅限触及条目 | ✅ | 仅 kb_documents/kb_chunks 两表 + images_vec 注记 |
| 门禁 5 项 | ✅ | §5（E2E 零新增失败口径见 §5/§9） |

## 9. 遗留（移交后续 / 非本批次引入）

- `write_mode` 完整接线（auto 分支主进程消费点、确认卡片+staleness 全链路）——计划 §5 范围外，后续不阻塞。
- 渲染层 `useKnowledgeBase` 硬编码 false（B 类废弃特性）使 searchKB 注入矩阵生产 UI 不可达——废弃裁定维持，不得借本批次恢复；主进程三层契约已就绪，开关如复用则行为由矩阵测试锁定。
- 打包形态 sqlite-vec 未映射（B10 记录，旧包既有）：降级可用已核实，不修；如未来要求打包内向量检索，转独立任务。
- E2E 存量 31 failed 与 `cacheMonitor` 负载 flaky 不属本批次（验收口径=零新增失败）。
