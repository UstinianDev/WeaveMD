# WeaveMD 智能创作 Agent · Agent Memory 优化方向

> 导入信息：来源 `C:\Users\lenovo\Desktop\优化方向\优化方向.md`，导入日期 2026-09-28。
> 交付物性质：**只给优化方向，不改任何项目代码**。执行者：后续交由能力更强的模型（Claude Code）实施。
> 形态约定：模块用「一、二、三…」分类；模块内任务用「1. 2. 3.」罗列；每个任务给出重点文档/代码位置（行号）、grill-me 拷问（执行前 + 验收双段）；复杂任务带外部检索 ①②③。
> 参考资料 `生产级Agent Memory.txt`、`多轮对话记忆设计.txt` 存放于本机桌面，**不随本文入库**，引用行号仅对持有者有效。

---

> **状态：三批已全部交付**——P0 第一批（[plan](./agent-memory-optimize.plan.md)）、P1 第二批（[plan-2](./agent-memory-optimize-2.plan.md)）、P2 第三批（[plan-3](./agent-memory-optimize-3.plan.md)）均已交付，门禁与 TDD 证据见各批 status / tdd 报告；本文档保留为路线图与根因定位索引。

**分册（按需展开）：**

| 文档 | 内容 |
|------|------|
| [01-modules-1-3](./agent-memory-optimize.direction/01-modules-1-3.md) | §一 Agent 上下文与意图路由 / §二 RAG 与查询理解 / §三 记忆存储与数据层 |
| [02-modules-4-5](./agent-memory-optimize.direction/02-modules-4-5.md) | §四 提示词与记忆注入 / §五 记忆读写工具 |
| [03-modules-6-7](./agent-memory-optimize.direction/03-modules-6-7.md) | §六 经验沉淀与 Skill / §七 测试与验收 |

> 本文档保留 §0 使用说明、§0.5 背景与根因定位与文末落盘说明；模块一~七按模块拆为分册，
> 分册正文与原章节逐字一致，原编号不变——正文里的「一.1」「二.2」等任务编号引用按上表到对应分册查找。

## 0. 使用说明

1. **本文档不做任何代码修改**，仅列方向、定位、拷问与检索指引；实施前须按项目规范先更新 `docs/` 设计文档再动代码（`.claude/AGENTS.md` §3 工作流约束）。
2. **行号为 2026-09-28 只读扫描快照**。代码可能已变动，执行每个任务前**必须先用 grep/关键词重新定位确认**，行号只作定位参考，不得盲信。
3. **优先级**：`P0` = 根因修复，不做则记忆体系无效；`P1` = 记忆体系主干；`P2` = 远期能力。任务标题后标注依赖关系（如 `依赖：一.1`）。
4. **执行顺序路线图**：
   - 第一批（P0）：模块一全部 → 模块二.1、二.2 → 七.1 场景①②验证
   - 第二批（P1）：模块四 → 模块三 → 模块五 → 二.4 → 七.1 完整场景、七.2、七.3
   - 第三批（P2）：二.3 → 三.3 → 五.4 → 模块六
5. **硬约束红线（任何任务不得违反）**：
   - 不减少历史轮次、不截断工具结果：`docs/requirements/agent-perf-optimize.req.md:11-17`
   - AI 写入必经确认（铁律一）**仅约束笔记内容写入**；记忆（画像/摘要）写入策略见任务 五.3 的边界说明：`.claude/CLAUDE.md:72`
   - 知识库 0.6 拒答、置顶 ×1.5、searchMode 三模式降级行为不变：`.claude/CLAUDE.md:75-76`
   - 数据迁移必须可从空库执行、也能从上一版本升级，历史迁移文件不得擅改（全局 AGENTS.md 硬性规则）
   - 质量门禁全绿才算完成：`tsc + vitest + eslint(0 error) + vite build + E2E`：`.claude/CLAUDE.md:10-12`
6. **外部检索工具**（复杂任务用）：
   - ① **Docs MCP Server**（docs-cli）：按下方给定的**具体库索引**查最新文档；
   - ②③ **fastcrw**：按给定关键词查具体主题的**设计/技术资料/功能实现及特性**。
7. **参数取值原则**：本文档给出的阈值均为参考值，**需按 `CONTEXT_WINDOW = 64000`（`src/main/ai/agent/agentHelpers.ts:13`）实测调优**，不得直接照抄外部资料数值。

## 0.5 背景与根因定位

**实测问题**：用户先问 RAG 相关问题，AI 正常回答；用户追问「它有什么优势」，AI 反而调用 `ask_question_card` 反问「"它"指什么」。

**五条根因 → 代码定位 → 任务索引表**：

| # | 根因 | 代码定位 | 指向任务 |
|---|------|----------|----------|
| 1 | 第二问被判 `chat` 意图后**历史被整段丢弃**，上一轮 AI 回答与 searchKB 结果一行都不发给 LLM | `src/main/ai/agent/agentContext.ts:417-420`；chat 兜底判定 `src/main/ai/intentRouter.ts:109-117` | 一.1 |
| 2 | 存在 system 注入明令**「忽略之前的所有对话内容……这是全新的独立问题」**，从指令层禁止指代消解 | `src/main/ai/agent/agentContext.ts:440-451`（447-450）；`CHAT_SYSTEM_PROMPT` `src/main/ai/agent/agentPromptBuilder.ts:369-379` | 一.2 |
| 3 | 短文本（<10 字）触发 `needsClarification` → chat 意图工具集收缩到只剩 `ask_question_card`，且前缀要求"不确定就用卡片提问、不要猜测" | `src/main/ai/intentRouter.ts:140-141`；`src/main/ai/agent/agentContext.ts:471-478`；`src/main/ai/agent/agentToolSelector.ts:100-107` | 一.3 |
| 4 | `assistant.tool_calls` 从不落库 → 下一轮历史出现**孤儿 tool 消息**（缺前置 assistant 调用行），跨轮时 searchKB 结果事实上不可用/被 provider 忽略 | `src/main/ai/agent/agentToolExecutor.ts:77-90`（仅内存）vs `:498-506`（落库）；`src/main/db/ai.ts:631-654`（`toolCalls` 形参全库无调用方）；回读 `src/main/ai/agent/agentContext.ts:361-366` | 一.4 |
| 5 | KB 层代词消解**不传对话历史**：`resolveReferences(query, 空历史)` 原样返回，`pronoun_reference` 判定必命中，`clarificationContext` 生成「你提到的『X』具体指的是什么？」并指示 LLM 调 `ask_question_card` | `src/main/ai/tools/searchKBHandler.ts:25`；`src/main/ai/knowledge/queryPlanner.ts:212,225,432-434`；`src/main/ai/knowledge/knowledgeClarify.ts:17-22,168-169` | 二.1、二.2 |

> 说明：根因 1/3 与根因 5 是**两条互斥但现象一致**的路径（第二问被判 chat 则走 1/3；仍持有 searchKB 则走 5），必须两条都修。

**参考资料（只读引用，禁止修改）**：
- `C:\Users\lenovo\Desktop\生产级Agent Memory.txt` — 分层设计、Ledger/Views/Policy、双时间、经验沉淀（`:3-12`）
- `C:\Users\lenovo\Desktop\多轮对话记忆设计.txt` — 三层记忆、三级渐进压缩阈值、实体画像、长期情景记忆、后台异步写入（`:2-15`）

---

*本文档由 `/devflow-documents` 于 2026-09-28 从 `C:\Users\lenovo\Desktop\优化方向\优化方向.md` 导入，正文与原件一致（仅头部补导入元信息、文末落盘说明改写）。**权威以本仓库 `docs/plan/agent-memory-optimize.direction.md` 为准**（桌面件是导入源、可能被后续文档覆盖）；`生产级Agent Memory.txt`、`多轮对话记忆设计.txt` 两份参考材料不入库，保持本机原样。*
