# 模块四 / 模块五

> 拆分自 [agent-memory-optimize.direction.md](../agent-memory-optimize.direction.md)，原 §四 提示词与记忆注入、§五 记忆读写工具；2026-10-01 按渐进式披露拆分，正文未改动。
> 返回索引：[agent-memory-optimize.direction.md](../agent-memory-optimize.direction.md)

---

## 四、提示词与记忆注入模块

### 1.【P1】memory.md 接入 system prompt（终结"只存不喂"）（依赖：三.1）

**重点文档**：`docs/modules/05-设置界面-Settings.md:19-26,30-39`（soul/memory/style 三文件设置项）、`docs/architecture/ai-agent.md:84-90`（prompt 构建职责）

**重点代码**：`src/main/ai/files/globalAgentFiles.ts:4-18`（三文件定义）与 `:41`（memory 默认内容：用户偏好/技术栈/长期项目/已确认决策/重要经验）与 `:106-125`（读写）；**全库无注入调用方**（`agentContext.ts`/`agentPromptBuilder.ts` 未 import）；注入点 `src/main/ai/agent/agentPromptBuilder.ts:269-366`、`src/main/ai/agent/agentContext.ts:471-491`；IPC 仅设置页 `src/main/ai/ipc/agentHandlers.ts:413,423-441`

**执行前拷问**：
❓ memory.md（用户手写）与任务 五 的自动画像**冲突时谁优先**（用户显式写入应覆盖自动生成？合并规则？）
❓ 注入位置放 system prompt 哪一段（`agentPromptBuilder.ts:286-290` 核心规则前/后）？token 预算多大、超长怎么截断？
❓ soul.md/style.md 是否同批注入（范围控制，避免顺手扩需求）？

**验收拷问**：
❓ memory.md 中写「用户偏好：XX」后，新会话首答即体现，且**跨会话生效**？
❓ 未配置 memory.md（默认模板）时无注入开销与行为差异？

### 2.【P1】分层 Prompt 组装（System + 画像 + 历史片段 + 最近 N 轮）（依赖：三.1、四.1）

**重点文档**：`C:\Users\lenovo\Desktop\多轮对话记忆设计.txt:12`（组装公式：System Prompt + 画像记忆 + 历史片段 + 最近几轮对话）、`:14`（精准检索原则：事实依赖结构化查询，语境依赖向量召回）、`docs/architecture/ai-agent.md:59-73`

**重点代码**：`src/main/ai/agent/agentContext.ts:483-501`（最终 messages 形态：system 文档上下文 → system 主提示 → 分隔标记 → 历史 → 强调指令 → 当前 user）、`src/main/ai/agent/agentPromptBuilder.ts:269-366` 与 `:94-129`（文档上下文段）

**执行前拷问**：
❓ 层级顺序如何定（画像放最前还是最后？历史片段与近 N 轮如何切分）？与 一.2 移除"忽略历史"后的措辞如何统一？
❓ 与现有"分轮澄清前缀/强调指令"注入（`agentContext.ts:440-451`）叠加后的总提示词结构长什么样（给出目标结构树）？
❓ 哪些层依赖 模块三 的表（未就绪时如何降级占位）？

**验收拷问**：
❓ 拿一条真实长会话打印组装结果，五层齐备、无相互矛盾的指令？
❓ token 占用在 64000 窗口预算内（给出各层实测占比）？

### 3.【P1】摘要 prompt 改造：保留关键事实与指代先行词（依赖：一.2、一.5）

**重点文档**：`docs/architecture/ai-agent.md:24-27,53`（压缩 cache-safe fork、丢图保最近 3 张）、`docs/specs/ai-panel-features.md:16-22`

**重点代码**：`src/main/ai/contextManager.ts:192-259`（`summarizeViaLlm`，`:199-229` cache-safe fork、`:231-259` 回退模式）、**`:242`（现 prompt 明令"不要包含具体的问题和答案"——这是指代失败放大器）**、`:125-139`（buildCompressed）、`:145-170`（保留最近 N 轮）

**执行前拷问**：
❓ 改造后摘要要保留什么（主题关键词、已讨论实体、用户关键决策、最近答案的结论），仍如何避免摘要膨胀回吃 token？
❓ 参考三级渐进压缩（`多轮对话记忆设计.txt:4-7`：summary_text 20条/8000token → session_memory 每4条/1200token 增量 → compact_summary 6500token → 50000 硬截断）——项目采纳几级？**数值按 CONTEXT_WINDOW=64000 实测调优**
❓ cache-safe fork（保 prompt cache 命中）在改摘要内容后是否仍成立？

**验收拷问**：
❓ 压缩触发后追问「它有什么优势」，摘要里能否找到先行词（七.1 场景③）？
❓ 压缩前后 token/延迟对比数据在案，无 cache 命中率异常下跌？

---

## 五、记忆读写工具模块

> 本模块为复杂任务，均带外部检索 ①②③。

### 1.【P1】显式记忆读写工具注册（Agent 主动调用的慢思考回路）（依赖：三.1、四.2）

**重点文档**：`C:\Users\lenovo\Desktop\生产级Agent Memory.txt:5`（显式读写策略：Agent 主动调用记忆工具）、`docs/architecture/ai-agent.md:107-152`（工具注册与投放）、`docs/modules/11-AI代理面板-Agent.md:114-129`

**重点代码**：`src/main/ai/toolRegistry.ts:62-92`（handlerMap）与 `:99-388`（CORE_TOOLS schema，参照 `ask_question_card` 的 `:218` 注册写法）、`src/main/ai/agent/agentToolSelector.ts:69-149`（按意图投放）、`src/main/ai/agent/agentToolPolicy.ts:37-38`（调用次数上限）

**执行前拷问**：
❓ 工具集怎么划（memory_read / memory_write / memory_update？参数 schema 谁定）？与自动注入（四.1/四.2）的分工：何时读工具、何时直接注入？
❓ 哪些意图给这些工具（全给 vs 仅特定意图）？调用次数上限设多少（参照 `searchKB ≤ 10`）？
❓ 工具读到的记忆是否要像 searchKB 一样计入外发过滤/脱敏？

**验收拷问**：
❓ 一次典型多轮任务中，Agent 能主动存入并主动读回一条跨会话事实？
❓ 工具 schema 通过参数预验证（`agentToolExecutor.ts:103-113` 同款校验）且无 any？

**外部检索**：
① Docs MCP Server 查询 `langmem` 库索引：memory tools（create/str_replace/search memory）工具定义与写入流程最新文档；再查 `mem0` 库索引：add/search/update/delete memory API
② fastcrw 检索："explicit memory tool calling agent slow thinking loop design" 的设计资料
③ fastcrw 检索："agent tool registry schema validation LLM memory tool" 的功能实现及特性

### 2.【P1】后台异步增量写入 + 冲突清洗（依赖：三.2、五.1）

**重点文档**：`C:\Users\lenovo\Desktop\多轮对话记忆设计.txt:13`（后台异步线程：AI 响应后分析对话、写入新档案/清洗冲突）、`:15`（动态记忆系统：遗忘、冲突清洗、增量写入、自我更新自我净化）、`docs/architecture/ipc.md`（事件持久化）

**重点代码**：`src/main/ai/agent/agentTaskWorker.ts`（后台执行与事件持久化）、`src/main/ai/agent/agentEventStore.ts:156-202`（persistAndSend）与 `:237-262`（replayFromSeq，注意 `session_id` vs conversationId 口径疑似不一致，实施时先验证）、`src/main/ai/contextManager.ts:192-259`（LLM 调用范式可复用）

**执行前拷问**：
❓ 触发时机：done 事件后？会话结束时？节流策略（每 N 条消息）？
❓ 冲突清洗规则：新旧事实矛盾时谁赢（时间新者赢？置信度？用户显式值赢）？与 三.1 双时间如何配合？
❓ 后台 LLM 调用的成本与失败/超时/降级如何处理（不得阻塞用户下一轮提问）？

**验收拷问**：
❓ 连续对话中后台写入不阻塞主循环、失败静默重试有日志？
❓ 制造"用户搬家"式矛盾事实两次写入后，画像保留正确版本？

**外部检索**：
① Docs MCP Server 查询 `mem0` 库索引：add 流程中的 conflict resolution / deduplication 最新文档
② fastcrw 检索："background async memory write conflict resolution incremental update" 的设计资料
③ fastcrw 检索："user profile fact deduplication recency vs explicit override" 的功能实现及特性

### 3.【P1】记忆写入控制策略（自动写 + 可视化 + 手动删除/编辑）（依赖：五.2）

**重点文档**：`.claude/CLAUDE.md:72`（铁律一：AI 写入必经确认——**约束对象是笔记内容**）、`docs/REQUIREMENTS.md:145`（WC-03 交互确认流程）、`docs/modules/05-设置界面-Settings.md`（设置页形态参考）

**重点代码**：确认流程参照 `src/main/ai/agent/agentToolExecutor.ts:442-460`（交互触发）、`src/main/ai/ipc/agentHandlers.ts`（新增记忆管理 IPC 参照）、`src/render/stores/agentStore.ts`（渲染层状态）

**执行前拷问**：
❓ 边界定案：记忆自动后台写入**不需要**逐条弹确认（记忆≠笔记写入），但需要什么可见性（查看入口？最近写入列表？）？
❓ 手动删除/编辑入口放哪（设置页三文件旁？AI 面板新增视图？）——注意禁止顺手做无关 UI 重构，最小改动方案？
❓ 敏感信息边界：哪些内容禁止写入记忆（凭据、密钥——全局硬性规则）？

**验收拷问**：
❓ 用户能查看到自动写入的记忆并手动删除/编辑，删除后新会话不再注入？
❓ 铁律一语义未被削弱（笔记写入确认流程回归测试仍绿）？

**外部检索**：
① Docs MCP Server 查询 `letta` 库索引：memory block 编辑/人机协同修订（human-in-the-loop memory editing）最新文档
② fastcrw 检索："agent memory transparency UI edit delete user control design" 的设计资料
③ fastcrw 检索："automatic memory capture privacy credential redaction" 的功能实现及特性

### 4.【P2】遗忘 / 过期机制（依赖：三.2、五.2）

**重点文档**：`C:\Users\lenovo\Desktop\生产级Agent Memory.txt:12`（方法会过期需复核淘汰、规则合并去重防膨胀）、`C:\Users\lenovo\Desktop\多轮对话记忆设计.txt:15`（遗忘机制）

**重点代码**：`src/main/db/`（Policy 落地点，依赖 三.2）、`src/main/ai/contextManager.ts`

**执行前拷问**：
❓ 遗忘触发条件（时间衰减？容量上限？用户行为信号）？哪些记忆**不可遗忘**（用户显式标记的偏好）？
❓ 过期复核由谁做（自动打分 vs 提示用户确认）？

**验收拷问**：
❓ 长期运行模拟下记忆条数有上界、无无限膨胀？
❓ 关键用户偏好在模拟遗忘后仍存活？

**外部检索**：
① Docs MCP Server 查询 `langmem` 库索引：memory consolidation / decay 最新文档
② fastcrw 检索："memory forgetting decay curve agent design" 的设计资料
③ fastcrw 检索："memory consolidation merge deduplication token budget" 的功能实现及特性

---

