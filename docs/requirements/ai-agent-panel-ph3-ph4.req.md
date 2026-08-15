# AI 代理面板 — 第 3 期知识库 + 第 4 期 Agent 能力（需求记录）

> 模块：docs/modules/11-AI代理面板-Agent.md §7 | 状态：已对齐 2026-08-14
> 上一里程碑：第 1/2 期（基建 + Chat 闭环）已交付，门禁全绿（见 docs/plan/ai-agent-panel.status.md）
> 范围裁定：**第 3+4 期，第 5 期（块级改写）留后续里程碑**

## 1. 需求清单与验收标准

### 第 3 期：知识库

- **KB-01 索引来源**：账号内全部笔记（`files` 表按 user_id 过滤、软删排除）+ 导入文档（md/txt，单文件 + 目录批量）。置顶 = 文件级开关（召回 ×1.5）。
- **KB-02 索引流程**：导入/索引 → 分块写入 `kb_documents`/`kb_chunks` → FTS5 关键词索引（可用）→ embedding 向量（nomic-embed-text，未装降级）。
- **KB-03 双路召回**：FTS5(BM25) + 本地向量余弦，0.5/0.5 融合，top-k 默认 5；低于拒答阈值（默认 0.6）拒答不生成答案（返回提示 + 可选来源）。置顶文档加权。
- **KB-04 出处**：每条回答附「[来源: 文件名 · 块]」，点击打开文档并滚动到对应块（文件树联动，编辑器打开能力复用）。
- **KB-05 同意闸**：知识库内容外发（送 LLM）触发 `allowSend` 同意闸（服务端 consent.ts 扩展 uses allowSend）；已授权记忆到账号。
- **KB-06 重建**：文件保存后防抖异步重嵌入；删除文件同步清理；索引状态可见（pending/done/error）。

验收：
- 手动/导入使账号笔记进入 kb 表；FTS5 关键词召回可用并给出出处
- embedding 未装时降级仅关键词召回，无崩溃；装好模型（现场按需 pull）即启用双路
- 低于拒答阈值时拒答不编造；置顶文档在召回中加权
- 知识库问答命中走 `allowSend` 同意闸；同意前不发外发请求

### 第 4 期：Agent 能力

- **AGT-10 工具注册表**：内置只读工具 `listFiles`/`readFile`/`searchKB`/`runSkill`，读操作自动执行；写工具（`editBlocks`）第 5 期，本轮不注册。工具以 OpenAI 兼容 `tools`/`tool_calls` 形式供 LLM 调用。
- **AGT-11 函数调用循环**：主进程 Agent 循环（tools → 模型 → tool_calls → 执行 → `role:"tool"` 回填 → 续轮），最多 N 轮；工具失败自动兜底（降级直接作答并提示）。
- **AGT-12 skills 体系**：内置 2-3 个本地 SKILL.md 式技能（如「润色/缩写/扩写」「知识库问答」）+ 读取 `userData/skills/` 用户扩展；`runSkill` 工具执行。GitHub 自取 writing-shape 留后续。
- **AGT-13 意图识别**：规则启发式分 5 类（创作/改写、知识库问答、技术资料、网页抓取、闲聊）；模糊 → 提问卡片（候选意图列表）；工具失败自动兜底降级。
- **AGT-14 上下文压缩**：token 估算达 80% 自动 + 手动；早期对话合并为「历史摘要」（`ai_conversations.summary`，同 LLM 一次调用），保留最近 N 轮原文。
- **AGT-15 后端降级**：Agent 模式后端为 ollama 时提示「Agent 能力需远程后端」并降级为无工具纯生成（chat 逻辑）；函数调用仅 remote 可靠（DeepSeek 已实证支持 tools）。
- **AGT-16 富文本**：assistant/tool 消息走安全 markdown 渲染（复用 unified/remark 管线，无 dangerouslySetInnerHTML）；纯文本兜底。

验收：
- Agent 模式远程后端下：知识库问答/润色改写/文件读取走工具调用，循环正常、tool 结果回填、无死循环
- 意图规则把典型输入分到正确意图；模糊输入给出候选
- 上下文超阈值自动压缩且保留最近原文；手动压缩可用
- ollama 后端 Agent 降级为纯生成并提示；无崩溃
- assistant 消息安全渲染 markdown

### 非目标（本轮不做）

- 第 5 期块级改写（选区触发/定向块编辑协议/红删绿增预览/确认写入编辑器）
- 真 MCP server 进程管理（context7/firecrawl stdio 拉起、自动下载）；仅留工具调用骨架
- GitHub 自取 writing-shape 第三方技能；网页抓取工具真实执行（意图可识别「网页抓取」但无 firecrawl 执行器，规则兜底提示）

## 2. 已对齐问题清单（grill-me 2026-08-14）

| # | 决策 | 结论 |
|---|------|------|
| 1 | 交付包 | 第 3+4 期；第 5 期块级改写留后续里程碑 |
| 2 | MCP 深度 | 工具注册表先行（内置只读工具 + function-calling 循环）；真 MCP server 管理留后续 |
| 3 | embedding | 双路召回架构完整（embeddingClient + FTS5/向量 0.5/0.5 融合），nomic-embed-text 未装自动降级仅关键词；验证按现场模型可用性（架构+单测为主） |
| 4 | Skills | 内置 2-3 个 SKILL.md 式技能 + `userData/skills/` 可扩展读取；GitHub 自取留后续 |
| 5 | 意图识别 | 规则启发式（5 类），预留升级点；不引入 LLM 分类首跳 |
| 6 | Agent 后端约束 | ollama 后端降级为无工具纯生成 + 提示切换远程；函数调用仅 remote 可靠 |
| 7 | 活体验证 | 远程 DeepSeek（本地 qwen3.5 故障）；key 由用户提供或设 DEEPSEEK_API_KEY（当前 shell 未设置） |
| 8 | embedding 验证 | 架构 + 单测覆盖向量路径；现场若已 pull nomic-embed-text 则真验双路，否则验收关键词召回路径 |

## 3. 沿用设计（docs/modules/11 已定，不重复询问）

- 两条铁律：AI 无直接落盘（本轮无写工具，写必经预览→确认留第5期）；联网/笔记外发必知情同意（服务端同意闸扩展 allowSend）
- 参数默认：拒答阈值 0.6 / top-k 5 / 融合 0.5/0.5 / 置顶 ×1.5；上下文压缩 80% 阈值 + 手动
- 数据模型：`kb_documents`/`kb_chunks` 表已预建（vector BLOB/source_ref），本轮填 DAO/索引逻辑；`ai_messages.role='tool'`、`ai_conversations.mode='agent'` 已预留
- 知识库触发：Agent 模式「依照知识库创作」开关；Chat 纯对话不触发（KB 问答走 Agent）
- 密钥：safeStorage 加密，仅主进程；工具调用与检索全部主进程，密钥不落渲染

## 4. 风险与依赖

| 风险/依赖 | 影响 | 缓解 |
|-----------|------|------|
| 本地 qwen3.5 故障 | 本地 Agent/知识库问答无法活验 | 活体验证走远程 DeepSeek（需 key）；ollama 后端降级无工具 |
| nomic-embed-text 未装 | 双路召回无法真验 | 架构 + 单测；降级关键词召回；现场按需 pull |
| 意图规则召回率 | 意图分错 | 规则可迭代；模糊给候选提问卡片 |
| 工具循环 token 成本 | 长 Agent 会话费 token | 轮数上限 + 上下文压缩（80% 自动） |
| 新增依赖 | 向量计算/结构化解析 | 优先自建轻量（余弦纯函数、JSON 解析），不引重依赖 |
