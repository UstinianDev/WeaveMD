# AI 代理面板 — 第 6 期收尾（KB 参数持久化 + stretch editBlocks）

> 模块：docs/modules/11-AI代理面板-Agent.md §7 分期 | 需求：docs/requirements/ai-agent-panel-ph6.req.md（Q1-Q6 已对齐）
> 范围：**①KB 参数持久化（必交）优先；②stretch editBlocks 视精力；③真 MCP / GitHub skill 继续延**
> 上一里程碑：第 5 期块级改写已交付，门禁全绿（docs/plan/ai-agent-panel.status.md 阶段 0-8）
> 铁律一（AI 无直接落盘）：KB 参数持久化是「用户设置持久化」（AI 无写盘能力），不触碰写路径铁律；stretch editBlocks 只产 proposal 不落盘。
> 铁律二（联网/外发知情同意）：持久化 KB 参数不引入新外发；KB_STATUS/AGENT_RUN 探针均为本机 embedding 探活，不新增 consent 语义。
> 当前分支：`feat/ai-agent-ph3-ph4`。

---

## 0. 技术调研结论（已读代码核实）

| 项 | 结论 | 来源/依据 |
|----|------|-----------|
| 持久化载体 | `ai_config` 表（db/index.ts:103-116）现无 KB 列；`CREATE TABLE IF NOT EXISTS` 对既有表不生效 → **新增幂等 ALTER**（SQLite 3.49 支持 `ADD COLUMN IF NOT EXISTS`），在 `runMigrations` 内单独 `database.exec(...)` 块执行，置于 `CREATE TABLE` 之后、`getAiConfig` 首次被调用之前 | db/index.ts:58-167 |
| DAO 读取是列无关的 | `getAiConfig` 用 `SELECT *` + `mapConfigRow` 显式字段映射（db/ai.ts:65-72/48-63），新增列不被显式读取；`upsertAiConfig` 用「全列明 UPDATE + 列齐全 INSERT」（db/ai.ts:89-131）→ **必须同步给 `AiConfigDbRow`/`AiConfigRow`/`mapConfigRow`/`AiConfigUpdate` 两处 SQL 补列**，否则 UPDATE/INSERT 不落 KB 值 | db/ai.ts |
| 主进程消费不一致点 | ① `KB_STATUS` probeEmbedding **硬编码** `embeddingProbeHost()/Model()`（ipc.ts:588-593 / :396）→ 改用持久化 host/model；② `AGENT_RUN` searchKb 只透传 `fuse`（ipc.ts:440-449），topK/pinnedWeight/threshold/embed 走 `o?.*` 或 kbSearch.ts:150-156 默认 → 以持久化为默认兜底；③ `kbIndexer` `vectorEnabled:false` 本期**不改**（embed 消费点未启用） | ipc.ts |
| searchKB 默认值 | `searchKB` 逐参 `opts.x ?? 默认`（kbSearch.ts:150-156）→ 只须在调用点补齐持久化值即可，kbSearch 本身不变 | kbSearch.ts |
| 渲染→主进程透传 | `sendAgentMessage` → `ai.runAgent({... kbSettings: get().kbSettings})`（agentStore.ts:394）→ `AgentRunPayload.kbSettings?`（shared/ai.ts:250-253）；`kbSettings` 为**可选字段**，主进程缺省时用持久化默认兜底 | agentStore.ts |
| 渲染持久化时机 | `agentStore.init`（agentStore.ts:164-177）当前并行拉 config/consent/convs → **并入 `kb.getSettings`**；`setKbSettings(settings)` 同步（agentStore.ts:438）→ **改 async 持久化**（先写主进程成功再更新内存态；失败内存态不变 + 非阻塞提示） | agentStore.ts |
| SettingsModal KB 表单 | 草稿 state（SettingsModal.tsx:80-85）+ 打开同步（:102-108）+ Save 写回 `setKbSettings`（:154-163，同步内存态）→ Save 改走持久化路径 | SettingsModal.tsx |
| IPC 通道现状 | constants.ts:96-102 已有 `KB_LIST/IMPORT_FILE/IMPORT_DIR/REINDEX/DELETE/STATUS`，无 settings 通道 | constants.ts |
| preload | `kb.*` 类型（preload.ts:132-143）+ 实现（:297-304）含 list/importFile/importDir/reindex/delete/status → **补 getSettings/setSettings** | preload.ts |
| 测试基建能力 | ① `tests/main/db/aiDao.test.ts` FakeDatabase mock（vi.mock better-sqlite3 + db/index）→ 断言 SQL 参数化/归属，**不能验真实迁移行为**；② **真实迁移/读写用 in-memory better-sqlite3**（`new Database(':memory:')` + mock `app.getPath`），不需要 Electron 原生模块，vitest 可直接加载（与 fts5-smoke.cjs 不同点：后者走 Electron 运行时是因 FTS5 + 系统 Node 模块版本不符；纯 `ADD COLUMN` + 基本 CRUD 的 in-memory 验证 vitest 内单线程可跑） | aiDao.test.ts / status.md |
| preload 契约漂移风险 | render 类型来自 `WeaveMDApi['ai']/['kb']`（agentStore.ts:24-25）→ 先锁 shared 类型 + preload 契约，B/D 依赖其落定 | preload.ts |
| stretch：toolRegistry 无写工具 | `defineCoreTools` 4 只读（toolRegistry.ts:50-110）、`executeTool` switch 无 editBlocks（:130-230）、`ToolCtx`（:40-48）、`WRITE_NAMES` 断言 toolRegistry.test.ts:15 | toolRegistry.ts |
| stretch：agentLoop 无文档上下文 | `toolsForIntent`（agentLoop.ts:91-106）按意图给子集；`toolCtx = {userId, searchKb, skill, skills}`（agentLoop.ts:171）无 currentDocument；`AgentRunPayload` 无 currentDocument 字段 → 需渲染侧随 payload 注入 + agentLoop 透传 toolCtx | agentLoop.ts |

> **实现期需注意（已核实代码、非改需求）**：
> - 迁移**顺序**：幂等 ALTER 必须放在 `runMigrations` 的 DDL `database.exec` 之后、任何 `getAiConfig` 调用前。当前 `upsertAiConfig` 的 INSERT 用**列齐全表**（db/ai.ts:108-126）——若 INSERT 缺 KB 列但分列默认值是 NULL，后续 `getAiConfig` 显式映射须给默认兜底；**建议 ALTER 全部带 DEFAULT**（见 §2）使既有 INSERT 用不到也无害，旧行回读时 mapConfigRow 对 NULL 给默认值。
> - `runMigrations` 内 `CREATE TABLE IF NOT EXISTS` 对**已建表**不再重跑，因此必须用独立 `ALTER ... ADD COLUMN IF NOT EXISTS`（不能靠改建表语句）；且对**新库**建表+ALTER 两段都要跑（ALTER IF NOT EXISTS 对新建的列是 no-op，幂等安全）。
> - DAO `upsertAiConfig` 现有 UPDATE 语句是**逐列显式**（非 `SET kb_top_k = COALESCE(?, kb_top_k)` 方式）——补 KB 列时须沿用「`update.kbX ?? existing.kbX`」模式保持「只改渲染传的字段、其余保留」语义；`AiConfigUpdate` 新增字段可选，缺省不回写。
> - `probeEmbedding` 读持久化 host/model 前，`getAiConfig` 可能返回 null（未建配置）→ 兜底 `http://localhost:11434` + `nomic-embed-text`（与原 `embeddingProbeHost()/Model()` 一致）。
> - `tests/setup.ts` `window.weaveMD.kb.*` mock 现无 `getSettings/setSettings` → 渲染侧测试若未补会 typecheck/运行时 undefined，必须随批次 1 补齐。
> - stretch 的 `currentDocument` 从 `editorStore.content` 快照注入，agentLoop 仅作**只读上下文**，不落盘（铁律一）。注意 `AgentReqPayload` 内部契约（agentLoop 用 `AgentReqPayload` 而非直接 `AgentRunPayload`，ipc.ts:433 做归一）——stretch 时确认要把 `currentDocument` 从 `AgentRunPayload` 途经 ipc 归一透传进 `AgentReqPayload`。

---

## 1. 变更清单

> 类型标注：新增 / 修改 / 复用。每行 = 一个可 diff 核对点。按「可并行拆模块」分组。**stretch（editBlocks）单列 D，默认不做**。

### A. 共享与类型（地基，必须先于 B/C）

| 文件 | 用途 | 增/删/改点 |
|------|------|-----------|
| src/shared/constants.ts（改） | 新增 settings 通道 | `IPC_CHANNELS` 增 `KB_GET_SETTINGS:'kb:get-settings'` / `KB_SET_SETTINGS:'kb:set-settings'`（置 `KB_STATUS` 之后，第3期 KB 区块内） |
| src/main/preload.ts（改） | 暴露 `kb.getSettings/setSettings` | `WeaveMDApi['kb']` 增 `getSettings(userId:string):Promise<IpcResponse<IKbSettings>>` / `setSettings(input:{userId:string;settings:IKbSettings}):Promise<IpcResponse<IKbSettings>>`（类型 :132-143 + 实现 :297-304 各加 2 项，`ipcRenderer.invoke` 对应通道） |
| src/shared/ai.ts（改） | 暴露默认值工厂 | 新增 `DEFAULT_KB_SETTINGS` 常量 + `normalizeKbSettings(partial?):IKbSettings`（合并 + 默认兜底），主进程 3a/3b 与渲染默认共用，避免双源真值 |
| 渲染桥（若有） | 补 `kb.getSettings/setSettings` noop | 实现期核实实际桥文件；无则不新建 |

> 判项：**A 必须先于一切**（shared 类型锁契约，preload + tests/setup 随批修正）。

### B. 主进程：迁移 + DAO + IPC + 消费修正（依赖 A，可独立并跑）

| 文件 | 用途 | 增/删/改点 |
|------|------|-----------|
| src/main/db/index.ts（改） | 幂等 ALTER 加 6 列 | `runMigrations` 内 DDL `database.exec` 后追加 `database.exec(KB_CONFIG_ALTER_SQL)`；导出 `KB_CONFIG_ALTER_SQL` 供测试/比对 |
| src/main/db/ai.ts（改） | DAO 扩展 KB 字段 | `AiConfigRow`/`AiConfigDbRow`/`mapConfigRow`（NULL 默认兜底）/`AiConfigUpdate` 增 6 字段；`upsertAiConfig` UPDATE + INSERT **两处补 KB 列**（沿用 `?? existing` 保留语义） |
| src/shared/ai.ts（改，A 组已含） | 默认值工厂 | `DEFAULT_KB_SETTINGS` + `normalizeKbSettings` |
| src/main/ai/ipc.ts（改） | 新增 2 通道 + 消费修正 | `KB_GET_SETTINGS`/`KB_SET_SETTINGS` 处理器；`KB_STATUS` probe 用持久化 host/model（空值兜底）；`AGENT_RUN` searchKb 用持久化 kbSettings 兜底合并；`embeddingProbeHost()/Model()` 若仅一处引用内联删除 |

### C. 渲染侧：store + SettingsModal + 测试基建（依赖 A，可独立并跑）

| 文件 | 用途 | 增/删/改点 |
|------|------|-----------|
| src/render/stores/agentStore.ts（改） | init 拉取 + setKbSettings 持久化 | `init` `Promise.all` 并入 `kb.getSettings(userId)`，成功覆盖默认（失败保留默认不阻塞）；`setKbSettings` 改 async（先写主进程成功再更新内存态；写失败保留内存态 + 非阻塞提示）；ADD `kbSettingsSaveState?: 'idle'|'saving'|'saved'|'error'` |
| src/render/components/Settings/SettingsModal.tsx（改） | Save 走持久化 | `handleSave` `setKbSettings(next)` 已 async 化；加保存中/失败提示绑定 `kbSettingsSaveState` |
| src/render/i18n/{en,zh-CN,zh-TW}.json（改） | 新增键 | 保存失败/已保存提示键（三文件键集一致） |
| tests/setup.ts（改，A 组已含） | mock 补 kb.getSettings/setSettings | — |
| src/render/stores/agentStore.test.ts（改） | init/持久化用例 | — |

### D. stretch — `editBlocks` agent 工具（默认不交付，精力够再并入）

| 文件 | 用途 | 增/删/改点 |
|------|------|-----------|
| src/shared/ai.ts（改，stretch） | editBlocks 载荷/结果类型 | `EditBlocksArgs {block_ops:[{block_id,new_content}]}`；`AgentRunPayload`/`AgentReqPayload` 增 `currentDocument?` |
| src/main/ai/toolRegistry.ts（改，stretch） | 注册 editBlocks | `defineCoreTools` 追加 editBlocks（schema `{block_ops}`）；`ToolCtx` 增 `currentDocument?`；`executeTool` case 'editBlocks'：校验 block_id 存在于 currentDocument（本地字符串校验）→ 返回 **proposal JSON `{applied:false, proposed:[...]}`**（只算不写） |
| src/main/ai/agentLoop.ts（改，stretch） | 注入 currentDocument + toolsForIntent | `toolsForIntent` rewrite 意图提供 editBlocks；`toolCtx.currentDocument`；`AgentReqPayload` 增字段透传 |
| src/render/stores/agentStore.ts（改，stretch） | 随 payload 注入 currentDocument | `sendAgentMessage` 载荷增 `currentDocument: editorStore.content` 快照 |
| tests/main/ai/toolRegistry.test.ts（改，stretch） | WRITE_NAMES 断言改造 | editBlocks 移出「不含写工具」断言 + 「仅产 proposal 不落盘 / block_id 不存在拒 / 无 currentDocument 拒」断言 |

> **判项**：stretch 完成才改 toolRegistry.test WRITE_NAMES；否则维持「无 editBlocks」断言（§7 stretch 验收各自独立）。

---

## 2. 数据模型 / 迁移方案

### 2.1 幂等 ALTER（新库 / 既有库 / 重复执行均安全）

在 `runMigrations` 的 DDL `database.exec(...)` 块之后、`database.exec(FTS5_MIGRATION_SQL)` 附近追加一段独立 exec。常量导出供测试比对：

```sql
-- exports: KB_CONFIG_ALTER_SQL
ALTER TABLE ai_config ADD COLUMN kb_top_k INTEGER DEFAULT 5;
ALTER TABLE ai_config ADD COLUMN kb_fuse REAL DEFAULT 0.5;
ALTER TABLE ai_config ADD COLUMN kb_threshold REAL DEFAULT 0.6;
ALTER TABLE ai_config ADD COLUMN kb_pinned_weight REAL DEFAULT 1.5;
ALTER TABLE ai_config ADD COLUMN kb_embedding_host TEXT DEFAULT 'http://localhost:11434';
ALTER TABLE ai_config ADD COLUMN kb_embedding_model TEXT DEFAULT 'nomic-embed-text';
```

> SQLite 3.49 的 `ADD COLUMN IF NOT EXISTS` 一次只加一列，因此**逐列一条** ALTER。**必须逐列带 `IF NOT EXISTS`**（既有库已有该列时幂等 no-op；新库建表后对同一新列再跑也是 no-op）。

### 2.2 迁移三态测试（in-memory better-sqlite3）

| 态 | 测试脚本模拟 | 断言 |
|----|--------------|------|
| 新库 | `new Database(':memory:')` + 建表 + ALTER 后 `PRAGMA table_info(ai_config)` | 含 6 KB 列，列默认值正确 |
| 既有库 | 先手工造一张「无 KB 列的 ai_config 表」→ 再跑 ALTER → 查 6 列 | 6 列已补、默认值正确、既有行留存 |
| 重复执行 | 对同一 in-memory 库跑两遍 ALTER_SQL | 第二次不抛错（IF NOT EXISTS no-op），列不重复 |

回滚方案：**删列不删数据**。SQLite 3.49 支持 `DROP COLUMN`，回滚 = 单独一条 `ALTER TABLE ai_config DROP COLUMN kb_top_k`（×6）+ 移除 DAO 字段 + 移除 IPC 通道。**回滚不自动执行**，作为 dev/升级降级路径文档化命令，backup 优先。

---

## 3. IPC 通道清单

沿用 `IpcResponse<T> {success,data?,message?,error?}`（shared/types.ts）信封。均为 invoke，不新增流事件。

| 通道（IPC_CHANNELS） | 方向 | 请求 | 响应 data |
|----------------------|------|------|-----------|
| KB_GET_SETTINGS:`kb:get-settings` | invoke（render→main） | `{ userId }` | `IpcResponse<IKbSettings>`；失败 `code ∈ AIErrorCode` |
| KB_SET_SETTINGS:`kb:set-settings` | invoke（render→main） | `{ userId, settings: IKbSettings }` | `IpcResponse<IKbSettings>`（写后回读） |

> 请求 `payload.userId` 供归属隔离（沿用 `getAiConfig(userId)`）。`KB_GET_SETTINGS` 无配置返回默认值（success:true，非错误）；`KB_SET_SETTINGS` 写库失败 → `{success:false, message, code}`。

---

## 4. 消费修正设计（主进程真实生效）

### 4.1 KB_STATUS 探针：持久化 host/model

```text
KB_STATUS handler（ipc.ts:396 改造）:
  row = getAiConfig(userId)
  host  = row?.kbEmbeddingHost  || 'http://localhost:11434'      // 兜底同原 embeddingProbeHost()
  model = row?.kbEmbeddingModel || 'nomic-embed-text'            // 兜底同原 embeddingProbeModel()
  probe = await probeEmbedding(host, model)
```

### 4.2 AGENT_RUN：持久化 kbSettings 为默认兜底（合并优先级）

合并语义（按 Q3）：**渲染 payload 显式字段 > 持久化 DB 值 > kbSearch 内置默认**。

```text
AGENT_RUN searchKb（ipc.ts:440-449 改造）:
  row = getAiConfig(userId)
  persisted = row ? { topK, fuse, threshold, pinnedWeight, embeddingHost, embeddingModel } : {}
  kb = { ...persisted, ...(payload.kbSettings ?? {}) }        // payload 整块覆盖持久化
  searchKb(u, q, { topK: kb.topK, fuse: kb.fuse, pinnedWeight, threshold, embeddingHost, embeddingModel,
                   vectorEnabled: o?.vectorEnabled ?? false })
```

### 4.3 kbIndexer

**不改**（`kbIndexOpts()` vectorEnabled:false 保留）。

---

## 5. 渲染侧设计

### 5.1 agentStore.init — 拉取时机与失败处理

- `init(userId)` 的 `Promise.all` 并入 `kb.getSettings(userId)`：成功 → `kbSettings = 持久化值`（覆盖默认）；失败 → 保留默认（不阻塞 init）。
- 竞态防护：init 仅登录时跑一次；SettingsModal Save 是显式写回（不在 init 期间），无覆盖窗口。

### 5.2 `setKbSettings` — async 持久化签名变化

```text
async setKbSettings(settings: IKbSettings):
  set({ kbSettingsSaveState: 'saving' })
  res = await kb.setSettings({ userId: get().userId, settings })
  if (res.success): set({ kbSettings: settings, kbSettingsSaveState: 'saved' })
  else: set({ kbSettings: settings, kbSettingsSaveState: 'error' })   // 保留内存态 + 提示
```

> 写失败**内存态更新**（Q4 语义）：不把内存态回滚到旧值，保持用户刚设的值；差异在 UI 提示「保存失败」。

### 5.3 SettingsModal Save + 5.4 i18n

- `handleSave` `setKbSettings(next)` 已是 async → Save 自然走持久化；绑定 `kbSettingsSaveState` 提示。
- `ai.settings.kb.*` 表单键已有；本期仅新增 1-2 个提示键（保存失败/已保存），三文件键集一致。

---

## 6. stretch 设计（默认不做，单列一节）

| 项 | 设计 |
|----|------|
| 工具注册 schema | `defineCoreTools` 追加 `editBlocks`（schema `{block_ops:[{block_id,new_content}]}`，required block_ops） |
| currentDocument 注入 | `AgentRunPayload.currentDocument?` → ipc 归一进 `AgentReqPayload` → agentLoop `toolCtx.currentDocument`；渲染侧 `sendAgentMessage` 载荷 `currentDocument: editorStore.content` 快照 |
| executeTool case | `case 'editBlocks'`：解析 block_ops；校验 block_id 在 currentDocument 中存在（字符串级）；currentDocument 缺失 → error；全部合法 → 返回 `{applied:false, proposed:block_ops}`（只算不写） |
| toolsForIntent | 意图 `rewrite` 时提供 editBlocks |
| WRITE_NAMES 断言 | 移出「不含写工具」断言 + 「仅产 proposal」断言 |
| 渲染确认闭环 | **不做**（第 5 期既有管线职责） |

---

## 7. 测试计划（TDD strict）

| 测试文件 | 关键用例 |
|----------|---------|
| tests/main/db/migrations.test.ts（**新**） | in-memory：新库/既有库/重复执行 三态；列默认值；非 NULL |
| tests/main/db/aiDao.test.ts（改） | upsertAiConfig 带 KB 字段 UPDATE/INSERT 含全部 KB 列；mapConfigRow 映射 + NULL 兜底；AiConfigUpdate 可选缺省不回写 |
| tests/main/ai/ipc.test.ts（改） | KB_GET/SET_SETTINGS 处理器注册；getSettings 无配置返回默认；setSettings 写后回读；user_id 隔离；KB_STATUS probe 用持久化 host/model；AGENT_RUN 持久化兜底/部分字段合并 |
| tests/render/stores/agentStore.test.ts（改） | init 拉取覆盖默认/失败保留默认；setKbSettings async 成功/失败路径 |
| tests/render/components/AIAgent/...（复用） | SettingsModal Save 触发 kb.setSettings（mock） |
| tests/main/ai/toolRegistry.test.ts（改，stretch） | editBlocks 注册 + 仅产 proposal / block_id 不存在拒 / 无 currentDocument 拒 |
| e2e/ai-agent-panel.spec.ts（改） | mock kb.getSettings/setSettings → 改参数 Save → re-mount → 持久化值；KB 问答用持久化参数 |

---

## 8. 验收标准（可逐条勾选）

**迁移幂等**
- [ ] 新库建表 + ALTER 得 6 KB 列且默认值正确；既有库加列成功、既有行留存；重复执行 ALTER 安全（in-memory 三态测试）
- [ ] 回滚方案已文档化（DROP COLUMN ×6 备份优先）

**设置面板持久化**
- [ ] 设置面板改 KB 参数 → Save → 重启应用 → 面板显示持久化值（getSettings 拉取覆盖默认）
- [ ] Save 走 `setKbSettings` async：先写主进程成功再更新内存态；写失败内存态保留 + 非阻塞提示

**主进程消费真实生效**
- [ ] `KB_STATUS` embedding 探针反映持久化 host/model（消除硬编码）
- [ ] `AGENT_RUN` 未传 kbSettings → 主进程用持久化默认值；传部分字段 → 其余持久化兜底；持久化也无 → kbSearch 内置默认

**铁律 / 安全**
- [ ] 铁律二不破：持久化 KB 参数与 consent 互不影响；本任务无新外发
- [ ] SECURITY：SQL 全参数化、IPC user_id 隔离、无 dangerouslySetInnerHTML、无 any

**质量门禁**
- [ ] npm run typecheck 0 error | npm run test 全绿 | npm run lint 0 error（8 warning 均既有）| npm run build pass
- [ ] Playwright ai-agent-panel spec 通过 + 原 14/14 回归全绿
- [ ] en/zh-CN/zh-TW 三文件键集一致无缺漏

**stretch（若做 editBlocks）**
- [ ] `defineCoreTools` 含 `editBlocks` 且 `executeTool` 仅产 proposal 不落盘；`WRITE_NAMES` 断言适配
- [ ] 铁律一：全程无写盘触发点

---

## 9. 依赖顺序（实现批次，可并行拆模块）

**起跑线（地基，先建测试基线，TDD）**
- **批次 1（A shared，必须先于一切）**：constants 增通道 + shared/ai.ts 增默认工厂 + preload kb.getSettings/setSettings 契约 + tests/setup 补 mock

**并行批——B 与 C 可双智能体并行**（B 依赖 A 类型 + DAO 现成；C 依赖 A 类型 + preload 契约；零交叉依赖）
- **批次 2（B 主进程）**：db/index.ts 幂等 ALTER + db/ai.ts DAO 扩展 + migrations.test + aiDao.test（改）+ ipc.ts 新增 2 通道 + KB_STATUS/AGENT_RUN 消费修正 + ipc.test（改）
- **批次 3（C 渲染侧）**：agentStore init 拉取 + setKbSettings async + SettingsModal Save 持久化 + agentStore.test（改）+ i18n 补键
- **批次 4（收尾）**：e2e 扩展（持久化闭环）+ 全量质量门禁（§8）+ 文档同步（模块 11 §7、SUMMARY、CLAUDE.md、本 status）

**stretch（单独，批次 3 后）**：toolRegistry 增 editBlocks + agentLoop toolCtx/currentDocument + render payload 注入 + WRITE_NAMES 断言适配，不做渲染确认闭环

> **并行核心**：批次 2（B）与批次 3（C）在批次 1 就绪后可双智能体并行。批次 1 必须先于所有。stretch 独立且默认不交付。
