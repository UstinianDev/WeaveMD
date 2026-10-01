# Agent 自动记忆 — 读写工具与后台提取（SPEC-AGENT-MEM 分册 2/3）

> 规范编号：SPEC-AGENT-MEM-02 | 更新：2026-10-01
> 承载 [agent-memory.md](../agent-memory.md) 的读写工具与后台提取实现级行为契约（两工具、memoryWriter、IPC、向量写入）；返回索引：[agent-memory.md](../agent-memory.md)
> 关联需求：[agent-memory-optimize-2.req.md](../../../requirements/agent-memory-optimize-2.req.md)（Q7/Q8/Q9/Q10/Q11）、[agent-memory-optimize-3.req.md](../../../requirements/agent-memory-optimize-3.req.md)（Q6/Q9）
> 来源标记：〔plan-2〕= `docs/plan/agent-memory-optimize-2.plan.md` §6、〔plan-3〕= `agent-memory-optimize-3.plan.md` §6；过程证据见 `docs/testing/agent-memory-optimize-{2,3}.tdd.md`

---

## 1. `memory_read`（`src/main/ai/tools/memoryRead.ts`）

只读查询 `agent_memory` 当前有效行。与 `memory_write` 一同注册进 `toolRegistry`（`defer_loading: true`）、投放 `agentToolSelector` 基础区无条件给、`concurrencyDefs` 标 `memory_read: true`（并发表缺失则 fail-closed 串行）。〔plan-2 §6 C1〕

### 1.1 参数契约〔plan-2 §6 C1、plan-3 §6 D6〕

| 参数 | 契约 |
|---|---|
| `kind?` | 枚举校验 `profile\|fact\|entity`；**给了就必须合法**（传错立刻返回可自纠错误，不静默查空） |
| `subject?` | 主题精确匹配；与 `kind` 同时给出走 `getActiveBySubject`（`LIMIT 1` 只回最新一条） |
| `keyword?` | 关键词过滤，**TS 侧过滤不进 SQL**（杜绝 LIKE 值拼接）；对 `subject+content` 小写匹配 |
| `limit?` | clamp `1~100`，缺省 20 |
| `query?` / `queryVector?` | 语义检索通道（见 §1.3） |
| `hyde?: boolean` | opt-in 语义参数（见 §1.4） |

- 查询路径：有 `queryVector` → `searchMemories` 混合召回（`subject`/`keyword`/`kind` 仍作 AND 过滤）；否则 `subject+kind` 精确读或 `listActiveMemories` + 关键词过滤。〔plan-3 §6 D6〕
- 返回 `{count, total, items}`；**空结果 `status:'ok'` 不抛错**（记忆为空属正常结果）。〔plan-2 §6 C1〕

### 1.2 用户隔离

`ctx.userId` 恒进 SQL（`user_id = ?`），全读接口带 user_id 条件；工具内硬编码 userId 即破坏跨用户隔离。〔plan-2 §6 C1〕

### 1.3 消费混合召回

`queryVector` 非空时调 DAO `searchMemories`（融合与分流契约见分册 03 §1）；`subject`/`keyword` 在语义路径下仍作 AND 过滤（口径不变）。〔plan-3 §6 D6〕

### 1.4 `hyde` opt-in（D6.1 = Q9，裁定见 req-3 Q9）

- **三与触发**：`args.hyde === true && query 非空 && 未显式传 queryVector && ctx.generateHydeVector 存在` —— **缺一即零 embedding 成本**。〔plan-3 §6 D6.1〕
- 命名对齐 `searchKB` 的 `hyde: true`，复用**同一生成器**（`ctx.generateHydeVector`）与**同一份缓存**（`searchCache` 的 HyDE LRU 50 条 / TTL 10min）。〔plan-3 §6 D6.1〕
- `generateHydeQueryVector`：先读既有缓存 → 未命中才调生成器 → `parseQueryVector` 校验 → 写回缓存；**任何失败（null / 抛错 / 非有限分量）一律 `console.warn` 一条、返回 null、降级 FTS-only、不抛不重试**。〔plan-3 §6 D6.1〕
- 不传 `hyde` → 行为与 D6 交付逐字一致，既有用例零变化；JSON Schema 向后兼容（新参数可选）。〔plan-3 §6 D6.1〕
- 成本口径：每个**新** query 一次 LLM 假设文档 + 一次 embedding（10 分钟 LRU 兜底）；未配置 embedding 时生成器内部零 API 调用。〔plan-3 §6 D6.1 残余风险 ③〕

## 2. `memory_write`（`src/main/ai/tools/memoryWrite.ts`）

带 upsert 语义的记忆写入。`concurrencyDefs` 标 `memory_write: false`（串行）。〔plan-2 §6 C1〕

- **单轮上限**：`MAX_MEMORY_WRITE_PER_TURN = 10`（`agentToolPolicy` 本批不接线，req-2 Q8，故 handler 自限；**无实测数据、待校准**）。〔plan-2 §6 C1〕
- **参数校验**：`kind` 枚举 / `subject` 1~200 / `content` 1~4000（对齐设置页 `memory.md` 的 `recommendedChars`）。〔plan-2 §6 C1〕
- **fingerprint** = 归一化 content 的 sha256（DAO 短路语义见分册 01 §3.1）。〔plan-2 §6 C1〕
- **单轮状态挂 `WeakMap<ToolCtx>`**：`prepareAgentContext` 每次 `runAgentFlow` 新建 toolCtx，天然按任务隔离，不改 `toolTypes.ts`；同轮同 `kind+subject` 只留一条（回执 `duplicate_in_turn`，**先到先得**）、达上限拒绝、manual active 行零写入回执 `manual_override`。〔plan-2 §6 C1〕
- **写入恒 `source:'auto'`**（LLM 传入的 source 被忽略）。〔plan-2 §6 C1〕
- **不进 `FORCE_CONFIRM_TOOLS`**：铁律一仅约束笔记写入，记忆写入不经逐条确认（红线见 req-2 §五 2），也不发 preview 卡片。〔plan-2 §6 C1、req-2 红线 2〕
- 写入成功后触发 `runMemoryPolicy`（编排见分册 01 §5.2）。〔plan-3 §6 D2〕

## 3. 后台提取（`src/main/ai/agent/memoryWriter.ts`）

### 3.1 常量（均无实测数据、待校准）〔plan-2 §6 C2〕

| 常量 | 值 | 语义 |
|---|---|---|
| `MEMORY_EXTRACT_MIN_ROUND_GAP` | 2 | 同会话节流：与上次入队轮次间隔 |
| `MEMORY_EXTRACT_ROUNDS` | 3 | 读取最近轮数（工具轮不进提示词；不改 `KEEP_RECENT_ROUNDS`） |
| `MAX_MEMORY_EXTRACT_ITEMS` | 10 | 单次提取条数上限（超出 `console.warn` + 截断） |
| `MEMORY_EXTRACT_TIMEOUT_MS` | 30000 | 任务超时 |

### 3.2 任务契约〔plan-2 §6 C2〕

- **`maybeEnqueueMemoryExtraction(deps, ctx)`**：**同步返回普通对象（非 thenable）、绝不抛、不在此调 LLM**；判定顺序 = 节流 → 同会话 pending 去重 → 入队；`try/catch` 收敛全部异常 + `console.error`。
- **`parseExtractionItems(raw)`**：严格校验（数组 / `kind` 枚举 / `subject` 1~200 / `content` 1~4000），**任一项不合法整批抛错零写入**。
- **`runMemoryExtractionJob`**：**永不 reject**；读最近 3 轮 → LLM 结构化提取 → 校验 → `upsertMemory({source:'auto'})` → 调 `runMemoryPolicy` 冲突清洗（零规则重写）；失败 `console.error` + `done('failed')` **不重试**。
- **`buildMemoryLlm(userId, signal)`**：按 `protocol` 分流 Anthropic / OpenAI 非流式累积；配置缺失/解密失败在构造期抛错 → catch 落 `failed`。〔plan-2 §6 C2〕

### 3.3 触发点与隔离〔plan-2 §6 C2〕

- 触发点 = `handleTaskSuccess` 内 `persistAndSend(..., AI_STREAM_DONE, ...)` **之后**入队，**复用既有 `AgentTaskQueue`**（不新建第二套队列）。
- 任务路由在 `processTask` 顶部按 `isMemoryExtractTask` 分流，**不进 `runAgentFlow`、不设 `conversationTaskMap`** —— 背景提取不被 `AGENT_ABORT` 当作作答任务取消。
- 节流状态为进程内 `Map`，重启即重置（跨重启节流涉迁移，记 TODO）。〔plan-2 §6 C2 残余风险 1〕

## 4. IPC 与可见入口（C3/D5）

### 4.1 安全口径（全仓首个按 `SECURITY.md` 落地的 IPC 范式）〔plan-2 §6 C3〕

- 通道 `ai:memory:list` / `ai:memory:delete`（preload 暴露 `ai.memory.list(authToken)` / `ai.memory.delete(authToken, id)`）。
- **不接受渲染层 `userId`**：入参为当前登录 JWT → 主进程 `sha256(app.getPath('userData'))` 解出（与 `ipc-handlers.ts:getJwtSecret` 同源）+ `findById` 校验用户存在，**任一步失败 fail-closed 返回 `unauthorized`**。
- `isTrustedSender(event)` = `BrowserWindow.fromWebContents(event.sender)` 非 null 且 `!isDestroyed()`；抛错也按不可信处理。
- 删除 id 校验 `number && isSafeInteger && >0`；SQL 全走 DAO 的 `?` 参数化，零拼接。
- `getJwtSecret` 推导在 `memoryHandlers.ts` 与 `ipc-handlers.ts` 各留一份（抽独立 auth 模块会成循环依赖，记 TODO 双处同步）；D3 复用 `resolveUserId` 并 export，消解其中一份。〔plan-2 §6 C3 裁定、plan-3 §6 D3〕

### 4.2 设置页「自动记忆」栏〔plan-2 §6 C3〕

- `AgentPersonalityPanel` 第 4 个 tab `autoMemory`：只读行（kind 标签 + subject + content + writtenAt，`validTo` 非空显示「已失效」）+ 单条删除（`window.confirm` 二次确认）+ 加载/失败/空态。
- **删除是物理 `DELETE` 不可恢复**（req 裁定，UI 有二次确认无回收站）；验收链路 = 删除后 `getActiveProfile` 长度递减，新会话不再注入。
- browser 模式 `ai.memory` 恒失败返回 `{success:false}`（诚实失败，UI 显示「加载失败 + 重试」）。
- D5 扩「相似合并建议」三态区（通道与鉴权见分册 01 §6）。〔plan-3 §6 D5 防线二〕

## 5. 向量写入接线（D6）〔plan-3 §6 D6〕

- **写入**：`upsertMemory` 成功后**异步**生成向量（`resolveEmbedding` + `embeddingClient`），接线三处 = C1 `memoryWrite` / C2 `memoryWriter` / 启动 `agentHandlers`（复用 D2 三处触发点，不新建定时器）。
- **三条失败路径一律 `console.warn` 一条后返回、永不 reject、不重试、向量保持 NULL**（含未配置 embedding、API 失败、解析失败）。
- **写入前置短路**：`hasMemoryVector` 同指纹去重时不重复打 API；`upsertMemoryVector` 写 `vector` + `embedding_model`。
- **回填**：覆盖存量 active 行，**分批 20 条 / 限速 300ms / 上限 100 批**；启动回填在 embedding 已配置时对存量缺口行发起批量调用（首个升级版本可能有一次批量 embedding 成本，未配置时零成本空转，建议生产观察）。〔plan-3 §6 D6 残余风险 ②〕
- 查询侧对向量维度不一致（用户中途切换 embedding 模型）的 `vec_distance_cosine` 抛错由 DAO try/catch 吞掉降级 FTS-only。〔plan-3 §6 D6.1 残余风险 ④〕

## 6. 已知边界

- 同轮同 `kind+subject` 先到先得：模型同轮先写错再更正时第二次被拒（按 req「单轮只留一条」字面执行）。〔plan-2 §6 C1 残余风险〕
- 单轮状态依赖「每次 `runAgentFlow` 新建 toolCtx」这一当前唯一生产路径；若将来复用 ctx 跨任务则上限跨任务累计。〔plan-2 §6 C1 残余风险〕
- 两条写入路径（C1 工具 + C2 提取）重复写同一事实时，措辞不同视为新事实，由 `runMemoryPolicy`「时间新者赢」收敛（每次提取后必跑）。〔plan-2 §6 C2 残余风险 3〕
- `fingerprintOf` 在 `memoryWrite.ts` 与 `memoryWriter.ts` 各有一份同口径实现（注释已标后续可上提到 DAO 统一）。〔plan-2 §6 C2 残余风险 4〕
- 队列 supersede 可能吞掉 pending 提取（新 agent 任务会顶掉 pending 提取，不阻塞不报错不重试，记 TODO）。〔plan-2 §6 C2 残余风险 2〕
- `chatHandlers.ts` 的 `AI_STREAM_DONE` 未接线（已废弃 Chat 路径）。〔plan-2 §6 C2 残余风险 4〕
