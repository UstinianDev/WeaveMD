# doc-pipeline B3 — TDD 证据报告（strict）

> 创建：2026-09-26 | 批次：**B3（一-4 附件持久化与消息渲染）** | 强度：strict（RED → 最小实现 GREEN → 重构 → 覆盖率 → 门禁 → 提交）
> 来源：[计划](../../specs/knowledge/attachments-multimodal.md) §1/§2-B3/§3-D1-D2/§4.2-B3 / [需求](../../requirements/doc-pipeline/doc-pipeline.req.md)
> 权威需求源：`C:\Users\lenovo\Desktop\优化方向\优化方向.md` §一-4（拷问细节② = 验收点）
> 溯源声明：来源标注中的 `docs/plan/*` 为过程计划文档，已随计划退役（历史见 git），仅留溯源线索。

## 1. 测试范围

| 文件 | 类型 | 新增用例 | 覆盖项 |
|------|------|---------|--------|
| `tests/main/db/attachments.test.ts` | 新建 | 19 | DAO 参数化与归属过滤 6（INSERT OR REPLACE 全 `?`、get/remove 按 id+user_id、UPDATE 三式、list 按会话+user 正序）；`sanitizeIncomingAttachments` 边界 4（非数组/非法项丢弃、多余字段剔除、20 项截断）；**三态流转状态机** 9（有产物 pending→done、补解析 pending→processing→done、抛异常→error、errorResult 空文本→error、图片仅路径不走解析、data URL 转存 content、无产物无路径→error、非法项不断批、空载荷不触库） |
| `tests/main/db/migrations.test.ts` | 扩展 | +3 | **D1/D2 迁移三断言**（FakeDb 驱动真实 `addAttachmentColumns`）：态1 空库首建（3 列齐备 + DDL/DEFAULT 精确断言）、态2 旧库升级（仅 ALTER、无 DROP/DELETE/UPDATE、旧行保留）、态3 重复执行（第二遍零 ALTER 幂等） |
| `tests/main/db/aiDao.test.ts` | 扩展 | +2（改 1） | `appendMessage` 10 参顺序（原 9 参断言适配新列，非删除）；**attachments_json 白名单序列化**（thumb/content 不落消息表、JSON 不拼 SQL）；`mapMessageRow` 解析（正常 / 旧消息 NULL / 坏 JSON → undefined 向后兼容） |
| `tests/main/ai/ipc.test.ts` | 扩展 | +3 | AGENT_RUN 带附件：先 `persistIncomingAttachments` 落两表 → 元数据随 payloadJson 透传并回执；AGENT_RUN 不带附件不触落库（回归锁定）；AI_CHAT 带附件 → appendMessage 携带元数据 |
| `tests/components/aiMessageBubbleAttach.test.tsx` | 新建 | 9 | 气泡 chips（文件名/图标/done 无标记）、解析中 processing+pending、解析失败 error、图片 thumb data URL 缩略图、path → `media://` 缩略图（toImgSrc 契约）、无图源图标降级、**旧消息无字段不渲染**、空数组不渲染、正文只含占位符与 chips 并存 |
| `tests/components/composerPaste.test.ts` | 扩展 | +8 | `buildAttachmentSendText`：文件/图片只拼占位符（正文与 base64 绝不进正文）、多附件保序、无附件原文返回；`toAttachmentPayloads`：字段映射 + UTF-8 字节 size、可选字段省略、data URL 照传、保序 |
| `tests/render/stores/agentStore.test.ts` | 扩展 | +1 | `sendAgentMessage` 携附件：runAgent payload 的 message 只含占位符且 attachments 载荷随行、回执回填最终 parseStatus + 存活态 thumb 保留 |
| **合计** | | **45** | （= 全量 vitest 3325 − B2 基线 3280；另有 `scripts/attachments-migration-smoke.cjs` 真库四态，见 §6） |

## 2. RED（先写失败测试，实际执行）

```
$ npx vitest run tests/main/db/attachments.test.ts tests/main/db/migrations.test.ts \
    tests/main/db/aiDao.test.ts tests/main/ai/ipc.test.ts \
    tests/components/aiMessageBubbleAttach.test.tsx tests/components/composerPaste.test.ts \
    tests/render/stores/agentStore.test.ts
```

实际输出（2026-09-26 00:58）：

```
 Test Files  7 failed (7)
      Tests  24 failed | 104 passed (128)
```

失败构成（原始输出摘录）：

```
FAIL  tests/main/db/attachments.test.ts
Error: Failed to resolve import "@main/db/attachments" — Does the file exist?

FAIL  migrations > addAttachmentColumns 态1/态2/态3（3 条）
TypeError: addAttachmentColumns is not a function   （db/index.ts 尚未导出）

FAIL  aiDao > appendMessage binds ... in order
expected 9 args to equal 10 args                    （INSERT 尚无 attachments_json 列）
FAIL  aiDao > appendMessage 带附件：白名单序列化     — attachments_json 列不存在
FAIL  aiDao > mapMessageRow：attachments_json 解析   — 字段未映射

FAIL  ipc > AGENT_RUN 带附件：先落 parsed_attachments — persistIncomingAttachments 未被调用
FAIL  ipc > AI_CHAT 带附件：appendMessage 携带元数据  — 同上

FAIL  aiMessageBubbleAttach（7 条）— 组件无 attachments prop，chips/三态/缩略图全不渲染
FAIL  composerPaste > buildAttachmentSendText（4 条）— 模块无该导出（引用即失败）
FAIL  composerPaste > toAttachmentPayloads（4 条）  — 同上
FAIL  agentStore > sendAgentMessage 携带附件 — runArgs.attachments undefined
```

通过的 104 条为存量兼容项 + 新测试中的向后兼容断言（旧消息无 attachments 不渲染、AGENT_RUN 不带附件不落库等，旧实现本就满足）。

## 3. 最小实现 → GREEN（实际执行）

实现顺序：shared 类型（mention/conversation/agent + preload 返回类型）→ `db/index.ts addAttachmentColumns`（D1/D2）→ 新建 `db/attachments.ts`（DAO + 边界校验 + 三态状态机）→ `db/ai.ts appendMessage`（10 参 + 白名单序列化 + map 解析）→ 发送链路（agentHandlers/AGENT_RUN、chatHandlers/AI_CHAT、agentLoop/agentContext/agentTaskWorker 透传）→ 渲染层（pasteAttachment 纯函数、sendRoutes emitAgent、composer handleSend 占位符、agentStore 载荷+回填、AIMessageBubble chips、AgentTab 接线）→ i18n 三语。

```
$ npx vitest run <同上 7 文件>
 Test Files  7 passed (7)
      Tests  147 passed (147)          # 01:07

$ npx vitest run                       # 全量
 Test Files  2 failed | 141 passed (143)
      Tests  6 failed | 3319 passed (3325)
```

全量首跑 6 failed 构成与修复：

1. **AIPanelComposer 5 条**：`toHaveBeenCalledWith('文本')` 实收 `['文本', undefined]` —— composer 的 sendAgentMessage 包装函数恒传两参。修复：包装内无附件走单参调用（`emitAgent` 同理），保持既有契约。
2. **ab-test benchmark 1 条**（djb2 vs 模拟 MD5 性能对比）：与本批次无关的负载敏感 flaky，单独重跑 22 passed，全量重跑随批全绿（B2 报告同款记录）。

修复后全量：

```
$ npx vitest run
 Test Files  143 passed (143)
      Tests  3325 passed (3325)        # 01:19（B2 基线 3280 + 本批次 45）
```

## 4. 重构（不改行为）

1. **迁移入口抽 `addAttachmentColumns` 导出**：D1+D2 三条 `addColumnIfMissing` 聚合为单一可测函数（runMigrations 调用一次；DDL 与计划 §3 D1/D2 逐字一致）。偏离说明见 §8.1。
2. **`statusSeqOf` 测试辅助**：把「INSERT 的 parse_status（args[6]）/ UPDATE parse_status（args[0]）/ UPDATE content 的状态（args[1]）」统一抽为状态序列断言，取代散落的 args 位次判断。
3. **发送链路出口收敛 `emitAgent`**：三条 agent 对话路由（slash/kb/plain）统一经 `emitAgent` 透传附件，改写类路由不动 —— 消除三处重复的条件分支。
4. **既有 9 参断言适配为 10 参**：`aiDao.test.ts` 的 appendMessage 顺序断言随新列更新（测试保留，未删除）。

## 5. 覆盖率（新增代码）

```
$ npx vitest run --coverage \
    --coverage.include='src/main/db/attachments.ts' \
    --coverage.include='src/render/components/AIAgent/composer/pasteAttachment.ts' \
    --coverage.include='src/render/components/AIAgent/message/AIMessageBubble.tsx' \
    --coverage.reporter=text
```

实际输出（全量测试下，2026-09-26 01:19）：

```
File               | % Stmts | % Branch | % Funcs | % Lines
attachments.ts      |   93.3 |    91.52 |   88.88 |   93.3   （新建模块，≥80 达标）
pasteAttachment.ts  |   96.91 |    88.52 |      90 |   96.91  （B2 既有 + 本批次新增块）
AIMessageBubble.tsx |   64.52 |    59.67 |   23.07 |   64.52  （既有组件整体口径）
```

- 新建模块 `attachments.ts` 语句覆盖 **93.3% ≥ 80%**；`pasteAttachment.ts` 新增两函数全部覆盖。
- `AIMessageBubble.tsx` 整体 64.5% 为**存量未测分支**（编辑态/assistant 分支 handler 等，与本批次无关）；**本批次新增的附件块（chips/三态/thumb/降级/可选渲染）9 条用例全分支覆盖**（口径同 B1「新增代码 ≥80%」）。
- 未覆盖残留：`attachments.ts:253-256`（DB 层异常兜底分支 —— vitest 下 mock `getDatabase` 抛错注入成本高，状态机正常路径与错误路径均已覆盖）。

## 6. 质量门禁（全部实测）

| 门禁 | 命令 | 结果 |
|------|------|------|
| 类型检查 | `npx tsc --noEmit` | **exit 0，零错误**（TS strict） |
| 单元测试 | `npx vitest run` | **143 文件 / 3325 passed / 0 failed**（exit 0，2026-09-26 01:19；B2 基线 3280 + 本批次 45；过程中 ab-test benchmark 出现 1 次负载 flaky，单独重跑与全量重跑均全绿，存量问题非本批次引入） |
| Lint | `npm run lint` | **0 errors, 108 warnings**（与 B1/B2 基线完全一致的存量 warning；本批次新文件 `db/attachments.ts` 等单独跑 eslint 亦 0 error 0 新增 warning） |
| 构建 | `npx vite build` | **exit 0**（renderer + main + preload 三段全过） |
| E2E | `npx playwright test` | **31 failed / 1 skipped / 101 passed（133 条）** —— 见下方基线对照 |

### 数据迁移三断言（§3 统一纪律，双轨验证）

| 断言 | vitest（FakeDb 驱动真实迁移函数） | 真库（`npx electron scripts/attachments-migration-smoke.cjs`） |
|------|------|------|
| 空库首建 | ✅ 态1：3 列齐备 + DDL/DEFAULT 精确断言 | ✅ 态1：10/9 列终态、`parse_status DEFAULT 'done'`、`parse_version DEFAULT 1` |
| 旧库升级 | ✅ 态2：仅 ALTER、无 DROP/DELETE/UPDATE、行保留 | ✅ 态2：旧行留存，`attachments_json=NULL` / 旧附件行回读 `done`+`1` |
| 重复执行 | ✅ 态3：第二遍零 ALTER | ✅ 态3：幂等不抛错、列不重复 |
| 读写闭环 | ✅ DAO/状态机 SQL+参数断言 | ✅ 态4：attachments_json 写读一致、pending→processing→done、user_id 隔离 |

真库脚本退出码 0（2026-09-26 01:45 实测）；DDL 与补列定义**运行时从 `db/index.ts` 源码正则抽取**，与源码零漂移。双轨原因：系统 Node 无法实例化 better-sqlite3（实测 `new Database(':memory:')` 抛 `NODE_MODULE_VERSION 125 vs 127`），真库验证须走 Electron 运行时 —— 与 `kb-migration-smoke.cjs` 惯例一致。

### E2E 基线对照（验收口径：零新增失败）

1. 基线：**31 failed / 1 skipped / 101 passed（133 条）**（B2 收尾口径）。
2. 本次：**31 failed / 1 skipped / 101 passed**，数字完全一致。
3. **31 failed 名单构成与基线逐条同名单**（脚本抽取比对）：ai-agent-panel 恰 4 条（A2/A3/A4/①整块高亮选区改写）、drag-selection-markers 5、editor-table 7、feedback 5、floating-toolbar 2、thematic-break 2、exit-behavior 2、editor 1、image-resize 1、recent-history-restore 1、welcome-doc 1 = 31；**无任何附件/发送/composer/气泡相关用例失败**。
4. B2 的 4 条上传用例（多选折叠 / pickImage / 粘贴文件 / 粘贴图片）与全部发送链路用例（Agent 全流程、草稿发送、联网闸）**全部通过**。

## 7. B3 批次变更文件（32 个，见 commit）

**主进程（9）**：`src/main/db/index.ts`（D1/D2 迁移）、`src/main/db/attachments.ts`（新建 DAO+状态机）、`src/main/db/ai.ts`（appendMessage 10 参+白名单）、`src/main/ai/ipc/agentHandlers.ts`（AGENT_RUN 落两表+回执）、`src/main/ai/ipc/chatHandlers.ts`（AI_CHAT 落两表）、`src/main/ai/agent/agentLoop.ts` + `agentContext.ts` + `agentTaskWorker.ts`（attachments 透传→用户消息）、`src/main/preload.ts`（runAgent 返回类型）。

**共享类型（3）**：`src/shared/ai/mention.ts`（IAttachmentPayload 复用补字段 + IAttachmentMeta + AttachmentParseStatus）、`conversation.ts`（IAIMessage.attachments 可选）、`agent.ts`（AgentRunPayload/AgentRunEnqueueResult）。

**渲染层（9）**：`composer/pasteAttachment.ts`（buildAttachmentSendText / toAttachmentPayloads）、`composer/sendRoutes.ts`（SendContext.attachments + emitAgent）、`panel/AIPanelComposer.tsx`（handleSend 占位符化）、`stores/agentStore.ts`（载荷随行+乐观态+回执回填）、`message/AIMessageBubble.tsx`（chips/三态/缩略图）、`AgentTab.tsx`（接线）、i18n 三语 catalog。

**测试（7）**：新建 `tests/main/db/attachments.test.ts`、`tests/components/aiMessageBubbleAttach.test.tsx`；扩展 migrations / aiDao / ipc / composerPaste / agentStore 五处。

**脚本与文档（3）**：`scripts/attachments-migration-smoke.cjs`（新建真库四态）、`docs/architecture/database.md`（触及条目同步）、本报告；进度见 `docs/plan/doc-pipeline.status.md`。

## 8. 决策与偏离记录

### 8.1 D1 调用点与计划位置的偏差（记录，未静默）

计划 §3 D1 要求 `ai_messages.attachments_json` 补列「紧邻 :247-251 既有两行之后」。实际实现为**聚合导出函数 `addAttachmentColumns`（D1+D2 共 3 列），在 `addParsedAttachmentsTable(database)`（:266）之后调用**。原因：D2 的两列必须在 `parsed_attachments` 建表之后才能 ALTER，三条列合并到同一函数才能作为单一可测入口（迁移三断言单测的驱动对象）。**DDL 文本、`addColumnIfMissing` 幂等范式、追加式不改历史迁移 —— 与计划完全一致**；偏差仅在调用位置与组织形式。

### 8.2 附件正文回流通道与三态语义（一-4② 落地方式）

- `attachments_json` 只存 `[{id,type,name,path,size,parseStatus}]`（`db/ai.ts serializeAttachments` **白名单**序列化，thumb/content 剔除）；解析正文一律进 `parsed_attachments.content` —— 一物两表，消息表不膨胀。
- `content` 经 AGENT_RUN/AI_CHAT 的 `attachments[].content` 载荷回流主进程（B2 已在渲染层解析）。**主进程不重复解析已有 content 的附件**；仅对「无 content 但有本地路径的 7 格式文件」经 `parseWithLimit` 补解析 —— 这是 `processing` 态的真实来源（含 B2 解析失败附件的主进程重试）。
- 状态机：INSERT `pending` → （补解析先置 `processing`）→ `done`（写 content）/ `error`（异常、空文本产物、无产物无路径）。图片：data URL → content 转存 `done`；仅路径 → `done`（content 留空，**不把 base64 塞进消息表**，落盘/vision 随 B6）。
- 幂等键 = 附件 `id`：`INSERT OR REPLACE`，Agent 任务重试（AGENT_RETRY 复用 payloadJson）不产生重复行。

### 8.3 缩略图与存活态 thumb（渲染取舍）

`IAttachmentMeta.thumb`（data URL）**仅渲染层存活态**，主进程白名单序列化不落库：本会话粘贴图片即时可见缩略图；历史重载后 `path` → `media://` 缩略图（复用 `toImgSrc`，FeedbackModal 同款先例）；两者皆无 → 图标降级。历史粘贴图片（无 path）重载后无缩略图，**待 B6 落盘 `userData/attachments` 产出 path 后自然解决**（记录为遗留）。

### 8.4 乐观状态与回执回填

渲染层发送时按载荷写乐观 `parseStatus`（有正文 done / 仅路径 processing / 皆无 error）；AGENT_RUN 成功回执携带主进程最终元数据（`AgentRunEnqueueResult.attachments`），`sendAgentMessage` 用其**回填**本地消息并保留 thumb。失败路径（consent 拒绝等）保留乐观值，不阻断发送。

### 8.5 单参调用兼容（既有测试不破坏）

`emitAgent` / composer 包装函数在**无附件时保持 `sendAgentMessage(text)` 单参调用** —— AIPanelComposer 既有 5 条 `toHaveBeenCalledWith('文本')` 断言不受影响（首跑 6 failed 中的 5 条即此问题，已按此修复而非改断言）。

### 8.6 改写类路由不携带附件

选区改写 / `@文档` / 整篇写路由只拿到占位符文本，不透传附件载荷 —— 改写链路本身不消费附件内容（与 B3 前行为等价：此前这些路由也只拿到拼接文本）。如需改写场景附带附件，列入后续。

### 8.7 preload runAgent 返回类型修正（顺带类型债）

preload 原声明 `IpcResponse<AgentRunResult>`，实际返回 `{taskId, status}` —— 既有类型与实现不符。B3 引入回执字段时改为新建 `AgentRunEnqueueResult { taskId, status, attachments? }`，一并修正该旧问题（无运行时行为变化）。

### 8.8 计划测试清单的归属微调

计划写「扩 `tests/main/ai/ipc.test.ts` — appendMessage 带附件落库」：ipc.test.ts 将 `@main/db/ai` 整体 mock，无法断言真实 INSERT SQL。故**真实落库断言放 `tests/main/db/aiDao.test.ts`（fake prepare 捕获 SQL），ipc.test.ts 承担 handler 边界**（调用 persist、payloadJson 透传、appendMessage 入参）—— 计划列的两处各得其所，用例总数与断言强度不低于原要求。E2E 未新增用例（计划 B3 测试清单未含 E2E；气泡三态与占位符由组件/单元测试覆盖），门禁按基线口径执行。

## 9. 结论

**B3 完成。** TDD strict 全程：RED 7 文件 24 failed 实测在先 → 最小实现 GREEN（全量 143 文件 3325 passed）→ 重构 4 项不改行为；新增模块覆盖率 93.3% ≥ 80%；五门禁全绿（tsc 0 / vitest 0 failed / lint 0 error / build 0 / E2E 31f·1s·101p 与基线同名单零新增）；**迁移三断言双轨全过**（vitest FakeDb + Electron 真库 smoke 退出码 0，空库/旧库/重复/读写四态）。

验收点对照（一-4②）：attachments_json 只存轻量元数据 ✅ / 内容入 parsed_attachments 一物两表 ✅ / 正文只留占位符不打爆 CONTEXT_WINDOW=64000 ✅ / 迁移幂等且空库与旧版升级均可 ✅ / 旧消息无字段向后兼容 ✅ / 气泡 chips+缩略图+解析中/失败/完成三态 ✅。

**遗留**：历史粘贴图片（无 path）重载后缩略图待 B6 落盘；改写路由不携带附件（§8.6）；`attachments.ts` DB 异常兜底分支未单测（§5）。**下一任务：B4（四-3 批量导入通道）**。
