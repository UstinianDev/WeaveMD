# agent-kb-ux — KB 可见性 + 导入授权 + 文件树复制路径 + 会话消息楷体 实施计划

> 需求与裁定（锁定）：`docs/requirements/agent-kb-ux/agent-kb-ux.req.md`（Q1=B / Q2=A / Q3 都加 / Q4 仅会话消息）
> 档位 **M**，TDD **standard**（RED→GREEN→精简证据）；行号基准：2026-10-03 实况，HEAD `90ba82d`
> 证据报告：`docs/testing/agent-kb-ux/agent-kb-ux.tdd.md`（配套，逐需求追加）
> 门禁：typecheck/test/lint 全绿；改渲染提交跑 `npx playwright test` 与 **31 例失败基线**同数同名零新增
> 铁律二不削弱；默认值 fail-closed（开关默认 false、授权默认不勾）

## 0. 行号核对（req vs 实况）

| req 引用 | 实况 | 结论 |
| --- | --- | --- |
| `agentStore.ts:339` 默认 false | 339 | ✓ |
| `agentStore.ts:1224` setUseKnowledgeBase | 1224 | ✓ |
| `agentStore.ts:688` 外发闸 | 685-691（688 条件） | ✓（块） |
| `agentStore.ts:688` 发送组装 | **1095-1111，useKnowledgeBase 在 1100** | **偏差（688 是闸非组装）** |
| `kbHandlers.ts:75-83` 文本导入 | 75-83（opts 无 consentGranted） | ✓ |
| `kbHandlers.ts:306-357` importDirAsKb | **306-358**，签名无 opts | ±1 |
| `kbHandlers.ts:367-407` 附件先例 | **367-408** | ±1 |
| `db/kb.ts:245-253` 白名单 | 245-253；`hasGrantedAttachmentDocs` **256-264** | ✓ |
| `db/index.ts:427` consent_granted 列 | 427（INTEGER DEFAULT 0） | ✓ |
| `kbIndexer.ts` indexImportedText | **606-645**，`KbIndexOpts.consentGranted` 在 **411**（字段已存在，**签名无需改**） | ✓ |
| `agentTaskWorker.ts:599-605` | **597-605** | ✓ |
| `fontConstants.ts:7` | 7 | ✓ |
| `AIPanelComposer.tsx` 发送区 | 控制条 564-721、Spacer 686、发送按钮 700-720、附件勾选先例 534-546 | ✓ |
| i18n `ai.agent.useKnowledgeBase` | zh-CN/zh-TW/en **:7 三语齐备** | ✓ **零补键** |

**偏差合计 2 处轻微**，其余全中。

## 1. 四项超预期实况发现（开工前须确认）

- **D1【阻断】`KnowledgeBaseSettings.tsx` 未挂载**：全仓无生产 import；`AIPanelSession.test.tsx:101` 断言「KB 开关已移除，不再显示 KnowledgeBaseSettings」。只改组件 → R3 勾选永远不可见、验收 3 不可达。
  **决策：`AIPanelSettings` 新增 `knowledge` tab 挂载它**（tab 标签复用孤儿键 `ai.agent.kbSettings`，零新键）；备选挂回 session 视图会击穿既有测试，不推荐。
  **实施前追加核实（2026-10-03）**：`AIPanelSession.tsx:5` 仍留「agent 模式显示 KnowledgeBaseSettings」过期注释；`AIPanelSettings.TABS` 现为 model/embedding/search/skills/mcp/personality，无 knowledge。
- **D2【阻断】两闸矛盾必须改 `agentStore.ts:688`**：`consent_granted` 两个消费点（`filterKbEgressResults` 白名单、`hasGrantedAttachmentDocs` 注入判定）都在 `allowSend=false` 分支内，而渲染闸让该状态发不出去 → 不改 688，R3 全链死码（req §2 根因 B「修 R2 后须一并消除」）。
  **决策：闸收窄为 `useKnowledgeBase && !allowSend && 无授权外发行`**；有授权行放行，外发收敛由主进程强制。安全性：`consent` 主进程从 DB 读（`agentTaskWorker.ts:300-302`），渲染不可伪造；`allowSend=false` 时 `filterKbEgressResults`（`kbSearch.ts:471-479`）只放白名单、异常空集合兜底 → 放行渲染闸零额外泄漏。零授权路径与今天逐字节一致（仍弹 ConsentOverlay）。
- **D3【阻断】`AIMessageBubble` 内联字体覆盖容器**：气泡根 **:499**、用户气泡 **:370**、编辑 textarea **:341** 内联普惠体；只给 AgentTab 加 class 消息文本仍不变（验收 5 不可达）。
  **决策：容器加 `.ai-message-stream` + 删除这 3 处内联 `fontFamily`**（AIMessageBubble 仅被 AgentTab 引用，影响面=消息流）；`AgentWorkflowCard:541/:691` 卡片字体不动（超范围）。
- **D4【必须】`hasGrantedAttachmentDocs` 需同步扩**：`kbSearchAllowed = kbEgressAuthorized || kbAttachmentEgressGranted`（`agentToolSelector.ts:73`，第 7 参来自 `agentContext.ts:663`）。只扩白名单 SQL → allowSend=false+导入授权时 **searchKB 仍不注入**，验收 1 不成立。
  **方案 A（推荐）**：两个 SQL 同扩 `source_type IN ('attachment','import') AND consent_granted=1`，**函数名保留**（改名连锁 9 个 `vi.mock('@main/db/kb')` 工厂缺导出），只改注释。副作用论证：`attachmentEgressAllowed`（`agentContext.ts:681`）可能变 true，但 `checkAttachmentEgress`（`searchDocument.ts:44-55`）①本会话豁免→②未授权拒→③**跨会话恒拒**，flag 只改报错文案；`tests/main/ai/docTools.test.ts:400-449` 8 格矩阵已锁 true/false 两态跨会话恒拒。
  **方案 B（备选）**：新增 `hasGrantedImportDocs` 拆两 flag（名实最正），代价 = 9 个 mock 文件各补 1 行（agentContext/agentLoopSplit/clarificationMatrix/chainReport/kbIntentBridge/subtaskParallel/subtaskSequence/subtaskConfirmResume/ipc）。

## 2. 逐需求实施

### R2 + 根因 A — useKnowledgeBase 开关接线（渲染）

> **⚠️ 本节方案已被 2026-10-03 热修覆盖（`542eb9f`）**：用户裁定 composer 勾选麻烦难看 → 删除 UI 开关，
> `useKnowledgeBase` 初值改 `true`（默认开启），发送闸改三态 `checkKbEgressGate`（空库/已授权/读取失败→allow；
> 有文档无授权→prompt）。以下原始 R2 方案保留为历史记录，实施状态以 `docs/testing/agent-kb-ux/agent-kb-ux.tdd.md`
> 「热修」章为准。

**变更清单**
- 修改 `src/render/components/AIAgent/panel/AIPanelComposer.tsx`：① :128 后加 2 个选择器 `useKnowledgeBase`/`setUseKnowledgeBase`；② 控制条「联网搜索」按钮后、`{/* Spacer */}`(:686) 前插入 `<label data-testid="use-kb-toggle">`（复用 :535-546 附件勾选结构 + `accent-[var(--accent)]`），`checked`/`onChange` 绑 setter，文案 `t('ai.agent.useKnowledgeBase')`，title 同键。最窄 260px，放左侧组；若走查拥挤，回退=紧邻发送按钮左侧（testid 不变）。
- i18n：**三语已齐备，零改动**；`agentStore.ts` **零代码改动**（:339 默认 / :1224 setter / :1100 传递链 / reset 归位均就绪）。

**实现要点**：只接 UI；开关**不持久化**（刷新回 false，fail-closed）。传递链核实表写入 tdd：`agentStore:1100` → `shared/ai/agent.ts:127` → `agentHandlers.ts:173` → `agentTaskWorker.ts:517/532` → `agentContext.ts:691` → `toolsForIntent` 第2参 → `agentToolSelector.ts:121/134/152/159` → `agentLoop.ts:325`。

**TDD**：RED `AIPanelComposer.test.tsx` +2 例（默认存在且 unchecked；点击 → `setUseKnowledgeBase(true)`，用 `vi.spyOn(getState())`，同 :416 模式）；RED `agentStore.test.ts` +1 例（allowSend=true → `runAgent(objectContaining({useKnowledgeBase:true}))`，对照既有 :687 false 断言；既有 :525 pendingConsent 用例必须继续绿）；组件无先例处记人工验证。

**风险回滚**：控制条拥挤 → 单文件 revert `AIPanelComposer.tsx`，setter 无调用方即等同关闭态；独立提交零牵连。

### R3 — 导入授权贯通 consentGranted + 两闸对齐（主进程+渲染）

**变更清单**
| 文件 | 修改点 |
| --- | --- |
| `src/shared/ai/kb.ts` | `KbImportDirRequest`:304-307 + `consentGranted?`；`KbImportFileRequest` 文本分支 :314-320 + `consentGranted?`；**`IKbDocumentStatus`:181-190 + 必填 `consentGranted: boolean`**（渲染闸数据源，D2） |
| `src/main/ai/ipc/kbHandlers.ts` | ① KB_IMPORT_FILE 文本分支 :70-83 仿 :63 先例 `consentGranted===true ? {consentGranted:true} : {}` 入 opts；② KB_IMPORT_DIR :93-103 透传 payload；③ `importDirAsKb(userId, folderPath, opts?)` :306-358 → `indexImportedText`:340-344 与 `recordImportFailure`:333/349 同口径透传 |
| `src/main/db/kb.ts` | :249 → `WHERE user_id = ? AND source_type IN ('attachment','import') AND consent_granted = 1`；:260 同扩；:195-232 `listKbDocumentsWithChunkCount` SELECT 加 `d.consent_granted AS consentGranted` + 类型 + map；两处注释改写（D4） |
| `src/render/stores/agentStore.ts` | ① :688 闸改写（D2）；② 新增 `hasKbEgressGrant(): Promise<boolean>` + 接口（:259-268 附近）；③ `triggerKbImportFile`:1555-1569 input 加 `consentGranted?` 并 spread；④ `triggerKbImportDir(folderPath, consentGranted?)`:1571-1578 |
| `KnowledgeBaseSettings.tsx` | `useState(false)` **默认不勾**；按钮行 :93-115 后插 `<label data-testid="kb-allow-egress">` + hint 行；`handleImportFile`:61-66 / `handleImportDir`:81 传值 |
| `AIPanelSettings.tsx` | `SettingsTab` +`'knowledge'`；TABS 插 `{key:'knowledge', label:'ai.agent.kbSettings'}`（embedding 与 mcp 之间）；内容区 + `<KnowledgeBaseSettings />`（D1） |
| i18n ×3 | 新增 `ai.kb.allowEgress`（允许外发/允許外發/Allow egress）、`ai.kb.allowEgressHint`（勾选后，未开启整体外发时仅已勾选文档可发给 AI / … / Only checked documents may be sent to the AI while global egress is off）；插入 `ai.kb.importDir`(:93) 前，三文件同位（键序测试会卡） |
| 注释 ×3 | `agentContext.ts:657-665`、`agentTaskWorker.ts:597-605`、`kbSearch.ts:463-479` 同步「授权集合含已授权导入行」（代码零改） |
| `preload.ts`/`weaveMDBridge.ts` | **零改动**（类型源自 shared；桥桩无参兼容） |

**实现要点**
1. 授权**只在 `===true` 时写**（仿附件先例 :63、tdd `doc-pipeline-b11.tdd.md:104`「漏传不撤销」）；纯导入走 INSERT（`db/kb.ts:84-91` 无 attachmentId/fileId 必新建行），`consentGranted ?? false` → 落 0（fail-closed），勾选才落 1；**不做「未勾=显式写 0」**，与既有撤销语义一致。
2. **渲染闸（D2）**：`if (useKnowledgeBase && !consent?.allowSend) { const granted = await get().hasKbEgressGrant(); if (!granted) { set({pendingConsent:true}); return; } }`；`hasKbEgressGrant`：userId 空→false；`await getKb().list(userId)`，`res?.success && Array.isArray(res.data)` 否则 false；顺带 `set({kbDocuments})` 复用刷新；谓词 `d.consentGranted===true && (d.sourceType==='attachment'||d.sourceType==='import')`（db/disk 笔记永不计入）；**全 try/catch fail-closed**。仅 KB 开且未整体授权时多 1 次本地 IPC；主进程过滤层仍是唯一强制点。
3. **白名单/注入（D4-A）**：两 SQL 扩 IN(...)；`filterKbEgressResults`、`needsKbSendConsent`、`consent.allowSend` 语义一律不动。
4. 数据链：勾选 → `triggerKbImport*` → IPC → `kbHandlers` → `indexImportedText(opts.consentGranted)` → `upsertKbDocument` → `consent_granted=1` → `kb.list` 回读 → 渲染闸放行 → `agentContext` 注入 searchKB → `agentTaskWorker.searchKb` 闭包 allowSend=false → 白名单只放授权行。

**TDD（矩阵 + SQL）**
1. RED `tests/main/db/kbDao.test.ts`：**既有 :397-403 断言改为 `source_type IN (?, ?)` / args `['u1','attachment','import']`（唯一预期改动的既有断言）**；新增 4 例：导入授权进集合/导入未授权滤除/附件授权回归/db 笔记 consent=1 也不进；`hasGrantedAttachmentDocs` 同矩阵。
2. RED `tests/main/ai/kbHandlers.test.ts`：`importDirAsKb(...,{consentGranted:true})` → `indexImportedText` 收到该键；不传 → **opts 无该键**；`getHandler(KB_IMPORT_DIR)` 透传；`KB_IMPORT_FILE` 文本分支带/不带（既有 :365 回归）；`recordImportFailure` 带授权标记。
3. RED `tests/main/ai/consent.test.ts`：注入矩阵补 **chat 意图**（任意组合不注入）；过滤矩阵补 granted 含导入 docId 放行/未授权滤除/allowSend=true 原样（既有 4+3 例不动）。
4. 回归锁（应零改动全绿）：`ipc.test.ts:1700-1727` 两闸接线、`docTools.test.ts:400-449` 8 格矩阵、`consent.test.ts:170-184`「needsKbSendConsent 只由 allowSend 决定」；新增 1 例：仅导入授权 + 跨会话附件 → 仍拒「不属于当前会话」。
5. RED `tests/render/stores/agentStore.test.ts`：kb.list 返回含 `{sourceType:'import',consentGranted:true}` → 放行且 `runAgent({useKnowledgeBase:true})`；`success:false`/`data` 非数组/抛错/空数组 → **一律 pendingConsent 且不调 runAgent**（fail-closed 三态）；既有 :525 用例（`kb.list` 默认 `vi.fn()` 返回 undefined → 走 fail-closed）天然仍绿。
6. RED `tests/components/knowledgeBaseSettings.test.tsx`：默认 unchecked；勾选导入 → `triggerKbImportFile` 收到 `consentGranted:true`；`kbDoc()` fixture 补 `consentGranted:false`（唯一 fixture 适配，tdd 单列）。

**风险回滚**：最高风险=688 闸改写；三层防线（零授权路径有测试锁 / DB consent 权威 / hasKbEgressGrant 全 catch）+ 单点 revert 4 行。SQL 零 DDL，`db/index.ts` diff 必须为空。评审否决 D4-A→切方案 B（+9 mock 行）；否决 D2→R3 UI 勾选仅剩附件链生效，需回 req 重裁。**D1/D2/D4 开工前确认。**

### R4 — 文件树右键复制文件地址（渲染）

**变更清单**
- **新建 `src/render/utils/copyPath.ts`**：`isAbsolutePath(p)`（复用 `agentHandlers.ts:130-132`：`/…`、`\\…`、`^[a-zA-Z]:[\\/]`）；`copyPathToClipboard(path): Promise<'copied'|'failed'>`（空/非绝对→failed；`navigator.clipboard` 缺失/抛错/reject→failed，**不静默**）。
- 修改 `ContextMenu.tsx`：Props + `onCopyPath`；「重命名」(:59-68) 与分隔线间插按钮（Icon `copy`，`t('sidebar.copyPath')`，**文件夹/文件均显示**——现 `isDirectory` 形参未用）；点击 `onCopyPath(); onClose();`。
- 修改 `FileTreePanel.tsx`：`copyNotice` state + 1.5s 自清（`CodeBlock.tsx:43-48` 先例，timer ref + unmount 清理）；`handleCopyPath(path)` → success/fail 提示；`:486-501` 传 `onCopyPath={() => handleCopyPath(contextMenu.nodePath)}`；渲染 `<div role="status" data-testid="copy-path-notice" className=…>`（**className 非内联 style**）。复制内容=`node.path`（`fileTreeStore.ts:303` 已归一正斜杠绝对路径）；既有重命名/删除不动。
- i18n ×3：`sidebar.copyPath`（复制文件地址/複製檔案位址/Copy path）、`sidebar.copyPathDone`（已复制路径/已複製路徑/Path copied）、`sidebar.copyPathFailed`（复制失败/複製失敗/Copy failed）；插 `sidebar.confirmDeleteFolder`(:380) 后，三文件同位。
- **toast 机制**：全仓无 toast 组件（已 grep：仅系统通知 + `MainPage.tsx:50 restoreNotice` 条 + CodeBlock copied 态）→ 最小可行=FileTreePanel 内联 `role="status"` 提示条，tdd 注明「无既有 toast、未引依赖」。

**TDD**：RED 新建 `tests/utils/copyPath.test.ts`（绝对/相对/空→failed；clipboard 缺失→failed；writeText reject→failed；成功→copied；jsdom 用 `Object.defineProperty(navigator,'clipboard',{…,configurable:true})`）；RED `tests/components/FileTreePanel.test.tsx` 补 3 例（contextMenu 出菜单[文件+文件夹]；点击→`writeText` 收绝对路径 + notice「已复制路径」；reject→「复制失败」）；既有 3 例原样全绿。

**风险回滚**：非绝对路径误复制 → `isAbsolutePath` 前置拒 + 失败提示；`ContextMenu` 新必填 prop typecheck 拦截（仅 1 使用方）。回滚=revert 2 组件 + 删 1 源文件/1 测试/3 键，零状态残留。

### R5 — 会话消息楷体（渲染）

**变更清单**
- 修改 `src/render/styles/globals.css`：新增 `.ai-message-stream { font-family: 'Consolas','KaiTi','楷体','STKaiti',system-ui; }`（与 `fontConstants.ts:7` 逐字一致 + 注释双向锚定；CSS 无法 import TS）。**禁止**改 `.editor-scroll-container`/`.outline-scroll`/`.chat-scroll`（chat-scroll 被 `AgentTab:285`、`AIAgentPanel:300` 历史视图、`AIPanelHome:88` 三处共用，动它=踩 home）。
- 修改 `AgentTab.tsx` :285 `className` 追加 `ai-message-stream`（唯一落点=消息流滚动容器）。
- 修改 `AIMessageBubble.tsx`（D3）：删 :341 textarea `fontFamily`（保留 `minHeight` 动态值）、:370 用户气泡整条 style、:499 根节点整条 style → 继承容器类。
- 不动：`AIPanelHome.tsx:87`、`AIAgentPanel.tsx:284/:300`、composer、各 settings 面板、`AgentWorkflowCard` 卡片字体。

**TDD（轻量）**：RED 新建 `tests/styles/agentMessageStreamCss.test.ts`（沿用 `tests/styles/ft2Css.test.ts` 的 `node:fs`+花括号配平，因 `vitest.config.ts css:false`）：断言 `.ai-message-stream` 存在且含 KaiTi+Consolas；断言 `.chat-scroll` **未被加 font-family**（防误伤 home）。RED `AgentTab.test.tsx`：`container.querySelector('.ai-message-stream')` 非空；气泡根**无 style/fontFamily**（:499 删除回归锁）。反向断言：home/composer 中该类计数 0（不便则记人工验证）。视觉核对：消息区 computed font 含 KaiTi、home/composer 不含。

**风险回滚**：祖先链已核实（`AIPanelSession:66` 与 `AIAgentPanel:264` 均无字体；自带内联普惠体的 history/home 视图不包含 AgentTab），安全。回滚=删 1 条 CSS + 还原 4 处，单提交 revert。

## 3. 变更清单汇总

| 需求 | 新建 | 修改 |
| --- | --- | --- |
| R2 | — | `AIPanelComposer.tsx` + 2 测试 |
| R3 | — | `shared/ai/kb.ts`、`kbHandlers.ts`、`db/kb.ts`、`agentStore.ts`、`KnowledgeBaseSettings.tsx`、`AIPanelSettings.tsx`、i18n×3、注释×3 + 4 测试 |
| R4 | `src/render/utils/copyPath.ts`、`tests/utils/copyPath.test.ts` | `ContextMenu.tsx`、`FileTreePanel.tsx`、i18n×3 + `FileTreePanel.test.tsx` |
| R5 | `tests/styles/agentMessageStreamCss.test.ts` | `globals.css`、`AgentTab.tsx`、`AIMessageBubble.tsx` + `AgentTab.test.tsx` |
| 文档 | `docs/plan/agent-kb-ux.plan.md`、`docs/testing/agent-kb-ux/agent-kb-ux.tdd.md` | `docs/TODO.md:242`、`docs/specs/knowledge/kb-indexing-egress.md:84-96`、`docs/specs/ai-agent/agent-tool-runtime.md:88-89/:105` |

**合计：新建 5（src 1 + 测试 2 + 文档 2）；修改 src 18（含 i18n 3、注释 3）；修改测试 9；文档同步 3~4 → 去重约 34~36 个文件。`src/main/db/index.ts` diff 必须为空（零 DDL）。**

## 4. 提交切分（推荐 5 提交，英文 type(scope): message）

1. R2 `feat(agent): wire useKnowledgeBase toggle into composer control bar`
2. R3 `feat(kb): thread import egress consent and align render/main egress gates`
3. R4 `feat(editor): add copy absolute path to file tree context menu`
4. R5 `feat(ai): apply editor kai font to session message stream only`
5. 文档 `docs(agent-kb-ux): record plan, tdd evidence and egress gate updates`

备选：R2+R3 合一 `feat(agent): wire kb toggle and thread import egress consent`（两者同触 `agentStore.ts`，可避免「开关已开但闸未对齐」中间态）；R4/R5 仍独立。**推荐 5 提交**（每步独立回滚）。每提交同步 tdd 证据（RED→GREEN→精简断言清单）。

## 5. 门禁与验收

每提交：typecheck 0 错 → test 全绿（既有零改动；**仅** `kbDao.test.ts:397-403` 白名单断言与 `knowledgeBaseSettings.test.tsx` fixture 属预期适配，tdd 单列）→ lint 0 error → 改渲染跑 playwright 对比 31 例基线同数同名。验收对照 req §3 六条；红线：不引依赖、不改迁移、`filterKbEgressResults`/`needsKbSendConsent`/0.6 拒答/`searchMode` diff 为空、铁律一二只强不弱。

## 6. 风险总表（按严重度）

1. D2 改渲染闸（R3）——三层防线 + 单点 revert；开工前确认。
2. D1 挂载 KnowledgeBaseSettings（R3）——可能被视为超范围，备选=会话视图（击穿既有测试）。
3. D4-A 扩 hasGrantedAttachmentDocs——名实小偏差，论证零放宽（docTools 8 格矩阵锁）；可切方案 B（+9 mock 行）。
4. D3 删气泡内联字体（R5）——影响面已核实仅消息流；revert 3 行。
5. i18n 键序一致性测试——新键三文件**同位插入**。
6. 每需求独立提交=独立回滚单元；R4/R5 与 KB 链零耦合可先行。

## 7. 文件树侧链路核查附记（2026-10-03，总指挥实测）

用户原话「目录文件树导入的文档 Agent 看不到」存在两义。**文件树侧链路已核实完整**：`agentStore:1081-1088` looseFiles+folders → payload.fileTreePaths → `agentPromptBuilder.buildLocalTreeSnapshot`（文件列表 + 「文件夹可用 listLocalDirectory 浏览」）→ 工具 `listLocalDirectory` 真实注册（`toolRegistry.ts:39/85/269`）+ `readLocalFile`。若用户指向文件树侧，则需另行实测复现而非按本计划 KB 链修复；本计划 R1-R3 针对 **KB 导入侧**（根因 A 开关断线已确诊）。
