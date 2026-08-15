---
name: ai-main-process-layer
description: AI 面板主进程层的模块边界/测试隔离模式/安全契约（ldl 本 agent 负责的铁律）
metadata:
  type: project
---

WeaveMD AI 代理面板的**主进程 + 共享契约**层已落地（第1/2期基建+Chat闭环），由 fullstack-detail-dev 负帧。范围仅主进程，渲染进程由并行 agent 负责。

**模块边界**（`src/main/ai/`）：
- `llmClient.ts` — 纯函数，**不 import electron**（可单测）。SSE 解析：按空行拆块 + 缓冲残行合并 + 跳过空 content（qwen3.5 thinking 早期 reasoning chunk 无 content）。`probeOllama` 用 `AbortSignal.timeout`（须做存在性守卫，jsdom 无此 API）。
- `secureConfig.ts` — safeStorage 加解密。`decryptApiKey` 返回明文只在主进程；`encryptApiKey` 返回 `{enc, backend:'ok'|'basic_text'}`。
- `consent.ts` — `needsConsent` 纯函数。第2期仅 remote 后端 + 未允许联网 → true。
- `ipc.ts` — 全部 ai:* 通道。AI_CHAT：同意闸 → 建/续会话 → 逐块 `webContents.send('ai:stream:chunk')` → done 落 assistant 消息。模块级 `Map<conversationId, AbortController>` 供 abort。

**安全契约（铁律）**：`IAIConfig` 绝不含 key 明文，只有 `hasApiKey` 布尔；api_key_enc 只在主进程解密；AI_GET_CONFIG 响应剔除 key 字段。

**测试隔离实证**（关键，后续沿用）：
- `vi.mock('better-sqlite3', () => ({ default: class FakeDatabase {} }))` — 单测无法加载真实 .node，用 FakeDatabase + DAO 语义断言（SQL 参数绑定顺序 + user_id 过滤）。
- `vi.mock('electron', ...)` 用 `vi.hoisted(() => {...})` 包裹 mock（**必须**，否则自引用报 TS7022）。handlers Map 存 handler fn，`BrowserWindow.fromWebContents` mock 返回 `{webContents:{send}}`。
- llmClient 测试：`global.fetch = vi.fn(originalFetch) as unknown as typeof fetch` 赋给 `FetchMock`（直接 `vi.fn()` 赋给 `global.fetch` 会 TS2322 类型报错）。SSE 流用 `ReadableStream` + 分片 enqueue 模拟半包。
- DAO 测试：FakeStatement 的 `get` 对 post-insert `SELECT FROM ai_conversations/ai_messages` 返回回读行（create/append 会 map 回读）。

**跨 agent 依赖**（勿自己改渲染文件）：`src/render/utils/weaveMDBridge.ts` 的 WeaveMDApi 实现缺少 `ai` 命名空间，`tests/render/stores/agentStore.test.ts` 报错——均由渲染 agent 补齐，typecheck 全绿依赖其完成。

**批次 1B Agent 主进程模块（第3/4期 §4 交付）**：
- `agentLoop.ts` — `runAgentFlow(event, payload, config, apiKeyEnc, controller, deps)`。`deps = { searchKb?, consent? }` 为**接口注入槽**（`SearchKbFn` 契约，绝不静态 import 并行 agent 的 `kbSearch.ts`）。consent 闸在入口 `needsConsent(config, deps.consent, 'agent')`，未授权抛 `consent_required`（不发外发）。会话需传入既存 conversationId（不自行创建）。工具回填续轮：`role:'assistant'(content:'')+toolCalls` → 逐 `role:'tool'(content, toolCallId)`；tool_call_id 自造 `call_<round>_<index>`（两端自洽即可，远端无需真 id）。轮数上限 `MAX_ROUNDS=6`，到限收敛提示，不无限循环。
- `toolRegistry.ts` — `defineCoreTools()` 4 只读工具（listFiles/readFile/searchKB/runSkill）；`executeTool(name, args:JSONstr, ctx)` 失败收敛 `status:'error'` 不抛断。**数据隔离**：DB 查询只用 `ctx.userId`，忽略工具参数里的 user_id（防伪造）。铁律一无写工具。
- `skillLoader.ts` — 内置 3 core skills（polish_rewrite/tech_organize/kb_qa_guide）随代码注册；`loadSkills(userDataSkillsDir?)` 扫 `skills/<name>/SKILL.md`（`---`front-matter name/description + 可选 args JSON + 正文=instructions）。`runSkill` 走一次 llmClient（嵌套一次防递归）。
- `intentRouter.ts` — `classifyIntent` 权重命中 6 类；`topScore-total 占比 <0.6` 且 `top-secondary≤1` → `candidates`+低置信。chat 当无关键词命中兜底。
- `contextManager.ts` — `estimateTokens=ceil(len/4)`（相对阈值）；`buildCompressed(messages, summary, N)` 反推保留最近 N 轮 user/assistant（tool 归其 assistant 轮）。

**主进程测试两个坑（实证）**：
- `vi.mock('fs', () => ({readdirSync:vi.fn(), ...}))` 裸对象**不拦截** skillLoader 的 `import {readdirSync} from 'fs'`（READDIR_CALLS=0）；给对象加 `default` 键也不稳。→ 直接改用**真实临时目录** `mkdtempSync(tmpdir())`+writeFileSync 测（更稳且更接近集成）。
- `no-irregular-whitespace` 报错若命中正则里的 BOM：把字面 U+FEFF 换成 `﻿` 转义（Edit 工具对两处仅相差不可见字符的串会判 same，需用 python 按字符替换）。

**agentLoop 单测 mock 要点**：mock `@main/db/ai`(appendMessage/getConversation/getMessagesByConversation)、`@main/ai/llmClient`、`@main/ai/toolRegistry`(executeTool)、`@main/ai/consent`、`@main/ai/contextManager`、`@main/ai/skillLoader`(loadSkills)、`electron`(BrowserWindow.fromWebContents→webContents.send)。内部 `async function*` 声明在 mockImplementation 回调里会触发 `no-inner-declarations` → 用 `return (async function*(){...})();` 立即调用式。

**批次 2 IPC/preload 接线（本 agent 已交付）**：
- `src/main/ai/ipc.ts` 新增 KB_*（list/importFile/importDir/reindex/delete/status）+ AGENT_RUN/AGENT_ABORT。KB_* 全部 `{userId, ...}` 载荷、IpcResponse 信封、DAO 参数化（listKbDocumentsByUser/countChunksByDoc/removeByFile/indexImportedText/indexFile）。KB_IMPORT_DIR **主进程 fs 读盘**（`readdirSync({withFileTypes:true})` + 逐文件 indexImportedText，单文件失败 continue 不中断；只收 `.md|txt`）。KB_STATUS 用 `probeEmbedding(host,model)` 探测。AGENT_RUN **必须把真实 `kbSearch.searchKB` 注入 `runAgentFlow` 的 deps.searchKb**（deps = `{searchKb, consent}`；conversationId 渲染侧可为 null → 归一 `? {...} : {}` 后传，因 agentLoop 载荷要求 optional string）。activeStreams 预注册 conversationId 供 AGENT_ABORT abort。
- `src/main/ipc-handlers.ts` KB-06 钩子：FILE_SAVE 成功后 `scheduleReindexAfterSave(userId, updated)`（模块级 `Map<'userId:fileId', NodeJS.Timeout>`，`reindexAfterSave(userId, file, {vectorEnabled:false})` 防抖 ~1200ms，`.catch(()=>{})` 静默降级）；FILE_DELETE 成功后 `cleanupKbAfterFileDelete`（先清在途定时器再 removeByFile）。
- `src/main/preload.ts`：`ai.runAgent(AgentRunPayload)/agentAbort(conversationId)` + 新 `kb.{list/importFile/importDir/reindex/delete/status}` 命名空间；onStream 的 `subscribe<T>` helper 返回类型放宽为 `AIStreamEvent | IAgentStreamToolEvent` 以支持 `type:'tool'` 变体（IAgentStreamToolEvent）。
- **weaveMDBridge.ts**（渲染 mock，非本批次交付但 typecheck 门禁必需）：`ai.*` 接口一旦加 `runAgent/agentAbort`，渲染 mock 必须同步补 noop + 新增 `kb.*` 6 个 noop，否则 tsc/vitest 报缺属性。**这是每次接口扩展的必改点**。
- 测试：ipc.test 在 `vi.hoisted` 里新增 mock `@main/db/kb`(listKbDocumentsByUser/countChunksByDoc)、`@main/db/files`(getFile)、`@main/ai/kbIndexer`、`@main/ai/kbSearch`、`@main/ai/embeddingClient`、`@main/ai/agentLoop`；mock fn 返回数组字面量会推断成 `never[]`，须 `as never[]` 强转（用 `any` 违反约定）。deps 注入断言：取 `agentLoopMock.runAgentFlow.mock.calls[0][5]` 的 `.searchKb` 再调用，断言 kbSearchMock 被以 user+query+opts 调用即证真实实现已接入。
- 遗留 lint：`tests/main/ai/ipc.test.ts` 的 `AI_CHAT sends error event` 用无 yield 的 `async function*`（`require-yield`）是**既有**错误（stash 验证 line206 原样存在），非本批次引入；full-project eslint gate 需在阶段6处理。本批次只验证新增源码 0 lint 错误。
