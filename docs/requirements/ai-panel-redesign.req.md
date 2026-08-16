# ai-panel-redesign — 需求文档

> 2026-08-16 | 档位 L | 需求已与用户对齐（AskUserQuestion 确认 4 项决策）

## 目标

将 AI 面板（当前单 body 消息流 dock）重构为三视图结构：**AI 主界面（home）** / **会话视图** / **设置**。复用全部现有功能（对话、智能体、知识库、改写、补全），仅调整布局与位置；新增两项小能力：模型下拉 `ai.listModels` IPC、首条消息写入会话标题。

## 已对齐决策

1. 面板形态：**仍为右侧 dock**，默认宽加大到 ~480px（可拖 260~520），内部重排。
2. 设置范围：**最小** — 模型=现有 AI 设置表单整体迁入；skills=只读列出；MCP=占位注明延期。
3. 模型下拉数据源：**新增 `ai.listModels` IPC**。
4. 会话标题：**首条消息写入 summary**（复用 updateConversationSummary IPC）。

## 需求清单

### 一、AI 主界面（home，无会话/初始视图）

- **R1** 顶部栏：左 "WeaveMD"（品牌）；右 +（新建会话）、⚙（设置）、×（关闭面板 toggleAIPanel）。
- **R2** 居中大图标（应用品牌图标 📔，放大尺寸）。
- **R3** 图标下方居中文案 "What can I do for you?"。
- **R4** 区块标题行：左 "RECENT"，右 "View All >"（点开全部会话列表视图）。
- **R5** 最近 3 个会话列表（按 updatedAt 倒序）：每项显示标题（summary）+ 日期（月/日，如 "7月28日"），点击进入会话视图（loadConversation）。无会话显示空态文案。
- **R6** 底部内容输入框：
  - 输入框底部（左→右）：chat/agent 模式上拉列表 + 模型选择上拉列表；
  - 输入框回车/发送走现有分流（复用 handleSendAgent / sendMessage 逻辑）；聊天记录展示区复用现有消息流（主界面输入即进入会话视图，或主界面内直接出消息流——以"发送后自动创建会话并入会话视图"为准）。

### 二、齿轮（设置）— 面板内设置视图

- **R8** 左侧侧栏：**模型 / skills / MCP** 三个选项（从上至下）。
- **R9** 模型模块 = 现有 SettingsModal `ai` Tab 表单**整体迁入**：后端选择、Ollama 地址、远程地址、模型 ID、API 密钥（hasApiKey 布尔）、同意开关（allowNetwork/allowSend）、KB 检索参数（topK/fuse/threshold/pinnedWeight/embedding host+model）。保存逻辑复用（setConfig/setConsent/setKbSettings）。
- **R10** skills 模块 = 只读列出已有技能（listSkills IPC：内置 core + 用户扩展，名称+描述）。
- **R11** MCP 模块 = 占位页，注明「真 MCP server 管理已延期」。
- **R12** 设置视图可关闭/返回（回到原视图）。

### 三、会话视图（点开或新建会话后）

- **R13** 顶部栏与主界面一致（WeaveMD / + / ⚙ / ×）。
- **R14** 顶部栏下方：当前会话标题（summary 或首条问题），标题行最右有 **×（关闭当前会话）**——关闭后回主界面（清空当前会话 activeConversationId=null + messages=[]）。
- **R15** **Agent 模式**时，标题下方复用现有知识库导入功能（KnowledgeBaseSettings：导入文件/目录 + 索引状态列表 + 删除）。chat 模式不显示。
- **R16** 改写失败状态条最右要有 **×**（可关闭）——RewritePreviewCard 的 failure/locate-failed/stale/no-document 等无提案提示条增加 dismiss 按钮。

### 四、模型下拉（新增 IPC）

- **R17** 主进程新增 `ai.listModels(userId)` IPC：
  - ollama 后端 → `GET {ollamaBaseUrl}/api/tags` → 模型名数组；
  - remote 后端 → `GET {remoteBaseUrl}/models`（Bearer key，key 从 secureConfig 读取，**不落渲染**）；
  - 失败返回空数组/错误（不阻断）。
- **R18** composer 模型下拉 = 实时拉取模型列表；选中结果持久化到 `ai_config.model`（复用 setConfig）。
- **R19** 下拉拉取失败/为空降级：显示当前配置 model，并允许手动输入（回退到文本输入）。

### 五、会话标题

- **R20** 首次发送（chat/agent）创建会话后，把第一条用户消息写入 summary（复用 updateConversationSummary IPC；sendMessage/sendAgentMessage 创建会话分支内追加）。
- **R21** 会话列表/标题直接读 summary；无 summary 时用模式名兜底（对话/智能体）。

## 验收标准

- AI 面板打开默认显示主界面；点 + 进入新会话视图，点最近会话进入对应会话视图；点 ⚙ 进设置；点 × 关闭面板/会话。
- 主界面 RECENT 展示最近 3 个会话（标题=首条问题 + 月/日）。
- 设置侧栏 模型/skills/MCP 三模块可用；模型表单保存行为与现状一致（回归）。
- composer 模型下拉实时拉取模型（ollama/remote）；选中持久化到 config。
- 会话标题=第一个问题；Agent 模式显示知识库导入；改写失败条可 × 关闭。
- 全量门禁：tsc 0 / vitest 全绿 / lint 0 / vite build / Playwright 全绿。

## 范围外（不实现）

- 真 MCP 进程管理（已延期）。
- skills 启用/停用、创建/编辑技能。
- 模型管理（自定义模型清单、删除模型）。
- 会话搜索、View All 的分页加载（仅全部列出即可）。
