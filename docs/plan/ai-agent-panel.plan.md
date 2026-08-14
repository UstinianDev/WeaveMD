# AI 代理面板 — 实施计划（第1期基建 + 第2期 Chat 闭环）

> 模块：docs/modules/11-AI代理面板-Agent.md §7 分期 | 需求：AGT-01/03/04/18/19 + KB-02（仅建表）
> 范围：只交付「基建 + Chat 闭环」这一个可验证纵向切片。第3-6期不在本次范围，但 schema 预埋 kb 表。
> 两条铁律：① AI 无直接落盘能力（写路径必经预览→确认，本期 Chat 不写盘故无触发点）；② 联网/笔记外发必须知情同意。

---

## 0. 技术调研结论（已验证）

| 项 | 结论 | 来源 |
|----|------|------|
| Ollama OpenAI 兼容端点 | http://localhost:11434/v1/chat/completions 在 0.32.9 可用；/v1/models 已验证返回 qwen3.5:0.8b。SSE 流：data: {choices:[{delta:{role,content,reasoning}}, finish_reason]}，块间空行分隔，结尾 data: [DONE] | 本机 curl 实测 |
| Ollama 模型特注意项 | qwen3.5:0.8b 带 thinking，SSE 早期先发 delta.reasoning 且 delta.content 为空。SSE 解析必须跳过空 content、仅累积 content 字段 | 本机 curl 实测 |
| DeepSeek 官方 API | base URL https://api.deepseek.com（/v1 后缀亦可）；模型 deepseek-v4-flash（deepseek-chat 别名 2026-07-24 前仍可用）；stream:true SSE，delta.content，[DONE] 结束；thinking 模式先 reasoning_content 后 content | WebSearch 文档 |
| Electron safeStorage | safeStorage.isEncryptionAvailable()（app ready 前为 false）；encryptString(str)同步返回 Buffer；decryptString(buf)返回字符串（异步版 decryptStringAsync 返回 {result, shouldReEncrypt}）。Linux 无 keyring 时 backend 为 basic_text（明文降级，isEncryptionAvailable 对 basic_text 返回 true）→ 需按返回值记录降级提示 | Context7 Electron 文档 |
| SSE 流经 IPC | 主进程 ipcMain.handle(ai:chat/brain) 内用 Node fetch for-await 读 body 流，逐块解析后 webContents.send('ai:stream:chunk|done|error') 推送；invoke 返回的 Promise 在流结束后 resolve 汇总。webContents.send 为 fire-and-forget 同步 IPC，可行 | Context7 Electron 文档 |
| better-sqlite3 测试隔离 | 系统 Node(127) 加载不了 Electron 编译的 .node(125)。沿用现有 vi.mock 策略：vi.mock('better-sqlite3', () => ({ default: class FakeDatabase {} }))；DB 真实 SQL 不经单测，而以「DAO 纯函数层 + 语义断言」方式测试 | tests/main/ipcDialogs.test.ts 实证 |

---

## 1. 变更清单

### A. 基建（DB 迁移 + IPC 骨架 + 设置 + 同意 + 导航栏按钮）

| 文件（相对 src/ 或根） | 用途 | 增/删/改点 |
|------------------------|------|-----------|
| src/main/db/index.ts（改） | 追加 4 表 DDL + 索引 | runMigrations 的 database.exec() 内追加 ai_conversations / ai_messages / kb_documents / kb_chunks DDL，均 CREATE TABLE IF NOT EXISTS |
| src/main/db/ai.ts（新） | ai_* 表 DAO（本期落地） | createConversation/getConversations/listConversationsByUser/appendMessage/getMessagesByConversation/updateSummary，全部 user_id / conversation_id 过滤 |
| src/main/db/kb.ts（新） | kb_* 表 DAO（仅建表预留） | **已裁定不建**（避免未用死代码，遵循"不为尚未发生需求提前建设"）；kb_* 表由 index.ts 迁移建好，第3期再建 DAO |
| src/main/ai/llmClient.ts（新） | 统一 OpenAI 兼容客户端 | chatCompletion({backend, model, messages, onChunk, signal})；SSE 解析、错误/超时/abort 规范化、探测 Ollama 是否在线 |
| src/main/ai/consent.ts（新） | 知情同意判定纯函数 + 记录 | needsConsent(config, action)、recordConsent；按 user_id 读「允许联网/允许笔记外发 + 全局开关」 |
| src/main/ai/secureConfig.ts（新） | safeStorage 加密读写 API key | setApiKey/getApiKey(decrypt)/isEncryptionAvailable；key 只存 SQLite 密文，绝不落渲染进程 |
| src/main/ai/ipc.ts（新） | ai:* 处理器注册 | 注册 AI_CONFIG_GET/SET、AI_HEALTH、AI_CHAT、AI_CONSENT_GET/SET、AI_CONVERSATION_*；组合 ipcMain.handle + BrowserWindow.fromWebContents(event.sender).webContents.send |
| src/main/ipc-handlers.ts（改） | 汇总注册 ai 通道 | registerAllIpcHandlers 内调用 registerAiIpcHandlers() |
| src/main/preload.ts（改） | 暴露 ai.* 到渲染进程 | 增 ai: { getConfig,setConfig,health,chat,getConsent,setConsent,listConversations,getMessages,updateConversationSummary } 及流式监听 onStream(cb)/offStream(cb)（ipcRenderer.on + 返回取消） |
| src/shared/constants.ts（改） | ai:* 白名单通道 | 增 IPC_CHANNELS.AI_* 常量（见 §3） |
| src/shared/ai.ts（新） | AI 共享类型 | IAIConfig/IAIConsent/IAIConversation/IAIMessage/AIStreamEvent/AIError、ChatBackend 枚举（ollama|remote） |
| src/render/components/Settings/SettingsModal.tsx（改） | 'ai' Tab | TABS 增 key:'ai'；render 后端选择/ollama baseUrl/remote baseUrl/model id/API key(明文输入，提交走 setConfig 加密)/同意开关 |
| src/render/components/Navbar/TopBar.tsx（改） | AI 按钮加右区 | 右区 NavSeparator 后增 IconButton（机器图标），onClick 调 toggleAIPanel()（经 useNavbarActions 接线） |
| src/render/hooks/useNavbarActions.ts（改） | 暴露 toggleAIPanel | 增 toggleAIPanel = useUIStore.getState().toggleAIPanel 并返回 |
| src/render/i18n/en.json / zh-CN.json / zh-TW.json（改） | ai.* 键 | 增命名空间键（面板/同意/设置/错误文案） |

### B. Chat 闭环（llmClient + 面板 UI + 会话持久化）

| 文件 | 用途 | 增/删/改点 |
|------|------|-----------|
| src/render/stores/uiStore.ts（改） | isAIPanelOpen / aiPanelWidth 开关+宽度持久化 | 仿 isHistoryPanelOpen / historyPanelWidth；persistSettings/loadSettings 增两字段 |
| src/render/stores/agentStore.ts（新） | AI 会话 UI 状态机 | activeTab(chat/agent)、activeConversationId、messages、isStreaming、consent 状态；动作 loadConversations/newChat/sendMessage(chat)/stopStream；ChatTab 全功能，AgentTab 仅骨架 |
| src/render/components/AIAgent/AIAgentPanel.tsx（新） | 右侧 dock 容器 | 折叠状态、顶部 Tab 切换、关闭按钮、宽度拖拽把手（右侧 dock 反向拖拽：startX - clientX） |
| src/render/components/AIAgent/ChatTab.tsx（新） | Chat 会话 UI | 消息列表（markdown 渲染复用 @render/services/markdown）、输入框、发送/停止、流式增量追加、会话列表切换 |
| src/render/components/AIAgent/AgentTab.tsx（新） | Agent 骨架占位 | 只读占位「Agent 能力第4期上线」，禁用入口 UI |
| src/render/components/AIAgent/ConsentOverlay.tsx（新） | 知情同意弹层 | 惰性触发；勾选「允许联网」「允许笔记外发」+ 记忆到本账号；拒绝则本次请求中止并提示 |
| src/render/components/AIAgent/AIMessageBubble.tsx（新） | 单条消息渲染 | user/assistant/tool 三类 + markdown + refs 占位 |
| src/render/pages/MainPage.tsx（改） | 右面板插槽 | flex 行内、outline 之后 main 之右，{isAIPanelOpen && <AIAgentPanel/>} 以右 dock 方式插入（改 :122 flex 行布局） |

> 其余跨模块：editorStore / loadAssistant 本期不使用（Agent 能力是第4期）。块级改写写回基元本期不落地。

---

## 2. 数据模型 SQL（4 表，全 user_id 隔离，snake_case）

本期落地：ai_config + ai_conversations + ai_messages；预留：kb_documents + kb_chunks（DDL 幂等，避免二次迁移）。

> 补充决策（2026-08-14）：新增第 5 表 `ai_config`（模块文档 §4 已同步）——AI 配置 + 知情同意持久化
> （后端选择/baseUrl/model/API key 密文/允许联网/允许外发），按账号隔离。模块原定 4 表不承载配置，此为必要补充。

```sql
CREATE TABLE IF NOT EXISTS ai_config (
  id                TEXT PRIMARY KEY,
  user_id           TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  backend           TEXT NOT NULL DEFAULT 'ollama',   -- ollama | remote
  ollama_base_url   TEXT DEFAULT 'http://localhost:11434',
  remote_base_url   TEXT DEFAULT 'https://api.deepseek.com',
  model             TEXT DEFAULT '',                  -- 缺省由 health 探测补
  api_key_enc       TEXT DEFAULT NULL,                -- safeStorage 加密密文(base64)
  allow_network     INTEGER DEFAULT 0,                -- 允许联网（远程后端/工具/MCP）
  allow_send        INTEGER DEFAULT 0,                -- 允许笔记外发（知识库检索，第3期启用）
  consent_updated_at TEXT DEFAULT NULL,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_config_user ON ai_config(user_id);

```sql
CREATE TABLE IF NOT EXISTS ai_conversations (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL DEFAULT 'chat',      -- chat | agent
  summary     TEXT DEFAULT '',                    -- 压缩预留（第4期上下文压缩）
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_conv_user_updated
  ON ai_conversations(user_id, updated_at);

CREATE TABLE IF NOT EXISTS ai_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,                  -- user|assistant|tool
  content         TEXT DEFAULT '',
  refs_json       TEXT DEFAULT NULL,              -- 来源 JSON，本期 NULL
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_msg_conv_created
  ON ai_messages(conversation_id, created_at);
-- 预留（第3期启用）：user_id 冗余索引便于按用户扫全量知识库
CREATE INDEX IF NOT EXISTS idx_ai_msg_user ON ai_messages(user_id);

-- ▼ 第3期才填充数据；本期仅建表预留 ▼
CREATE TABLE IF NOT EXISTS kb_documents (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id     TEXT,                 -- 绑定内部文件时用
  source_type TEXT NOT NULL,        -- db|disk|import
  title       TEXT NOT NULL,
  pinned      INTEGER DEFAULT 0,
  status      TEXT DEFAULT 'pending',
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kb_doc_user ON kb_documents(user_id);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  content      TEXT NOT NULL,
  vector       BLOB DEFAULT NULL,   -- 向量余弦（第3期）| 预留
  source_ref   TEXT DEFAULT NULL,   -- 文件+块定位
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kb_chunk_doc ON kb_chunks(document_id, seq);
```

> 表间 user_id 均按需求冗余隔离；ai_messages 冗余 user_id 便于独立按用户清理。本期 Chat 只写 ai_* 两表；kb_* 零写入。

---

## 3. IPC 通道清单（ai:*）

请求/响应遵循现有 IpcResponse<T> {success,data,message,error}。

| 通道（IPC_CHANNELS 常量） | 方向 | 请求 | 响应 data |
|--------------------------|------|------|-----------|
| AI_GET_CONFIG: 'ai:get-config' | invoke | {userId} | IAIConfig（不含 key） |
| AI_SET_CONFIG: 'ai:set-config' | invoke | {userId, config}；apiKey 可选，传入则以 safeStorage 加密落库 | IAIConfig |
| AI_GET_CONSENT: 'ai:get-consent' | invoke | {userId} | IAIConsent |
| AI_SET_CONSENT: 'ai:set-consent' | invoke | {userId, consent} | IAIConsent |
| AI_HEALTH: 'ai:health' | invoke | 无 | {backend, ollamaOnline, ollamaModelId, error}（探测 Ollama /v1/models） |
| AI_CHAT: 'ai:chat' | invoke + stream | {userId, conversationId, message, config} | 流结束后 resolve {conversationId, assistantId, usage} |
| AI_CONVERSATION_LIST: 'ai:conversation:list' | invoke | {userId, mode} | IAIConversation[] |
| AI_CONVERSATION_GET: 'ai:conversation:get' | invoke | {conversationId, userId} | {conversation, messages} |
| AI_CONVERSATION_CREATE: 'ai:conversation:create' | invoke | {userId, mode} | IAIConversation |
| AI_CONVERSATION_DELETE: 'ai:conversation:delete' | invoke | {conversationId, userId} | {deleted} |
| AI_SUMMARY_UPDATE: 'ai:summary:update' | invoke | {conversationId, userId, summary} | IAIConversation（压缩预留，第4期调用） |

流式推送事件（主到渲染，webContents.send，渲染侧 preload onStream 订阅）：

```text
'ai:stream:chunk'  -> { conversationId, delta: string }
'ai:stream:done'   -> { conversationId, usage?: { reasoningTokens?: number } }
'ai:stream:error'  -> { conversationId, code, message }
```

> 流发生在 AI_CHAT invoke 期间：主进程 fetch SSE 逐块 webContents.send('ai:stream:chunk')，invoke 返回汇总。abort：渲染侧 send('ai:chat:abort', {conversationId})，主进程以 AbortController abort()。

---

## 4. llmClient 设计

统一 OpenAI 兼容，双后端由 IAIConfig.backend 决定：

- ollama：GET {host}/v1/models 探测在线；chat 用 {host}/v1/chat/completions，model id 默认 qwen3.5:0.8b（缺省取探测到的首个）。无 Authorization。
- remote（DeepSeek 兼容）：{baseUrl}/v1/chat/completions，Authorization: Bearer {decryptedKey}，model id 默认 deepseek-chat（实施期读设置默认值核对 v4-flash）。

chatCompletion 签名（纯函数、可单测，不 import electron）：

```text
async function* streamChatCompletion(opts: {
  backend; baseUrl; model; apiKey?; messages; timeoutMs?; signal?
}): AsyncGenerator<{ delta: string; usage?: { reasoningTokenCount?: number|null } }>
```

- SSE 解析：fetch 后 body.getReader()，按空行拆 event；data: [DONE] 结束；解析每行 data: {json} 取 choices[0].delta.content（跳过空串/thinking 早期 reasoning chunk）。容错半包（缓冲残行）。
- 错误/超时/abort 规范化：返回 AIError{code:'ollama_offline'|'network'|'timeout'|'aborted'|'http_'+status|'parse', message}。超时默认 60s（可配）。
- 探测与安装引导：health() 调用 Ollama /v1/models；失败返回 ollamaOnline:false + 提示文案点位：设置面板「检测 Ollama」按钮、Chat 发信前检查、ChatTab 空态。文案由 i18n ai.error.ollamaOffline / ai.error.installHint 提供（「请安装并启动 Ollama，见 ollama.com/download」）。
- 信号：接收外部 AbortSignal，abort 时 reader.cancel() 并停止推流。

---

## 5. 渲染侧设计

### agentStore（Zustand）

状态：activeTab(chat|agent)；activeConversationId；messages: IAIMessage[]；conversations；isStreaming；streamBuffer（流式累积展示）；consent: IAIConsent|null；config: IAIConfig|null。

动作：init(userId) 拉 config+consent+conversations（logout 时 reset 防串号）；newChat()；sendMessage(text)（先 needsConsent 判定 -> append user msg -> 建/续会话 -> onStream 订阅吸入 chunk -> done 落库）；stopStream()；toggleTab(tab)；deleteConversation(id)；loadConversation(id)；setConsent(consent) 持久化到主进程。

### AIAgent 组件树

```text
MainPage(flex row, :122 内)
L-- AIAgentPanel            // 右 dock；宽度 aiPanelWidth；反向拖拽
    +-- 头部：Tab(chat/agent) + 关闭(X -> toggleAIPanel)
    +-- ChatTab
    |   +-- ConversationList（会话切换/新建/删除）
    |   +-- MessageList（AIMessageBubble 复用 render/markdown）
    |   +-- StreamIndicator（打字指示 / isStreaming）
    |   L-- Composer（textarea + 发送/停止）
    +-- AgentTab（骨架占位 +「第4期上线」提示）
    L-- ConsentOverlay（惰性弹出）
```

- MainPage 插槽：flex 行内按序 [Outline][Editor][AIAgentPanel(width)]；isAIPanelOpen 时占宽，折叠时隐藏。
- consent 弹层：needsConsent 判定纯函数（第1次真正联网/外发时 true）；勾选+「记住本账号」-> setConsent；拒绝 -> 中止本次请求并 toast 提示。Chat 纯本地 Ollama 不触发（backend==='ollama' 且无 Agent 工具/kb 检索时跳过）。
- i18n 命名空间：ai.*（英/繁/简三文件）。关键键：ai.panelTitle/aiTab/chatTab/agentTab/placeholder/send/stop/newChat/empty、ai.consent.title/allowNetwork/allowSend/remember/deny、ai.settings.*、ai.error.*。

---

## 6. 测试计划（TDD strict）

> 遵循现有隔离策略：渲染测试 mock window.weaveMD（tests/setup.ts 已有）；主进程测试用 vi.mock('better-sqlite3', FakeDatabase)。真实 SQLite 交互以「DAO 纯函数层 + 语义断言」，真实建表/CRUD 走 Electron 运行时手动 + E2E。

| 测试文件 | 覆盖 | 关键用例 |
|----------|------|---------|
| tests/main/ai/llmClient.test.ts（新） | SSE 解析 / 错误规范化 / abort（mock fetch 注入 SSE 文本流） | data delta.content 流 -> yield 序列；delta.reasoning/空 content 跳过；[DONE] 结束；中断流 error；半包合并；非200 -> http_*；超时 |
| tests/main/ai/consent.test.ts（新) | needsConsent 判定纯函数 | remote backend 无「允许联网」-> true；ollama 本地 chat -> false；已授权记忆 -> false；全局开关关 -> true 且提示 |
| tests/main/ai/secureConfig.test.ts（新） | safeStorage 加解密封装 | mock safeStorage：isEncryptionAvailable false 时降级（明文但仍只存主进程）并告警；encrypt/decrypt roundtrip；key 不放 render |
| tests/main/ai/ipc.test.ts（新） | ai:* 处理器 | 仿 ipcDialogs：mock electron + FakeDatabase，断言 handler 注册与流式 webContents.send 调用参数 |
| tests/main/db/aiDao.test.ts（新） | ai 表 DAO | 用 FakeDatabase 断言 SQL 参数绑定顺序与 user_id 过滤逻辑（行为级）；真实 SQL 语义留 E2E/手动 |
| tests/render/stores/agentStore.test.ts（新） | store 状态机 | mock weaveMD.ai；sendMessage 将 onStream chunk 累积进 streamBuffer，done 后写 assistant msg；needsConsent 触发单次 overlay；logout 清空防串号 |
| tests/render/components/AIAgent/ChatTab.test.tsx（新） | UI 行为 | 渲染消息列表、输入->发送调用、流式插入节点、停止按钮 abort、空态 |
| tests/render/components/AIAgent/ConsentOverlay.test.tsx（新） | 同意弹层 | 惰性出现、勾选持久化调用 setConsent、拒绝则中止 |
| e2e/ai-agent-panel.spec.ts（新） | 端到端 | mock weaveMD.ai（不真连网）：打开面板、切 Chat、发消息走 mock 流、消息落显/持久化、AgentTab 占位可见 |
| e2e（可选，Node 真实 better-sqlite3） | 4 表迁移 DDL idempotent | 以 Electron 运行时验证四表 DDL 存在与 IF NOT EXISTS（复用迁移 SQL） |

> better-sqlite3 隔离方案（重点）：单测层 vi.mock('better-sqlite3', FakeDatabase) 让 DAO 编译可用但无真实 SQL 语义；真实建表/CRUD/索引验证走 a) Electron 运行时手动 E2E（npm run dev 后检查库结构），b) 以 Electron/node 加载 dev DB 跑集成断言。FTS5 已在 stage0 实证可用。

---

## 7. 验收标准（可逐条勾选）

功能（第1期）：
- [ ] 启动后 4 张新表成功建出（ai_* 可用、kb_* 存在零数据），迁移幂等（重启/重复 init 不报错、不重插）
- [ ] 设置面板出现 'AI' Tab：后端(ollama/remote)、ollama baseUrl、remote baseUrl、model id、API key 输入、同意开关；保存可读回
- [ ] API key 经 safeStorage 加密存 SQLite，渲染进程任何时刻不拿到明文 key（配置响应剔除 key 字段，单测覆盖）
- [ ] 导航栏右侧出现 AI 按钮，点击开合右侧面板，宽度可拖拽并持久化（重启恢复），与 History 面板共存互不干扰
- [ ] 知情同意：选定 remote 后端首次发消息弹同意层；勾选后本次请求放行并记住；拒绝则中止并提示；ollama 本地 chat 不触发

功能（第2期）：
- [ ] Chat 可发送消息并经真实 SSE 流式逐块显示（连本机 Ollama qwen3.5:0.8b 实测），stopStream 可中止
- [ ] 会话/消息持久化：刷新/重启后会话列表与消息仍在，按账号隔离（切换账号互不可见）
- [ ] summary 字段写入/读取 API 就绪（本期可手动触发，第4期自动压缩）

质量门禁：
- [ ] npm run typecheck（tsc --noEmit）0 error
- [ ] npm run test（vitest run）全绿，覆盖 §6 测试项
- [ ] npm run lint（eslint src/）0 error
- [ ] npm run build（vite build）pass
- [ ] Playwright E2E（npx playwright test）新增 ai-agent-panel.spec 通过，原有回归全绿
- [ ] 三种语言文件 en/zh-CN/zh-TW 的 ai.* 键键名一致无缺漏

---

## 8. 风险与依赖

| 风险/依赖 | 影响 | 缓解 |
|-----------|------|------|
| 远程 backend 无 DeepSeek key | 无法真连远程验证流式/同意 | 设 DEEPSEEK_API_KEY 环境变量供测试时读取；E2E 用 mock weaveMD.ai；同意层逻辑用 remote 配置 + mock 流覆盖 |
| qwen3.5:0.8b 对话质量低 | Chat 输出可能答非所问，影响演示观感 | 接受（本期验证管道而非质量）；设置默认 model id 可换；llmClient 保留 temperature 透传 |
| SSE 在 Electron 网络层 | 主进程 fetch 读流在隔离下正常；但代理/自签证书环境可能失败 | 用系统 Node fetch（Electron >=31 内置）；health 探测给出明确 offline 文案；不吞错误 |
| better-sqlite3 原生模块 | 系统 Node 无法加载 -> 单测无法跑真实 SQL | 沿用 vi.mock(FakeDatabase)；真实建表/CRUD 走 Electron 运行时手动验证 + E2E；FTS5 已实证可用 |
| safeStorage Linux 无 keyring | basic_text 明文降级，密钥保护弱 | isEncryptionAvailable 记录 backend，降级时设置面板提示（i18n ai.security.weakKeyring）；仍坚持不落渲染 |
| 面板与 History 并存布局 | 右侧双 dock 可能溢出 | 宽度上限/最小 clamp；空态优雅折叠 |

---

## 附：依赖顺序（实现批次）

1. A1：shared 类型 + constants + DB 迁移（4表）-> 独立可验证（启动建表）
2. A2：ai_*/kb_* DAO + 测试
3. A3：secureConfig + consent 纯函数 + 测试
4. A4：llmClient + 测试（mock fetch）
5. A5：preload + ai ipc 处理器 + 设置面板 'ai' tab + 导航栏按钮
6. B1：uiStore 面板开关/宽度 + AIAgent 组件树（ChatTab + AgentTab + ConsentOverlay）
7. B2：agentStore + Chat 流接线
8. B3：i18n 三文件 + E2E spec
9. B4：质量门禁全跑（§7）
