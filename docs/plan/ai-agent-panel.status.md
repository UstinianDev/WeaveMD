# ai-agent-panel — 进度状态

> 工作流：devflow-core | 目标模块：docs/modules/11-AI代理面板-Agent.md（§7 六期）
> 需求：REQUIREMENTS.md 3.7 AGT-01~19 / 3.8 KB-01~05 | 起始：2026-08-14

## 阶段 0：分级与分类 ✅

- **请求类型**：功能开发（AI 代理面板全新模块，greenfield）
- **跨模块判断**：跨模块——主进程（LLM/DB/IPC/网络/密钥 safeStorage）+ 渲染进程（面板 UI/stores/编辑器写回）
  + 数据迁移（4 张新表）+ 权限/密钥/知情同意 → **判为跨模块**
- **定档**：**L**（新 API、DB 迁移、涉密钥与授权、多端、多天工作量）
- **裁剪**：无——L 级走全部阶段（TDD strict）
- **探索结论**（2026-08-14）：
  - `src/main/ai/`、`AIAgent/` UI、`agentStore` 均不存在（greenfield）
  - 集成点已摸清：MainPage 右面板插槽（uiStore `isAIPanelOpen`/`aiPanelWidth`）、
    SettingsModal 新增 'ai' Tab、preload `WeaveMDApi` 增 `ai.*`、IPC_CHANNELS 增 `ai:*`、
    `editorStore.updateContent` + 块树 `replaceLeafRange` 作为块级改写写回基元、i18n 三文件加键
  - **FTS5 已验证**：better-sqlite3（Electron 运行时，SQLite 3.49.2）`CREATE VIRTUAL TABLE ... USING fts5` OK → §6 未决项解决
  - 本地 Ollama 0.32.9 在线，仅有 `qwen3.5:0.8b`（capabilities: vision/completion/**tools**/thinking，873M）；
    环境无 DeepSeek API key → 待用户确认
  - 需注意：better-sqlite3 原生模块编译目标为 Electron Node（NODE_MODULE_VERSION 125），
    系统 Node(127) 无法加载 → 涉及 DB 的脚本须走 Electron 运行时或 vitest（同构隔离 mock）

## 阶段 1：需求对齐（grill-me）✅ 2026-08-14

用户确认「全按推荐」：

- **Q1 范围**：先交付 第1期(基建) + 第2期(Chat 闭环) = 一个完整可验证纵向切片；
  第3-6期（知识库/Agent/块级改写/收尾）留待后续里程碑。第3期先不影响本期（schema 预留 vector BLOB）
- **Q2 远程后端**：用户本地设 `DEEPSEEK_API_KEY` 环境变量供测试读取；远程后端 OpenAI 兼容
  （DeepSeek v4 flash 模型 id / base URL 以设置面板默认值为准，实施期再核对）
- **Q3 向量化**：知识库用 Ollama `nomic-embed-text`（第3期），未装则降级仅关键词召回；本期只预留 schema
- **Q4 同意页**：惰性触发（首次真正联网/外发时），按账号持久化（允许联网/允许笔记外发 + 全局开关）
- 设计决策（本期）：
  - **llmClient 统一走 OpenAI 兼容 `/v1/chat/completions`**（Ollama 0.32.9 亦支持），SSE 流式，
    主进程解析流 → `webContents.send('ai:stream:*')` 推送给渲染进程
  - 会话/消息表本期落地使用；kb 表仅建表（DDL idempotent，避免二次迁移）
  - Chat 模式纯对话不触发同意页（本地 Ollama）；远程后端/Agent 工具/知识库检索才触发

## 阶段 2：规划 ✅ 2026-08-14（Plan 智能体 + L级技术调研）

计划已写入 docs/plan/ai-agent-panel.plan.md（269 行）。要点：

- **技术调研已实测**：Ollama 0.32.9 `/v1/models`+`/v1/chat/completions` 可用（SSE `data:{choices:[{delta:{role,content,reasoning}}]}`）；
  **qwen3.5:0.8b 带 thinking**——SSE 早期 `delta.reasoning`、`delta.content` 为空 → llmClient 必须跳过空 content。
  DeepSeek baseUrl `https://api.deepseek.com` + SSE；safeStorage 加解密 + Linux basic_text 降级点；
  SSE 经主进程 fetch 流 → `webContents.send('ai:stream:*')` 推送可行；better-sqlite3 单测沿用 `vi.mock(FakeDatabase)`（tests/main/ipcDialogs 实证）
- **变更清单**：A 基建 13 处 + B Chat 闭环 8 处（详见计划 §1）
- **数据模型**：4 表幂等 DDL（ai_conversations/ai_messages 本期用；kb_* 仅建表预留）
- **IPC**：11 个 ai:* invoke + 3 个流推送事件（chunk/done/error）
- **llmClient**：统一 OpenAI 兼容双后端；async generator SSE 解析；错误/超时/abort 规范化；health 探测 Ollama
- **测试**：TDD strict，10 个单测文件 + e2e/ai-agent-panel.spec.ts；验收含 tsc+vitest+eslint+build+E2E 门禁

**待用户确认后进入 Stage 3-5**

## 阶段 3-5：实现 ✅ 2026-08-14（两个并行智能体 M1 主进程 / R1 渲染侧，TDD L/strict）

**已实现**：
- 主进程：src/shared/ai.ts、src/main/db/index.ts(5表 DDL：ai_config/ai_conversations/ai_messages/kb_documents/kb_chunks)、db/ai.ts(DAO)、
  ai/llmClient.ts(统一 OpenAI 兼容 SSE 流式，跳过 qwen3.5 thinking 空 content)、ai/consent.ts、ai/secureConfig.ts、ai/ipc.ts(全部 ai:* 通道 + 服务端同意闸 + 流推送)、ipc-handlers 接线、preload 增 ai.* + onStream
- 渲染：agentStore(Zustand 状态机 + needsConsent 纯函数)、AIAgent/ 组件树(AIAgentPanel/ChatTab/AgentTab/ConsentOverlay/AIMessageBubble)、
  uiStore(isAIPanelOpen/aiPanelWidth)、MainPage 右插槽、TopBar AI 按钮、useNavbarActions、SettingsModal 'ai' Tab、i18n 三文件 33 键、tests/setup 增 ai mock
- 单测：tests/main/ai/{llmClient,ipc,secureConfig,consent}.test.ts + tests/main/db/aiDao.test.ts + tests/render/{stores/agentStore,AIAgent/ChatTab,ConsentOverlay}.test.{ts,tsx}

**门禁当前状态**：typecheck 0 error ✅ | vitest 63 files/979 tests 全绿 ✅ | eslint 0 error（8 warning 均既有文件）✅ | vite build 编译 ✅（electron-builder MSI 因 public/icons/icon.png 缺失失败——**既有环境问题**，非本任务引入）

**待 Stage 6 补齐**：
- [ ] preload `ai.*` 返回类型与契约漂移（部分 `Promise<unknown>`，非 IpcResponse 信封）；agentStore 用本地 WeaveAIApi 垫片（双源真值）
- [ ] e2e/ai-agent-panel.spec.ts 缺失
- [ ] assistant 消息渲染评估（R1 用纯文本规避 dangerouslySetInnerHTML；计划原拟复用 markdown 服务）


## 阶段 6：测试与质量门禁 ✅ 2026-08-14（testing-quality-agent + 主指挥复核）

- testing-quality-agent 完成：preload `ai.*` 类型契约收敛为 `IpcResponse<T>`（消除 `Promise<unknown>` 漂移）、
  agentStore 删除本地 WeaveAIApi 垫片改用真实类型、`e2e/ai-agent-panel.spec.ts`（6 用例，mock 流式不上网）、
  补 AIAgentPanel/SettingsModal.ai/ConsentOverlay 单测、修复 ConsentOverlay `pointer-events-none` 挡住按钮的真实 bug
- assistant 消息渲染：保持纯文本（项目无安全 markdown→React 渲染器；raw HTML 仅用于导出，违反 SECURITY 硬性规则故不用；富文本留第4期）
- **门禁全绿**：typecheck 0 error | vitest 65 files/987 tests | eslint 0 error | playwright ai spec 6 passed | vite build 编译通过
  （electron-builder MSI 打包失败为既有 `public/icons/icon.png` 缺失，非本任务引入，不修）

## 真实 LLM 流式验证（Task #12）✅ 2026-08-14

- **llmClient 管道已验证**：单元测试（mock SSE 覆盖 reasoning 跳过/半包/DONE/abort/timeout）+ 真实传输层
  （Node fetch 直连 Ollama 流读正常、SSE 帧 `\n\n` 分隔与解析器吻合）
- **本地唯一模型 `qwen3.5:0.8b` 确认故障**：OpenAI 兼容 `/v1/chat/completions` 40s 内 790 行 `data:` 全为
  `"content":""` + `"reasoning"`，无内容、无 `[DONE]`；非流式 90s 无响应；`enable_thinking:false` 与
  system prompt 均无效 → 模型无限思考、永不产出 content（用户预判的「功能差」场景，属模型问题非代码问题）
- **远程 DeepSeek 后端真连验证通过 ✅**：用户提供 key，`deepseek-chat` 经 `https://api.deepseek.com/v1/chat/completions`
  流式 6 chunks、2.5s 完成、内容正常（"1+1等于2。"）——远程 OpenAI 兼容路径端到端打通
- **连带修复 llmClient 真实 bug**：原 timeout 计时器在 fetch 成功后即 finalize() 清除 → 只覆盖连接阶段，
  流中途卡死永不中止。已改为贯穿「连接+流式读取」全程，并在各错误/结束分支 finalize()；新增
  `tests/main/ai/llmClient.test.ts`「stream stalls mid-reading → timeout」回归用例
- 补充：ipc.ts runChatFlow 在 model 留空时按后端取默认（remote=deepseek-chat / ollama=qwen3.5:0.8b）
- ⚠️ 安全提示：用户 DeepSeek key 曾出现于本会话转录，建议用后轮换

## 阶段 7：合规核对 ✅ 2026-08-14（git-diff-reviewer）

- 两条铁律：✅ AI 无直接落盘（仅写 ai_messages 会话记录）；联网/外发知情同意（服务端同意闸 + allow_send 未启用写路径）
- SECURITY：✅ SQL 参数化 / IPC user_id 隔离 / key 仅主进程加解密、IAIConfig 无明文 / 无 dangerouslySetInnerHTML / 无 any
- CONVENTIONS：⚠️→✅ 修复内联 style 违规（SettingsModal AI Tab 4 处 + AIMessageBubble → Tailwind 任意值）
- 数据模型：✅ 5 表 DDL 与计划逐字段一致、幂等
- 范围控制：⚠️ 基本通过——kb.ts 按「不为未发生需求建抽象」裁定不建（计划已注明）；临时调试脚本已清理
- 修复：llmClient abort 监听器泄漏（具名 onExternalAbort 复用 add/remove）；ipc.ts activeStreams 新会话控制器泄漏（并入 runChatFlow finally 清理）

## 阶段 8：交付核对（gate）✅ 2026-08-14

- **门禁全绿**：typecheck 0 error | vitest 65 files / 987 tests | eslint 0 error（8 warning 均既有）
  | vite build 编译通过（MSI 打包失败为既有 icon 缺失）| Playwright ai-agent-panel.spec 6/6 passed
- **活体验证**：DeepSeek `deepseek-chat` 真连流式通过（6 chunks / 2.5s / 内容正常）
- **变更核对**：实际 diff 与计划 §1 变更清单一致；无编辑器/导出等无关改动；
  kb.ts 按「不提前建抽象」裁定不建（计划已注明）；临时调试脚本已清理；未提交任何密钥
- **文档同步**：模块文档 §4/§7、SUMMARY §5、TECH_STACK 2.10、CLAUDE.md 均同步为「第1/2期已交付」
- **剩余风险**：①本地 qwen3.5:0.8b 故障（换模型/重配）；②失败 UX（模型无内容/超时静默）低优；
  ③agentStore 同意后不自动续发输入（UX 优化）；④DeepSeek key 曾入转录建议轮换

## 遗留问题（后续里程碑）

- [ ] 第3-6期：知识库（embedding 需可用本地模型/下载 nomic-embed-text）、Agent 能力（skills/MCP/意图/压缩）、块级改写、收尾
- [ ] 失败 UX：模型无内容/超时目前 Chat 只静默结束气泡，无错误提示——建议补「模型未返回内容/超时」toast（低优先级）
- [ ] 本地模型修复：qwen3.5:0.8b 无限思考问题（换模型或重配）

