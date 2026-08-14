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
