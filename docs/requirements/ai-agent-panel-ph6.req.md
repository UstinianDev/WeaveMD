# AI 代理面板 — 第 6 期收尾（KB 参数持久化 + stretch editBlocks）

> 模块：docs/modules/11-AI代理面板-Agent.md §7 | 状态：已对齐 2026-08-15
> 上一里程碑：第 5 期块级改写已交付，门禁全绿（docs/plan/ai-agent-panel.status.md 阶段 0-8）
> 范围裁定：**①KB 参数持久化（必交）优先；②stretch editBlocks agent 工具（精力够再做）；③真 MCP / GitHub skill 继续延**

## 1. 需求清单与验收标准

### ① KB 参数持久化（必交）

现状：KB 参数（topK/fuse/threshold/pinnedWeight/embeddingHost/embeddingModel）存 `agentStore.kbSettings`
**内存态**，刷新/重启丢失；主进程消费点两处不一致（KB_STATUS 探针硬编码 host/model；AGENT_RUN 只透传 fuse）。

目标：参数**持久化到 `ai_config` 表**，跨会话保持；主进程消费真实生效。

- **DB 迁移**：`ai_config` 加 6 列 `kb_top_k` / `kb_fuse` / `kb_threshold` / `kb_pinned_weight` /
  `kb_embedding_host` / `kb_embedding_model`（幂等 ALTER `ADD COLUMN IF NOT EXISTS`；不碰既有
  `CREATE TABLE IF NOT EXISTS`；`vectorEnabled` 不入列，保持运行态）
- **DAO**（db/ai.ts）：`AiConfigRow` / `AiConfigDbRow` / `AiConfigUpdate` / `upsertAiConfig` 扩展 KB 字段
- **IPC**：新增 `KB_GET_SETTINGS:'kb:get-settings'` / `KB_SET_SETTINGS:'kb:set-settings'`（preload `kb.getSettings`/
  `kb.setSettings`，payload `{userId}` / `{userId, settings}`，返回 `IpcResponse<IKbSettings>`）
- **渲染**：`agentStore.init` 并行拉持久化 kbSettings 初始化内存态（覆盖纯默认值）；`setKbSettings` 改为 **async
  持久化**（先写主进程成功再更新内存态；失败保留内存态不变 + 非阻塞提示）；SettingsModal Save 走持久化路径
- **主进程消费生效**：
  - 3a `KB_STATUS` 探针 host/model 改用持久化值（消除 `embeddingProbeHost()/Model()` 硬编码）
  - 3b `AGENT_RUN` 以持久化 kbSettings 为**默认兜底**（渲染未传/部分字段时补全 topK/fuse/threshold/pinnedWeight/
    embedding host+model），消除「只透传 fuse」不一致
  - 3c `kbIndexer` **不改**（`vectorEnabled` 仍 false，embedding host/model 消费点未启用，不为未启用能力改代码）

验收：
- 迁移幂等：新库建表 + 既有库加列均可，重复执行安全；回滚 = 删列（不动既有数据）
- 设置面板改 KB 参数 → Save → 重启应用 → 面板显示持久化值；Agent KB 问答实际用持久化参数
- `KB_STATUS` embedding 可用性探针反映持久化 host/model
- `AGENT_RUN` 未传 kbSettings 时主进程用持久化默认值；传了部分字段时未传字段用持久化兜底
- 铁律二不破：持久化 KB 参数与 consent（allowNetwork/allowSend）互不影响，同意页语义不变

### ② stretch — editBlocks agent 工具（精力够再并入；默认不做）

- **工具注册**：`toolRegistry.defineCoreTools()` 追加 `editBlocks`（schema `{block_ops:[{block_id,new_content}]}`）
- **当前文档上下文**：`AgentRunPayload` 增 `currentDocument?`（渲染侧传 `editorStore.content`），agentLoop 注入 `toolCtx`
- **执行语义**：`toolsForIntent` 在 `rewrite` 意图时提供 editBlocks；`executeTool('editBlocks')` 只**校验 block_id
  存在于当前文档** + 返回 **proposal JSON（只算不写，铁律一）** 作为 tool result 给 LLM；**不做**渲染侧
  proposal→预览卡片→确认 应用闭环（第 5 期既有管线职责）
- **断言改造**：`toolRegistry.test.ts` `WRITE_NAMES` 适配（editBlocks 移出「不含写工具」断言 + 新增
  「仅产 proposal 不落盘」断言）

stretch 验收（独立，与①互不阻塞）：
- `defineCoreTools` 含 `editBlocks` 且 `executeTool` 仅产 proposal 不落盘
- 铁律一：全程无写盘触发点（写仍仅第 5 期确认后 `updateContent`）

### ③ 非目标（本轮不做 / 继续延）

- 真 MCP server 管理（context7/firecrawl 拉起、fetchContext7/fetchFirecrawl 工具）——继续延
- GitHub 自取 writing-shape skill——继续延

## 2. 已对齐问题清单（grill-me 2026-08-15，全按推荐）

| # | 决策 | 结论 |
|---|------|------|
| Q1 | 持久化载体 | **ai_config 加 6 列**（幂等 ALTER）；不建独立 kb_settings 表；vectorEnabled 不入列 |
| Q2 | IPC 通道 | **独立 `kb:get-settings`/`kb:set-settings`**；不并入 ai:getConfig/setConfig（IAIConfig 保持后端/密钥语义） |
| Q3 | 生效范围 | 3a KB_STATUS 探针用持久化 host/model ✅；3b AGENT_RUN 以持久化 kbSettings 为默认兜底 ✅；3c kbIndexer 不改 |
| Q4 | 渲染持久化时机 | init 并行拉取；setKbSettings 改 async 持久化；**写失败保留内存态 + 非阻塞提示**（不静默吞掉） |
| Q5 | editBlocks stretch | 本轮**视精力**；最小边界=仅产 proposal 文本、无应用闭环；WRITE_NAMES 断言同步改造 |
| Q6 | 活验 | KB 持久化走 vitest 真库（in-memory better-sqlite3 验迁移幂等+读写）；editBlocks 若做则 DeepSeek 真验 agent 循环 |

## 3. 沿用设计（docs/modules/11 已定 + 第 5 期，不重复询问）

- 两条铁律：① AI 无直接落盘——写路径必经「红删绿增预览 → 用户确认 → `updateContent` 可撤销」；editBlocks 只产
  proposal 不落盘；② 联网/笔记外发必知情同意——KB 参数持久化不引入新外发，不触碰 consent 语义
- 既有链路复用：`agentStore.kbSettings`（agentStore.ts:81-82/148-155）+ `IKbSettings`（shared/ai.ts:208-221）+
  `AgentRunPayload.kbSettings`（shared/ai.ts:250-253）+ `kbSearch.ts` 默认值（kbSearch.ts:150-156）+
  SettingsModal 'ai' Tab KB 表单（SettingsModal.tsx:80-85/102-108/154-163）
- 主进程消费点：`ipc.ts` AGENT_RUN searchKb（ipc.ts:440-449）+ KB_STATUS probeEmbedding（ipc.ts:396）+ 硬编码
  `embeddingProbeHost()/Model()`（ipc.ts:588-593）
- 测试基建：tests/main/db/aiDao.test.ts FakeDatabase mock 模式（vi.mock better-sqlite3 + db/index）；
  tests/setup.ts window.weaveMD mock（kb.* 需补 getSettings/setSettings）；**迁移/真实 SQL 用 in-memory
  better-sqlite3**（Electron 运行时 SQLite 3.49 支持 `ADD COLUMN IF NOT EXISTS`）
- 活验 harness 模式：scripts/rewrite-smoke.cjs / agent-smoke.cjs（Electron 运行时 + esbuild + key 打码）

## 4. 风险与依赖

| 风险/依赖 | 影响 | 缓解 |
|-----------|------|------|
| 迁移幂等性 | 重复执行/升级中断 | 幂等 ALTER（IF NOT EXISTS）+ in-memory 真库测试「新库/既有库/重复执行」三态 |
| 参数消费不一致残留 | 持久化「搬家」但主进程仍读默认值 | 3a/3b 消费修正 + 测试断言（KB_STATUS 探针用持久化 host、AGENT_RUN 兜底） |
| 渲染初始化竞态 | init 拉取覆盖用户运行中改动 | init 仅启动时拉取；SettingsModal Save 显式写回（非 init 期间） |
| 写失败静默丢参数 | 用户以为保存了实际没存 | async 持久化 + 失败非阻塞提示 + 内存态不变 |
| editBlocks 文档上下文漂移 | agent 拿到的 currentDocument 过期 | payload 注入时快照 editorStore.content；仅作只读上下文，不落盘 |
| stretch WRITE_NAMES 冲突 | 断言失效 | 只在 stretch 完成时改，默认维持「无 editBlocks」 |
| 测试数回退 | 门禁不放行 | 全量 tsc/vitest/lint/build + Playwright ai-agent-panel 回归 |
