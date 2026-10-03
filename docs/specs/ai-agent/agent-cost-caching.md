# Agent 成本核算与提示词缓存规范（Agent Cost & Caching）

> 规范编号：SPEC-AGENT-COST | 版本：v1.0 | 状态：生效（已实施）| 更新：2026-10-01
> 关联需求：agent-cost-optimize.req.md（B4 成本、B2 缓存断点、硬性约束）
> 关联模块：[docs/modules/11-AI代理面板-Agent.md](../../modules/11-AI代理面板-Agent.md)
> 关联架构：[docs/architecture/ai-agent.md](../../architecture/ai-agent.md)、[docs/architecture/knowledge.md](../../architecture/knowledge.md)
> 关联规范：[SPEC-AGENT-PTX](./agent-prompt-context.md)（前缀稳定性五原则、提示词组装）、[SPEC-AGENT-TOOL](./agent-tool-runtime.md)（defer 运行时与结果预算）
> 「来源：」中出现的 `docs/plan/*` 均为**已归档的过程文档**（2026-10-04 精简，正文见 git 历史），此处保留仅作溯源。

**分工**：req 管「需求与红线」（为什么），本篇管「实现级行为契约」（怎么算钱、断点打在哪、哪些调用点走哪条协议）。
叙述削减（A1~A5）与文档上下文门控（B1）归 [SPEC-AGENT-PTX](./agent-prompt-context.md)。

**来源标记**：〔cost §2.x〕= `agent-cost-optimize.plan.md`（已归档，见 git 历史）；〔derived 附2〕= `01-derived-tasks.md`（已归档，见 git 历史） §附2。
plan 目录后续移除，标记仅作 git 历史回溯锚点。

---

## 1. 范围

1. 可计费 token 与成本估算公式（含缓存折扣）；
2. 成本表（`formatCostTable`）列语义；
3. Anthropic 路径的 `cache_control` 断点与 usage 上报解析；
4. 全仓 LLM 调用点的协议分流矩阵（`ai_config.protocol`）。

不包含：defer 工具加载的运行时行为与工具结果预算（SPEC-AGENT-TOOL §5/§6）、
缓存命中率监控与 A/B 量化（见 §5 已知限制）。

## 2. 成本核算契约

### 2.1 可计费 input 公式（B4）

`src/main/ai/costTracker.ts` `calculateCost`：

```
可计费 input = max(0, promptTokens − cacheReadTokens − cacheCreationTokens)
inputCost      = 可计费 input × prompt 单价 / 1e6
cacheReadCost  = cacheReadTokens   × prompt 单价 × CACHE_READ_RATE  / 1e6
cacheWriteCost = cacheCreationTokens × prompt 单价 × CACHE_WRITE_RATE / 1e6
outputCost     = completionTokens × completion 单价 / 1e6
estimatedCost  = inputCost + cacheReadCost + cacheWriteCost + outputCost
```

- **两者都是 `promptTokens` 的子集，必须同时扣减** —— 只扣 read 会把 write 部分按全价计一次、再按 1.25× 计一次（重复计费）；
- **`CACHE_READ_RATE = 0.1`、`CACHE_WRITE_RATE = 1.25`**（相对 prompt 单价；Anthropic 与 DeepSeek 均为此量级）；
- 未知模型回退 `default` 单价（偏高估值，便于发现未配置模型）的既有逻辑不变。〔cost §2.1〕

### 2.2 `promptTokens` 语义（两协议共用同一公式）

**`promptTokens` = 含缓存的输入总量**：

- OpenAI 兼容路径（OpenAI/DeepSeek `prompt_tokens`）原生即此语义，直接入账；
- Anthropic 路径上报前换算：`promptTokens = input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
  （`anthropicClient.ts` `mergeStartUsage`）。〔cost §2.1〕

### 2.3 成本表 `formatCostTable` 列语义

- 列含 **Cache Hit** 与 **Cache Write**；**Cache Hit 列语义为「已按折扣计费」**（数字是命中量，金额已按 0.1× 进入 Cost 列）；
- **新增 Cache Write 列**（1.25× 计价）；
- Cost 列 = §2.1 公式结果，表输出必须与含缓存折扣的计算一致（req 验收 4）。〔cost §2.1〕

### 2.4 图片计价边界

图片 token 已含在 provider 的 `promptTokens` 内，`IMAGE_TOKENS_PER_IMAGE = 1300` 仅用于**成本拆分展示**，
**不叠加进 `estimatedCostUsd`**（同一批 token 不得计费两次）。（`costTracker.ts:92`）

## 3. Prompt 缓存断点契约

### 3.1 `cache_control` 断点（B2）

`src/main/ai/llm/anthropicClient.ts:247-254`：

- 请求体 `body.system` 为 **text block 数组**（不再 join 成字符串）：所有 `role='system'` 消息按出现顺序提取为 system 块
  （含主系统提示、文档上下文、分隔/强调消息）；
- **断点只加在数组最后一个块**：`cache_control: { type: 'ephemeral' }`；
- **只在 Anthropic 路径加断点**：OpenAI 兼容路径不加（依赖 provider 自动前缀缓存，DeepSeek 已具备）；
- 断点只落在 system 数组末块，**messages 与 tools 不加断点**（tools 前缀缓存由 provider 侧机制承担）。〔cost §2.4〕

### 3.2 usage 解析（四字段）

- `message_start` 的 `message.usage` 解析进 `StreamChunk.usage`，四字段：
  `input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens`
  （输出侧由 `message_delta` 补 `output_tokens`），与 OpenAI 路径字段名对齐
  （`promptTokens` / `completionTokens` / `cacheReadTokens` / `cacheCreationTokens`）；
- 合并**幂等**：重放同一 `message_start` 事件结果一致（`mergeStartUsage` 只做累加覆盖而非重复叠加）；
- Anthropic 协议路径由此**可持续上报 usage**，供 §2 成本核算消费。〔cost §2.4〕

### 3.3 defer 升级与断点交互

deferred 工具的 stub → 完整 schema 替换发生在 `agentLoop`（改写 `tools` 数组）：

- 升级发生的**该轮及之后缓存前缀必然失效**（schema 确实变了，无法避免）；
- 缓解契约：升级后**不手工重建断点**（断点由 API 自动按前缀匹配）；同一工具**只升级一次**
  （`upgradedDeferredTools` 集合保证，防反复改写 `tools`）；
- 收益主要来自**未触发 defer 的轮次**（占多数）。〔cost §2.4〕

### 3.4 前缀失效边界

system 数组内**任一靠前的动态内容**（如文档上下文，见 SPEC-AGENT-PTX §6）变化，会使整个 system 段缓存失效。
调整提示词内容位置前先读 SPEC-AGENT-PTX §8.1 前缀稳定性五原则。

## 4. 协议分流契约

### 4.1 `ai_config.protocol` 持久化

- 列：`ai_config.protocol TEXT NOT NULL DEFAULT 'openai'`（`addColumnIfMissing` 幂等补列，不动历史迁移；`ai_model_configs` 同款列同默认值）；
- 读取映射：`row.protocol === 'anthropic' ? 'anthropic' : 'openai'` —— **非法/缺失一律收敛 `openai`**（安全默认方向）；
- `IAIConfig.protocol` 为可选字段，旧数据与缺省字面量即走 openai；
- 激活模型配置时 `modelConfig.protocol` 同步进 `ai_config`。〔derived 附2 A〕

判定收口另有 `resolveModelProtocol`（`anthropicCompat.ts:137`）：显式 `protocol` 优先（**显式 openai 不被模型名覆盖**），
未显式配置时按模型名回退（`claude` 系 → anthropic）—— 供图像识别/多模态等带模型名推断的调用点使用。

### 4.2 全仓 LLM 调用点分流矩阵

**设计口径：只分流非工具调用点。** Anthropic 路径（`anthropicClient.ts` / `anthropicCompat.ts`）**无 tool-use 支持**
（全文零 `tool`/`tools`/`tool_use` 命中），带 tools 的工具循环分流过去会打爆创作 Agent 工具循环。〔derived 附2 B〕

首发 7 点矩阵（〔derived 附2 B〕，`docs/plan/` 删除后以代码为准）：

| # | 调用点 | 分流 | 说明 |
|---|--------|:--:|------|
| 1 | `rewrite.ts` | ✅ | 纯对话，不带 tools |
| 2 | `chatHandlers.ts` | ✅ | 纯对话，不带 tools |
| 3 | `skillLoader.ts` `runSkill` | ✅ | 纯文本生成，不带 tools |
| 4 | `agentContext.ts` HyDE | ✅ | 假设性文档生成，纯文本 |
| 5 | `contextManager.ts` 回退模式压缩 | ✅ | 独立 system prompt 压缩，纯文本 |
| 6 | `contextManager.ts` cache-safe fork 压缩 | ⚠️ **分流但不传 tools** | 压缩只读文本不消费 `tool_use`；**不分流会让 anthropic 配置下压缩打到错误端点直接失败** |
| 7 | `agentLoop.ts` 主循环 | ❌ **唯一不分流** | 带 tools 的工具循环，恒走 OpenAI 兼容路径 |

后续新增调用点沿用同一原则接入（现状补充，〔derived 附2〕之后演进）：`agentTaskWorker` 的 `memory_extract` 后台调用、
`image` 图像识别、`files` 多模态解析 —— 均为纯文本/视觉调用，按 `protocol`（或模型名回退）分流。

### 4.3 分流形式与红线

- 形式：**调用点内联三元** `protocol === 'anthropic' ? streamAnthropicCompletion(opts) : streamChatCompletion*(opts)`，
  **不新建文件、不新增依赖**；
- `SkillRunnerCtx` / `SummarizeCtx` 携带可选 `protocol` 字段，由 `agentContext` 构造时从 `config.protocol` 透传；
- **红线：`agentLoop` 主循环是唯一不分流点** —— 给 Anthropic 路径补 tool-use 支持属独立 L3，未获批不启动；
  在此之前 Anthropic 断点（§3）对主循环不产生收益，成本收益面 = §4.2 的纯文本调用点。〔derived 附2 B 边界〕

## 5. 已知限制（长期有效）

1. **S15 缓存命中率监控未接线**、**OpenAI 兼容路径不显式请求 usage**（`stream_options`）—— 均为计划外保持现状
   （〔cost §5〕），命中率与净额量化依赖真实调用数据；
2. **Anthropic 断点不覆盖主循环**（§4.3 红线所致）：`protocol='anthropic'` 下 Agent 工具循环仍走 OpenAI 兼容端点，
   `cache_control` 断点对该路径无意义；
3. **system 段动态内容致失效**（§3.4）：文档上下文注入轮次的 system 缓存命中率受动态前置内容影响，
   与 SPEC-AGENT-PTX §8.2 L4 未落地是同一欠账的两面。

## 6. 边界与红线（交叉引用）

- 功能质量不可降、产物 payload 不动、不减轮次/澄清/确认卡片 → req agent-cost-optimize §硬性约束；
- 质量护栏 5 项豁免 → 同上 §质量护栏；
- 成本估算含缓存折扣、`formatCostTable` 输出一致 → 同上 验收 4；
- A/B 轨执行顺序与档位属过程信息，见 git 历史中的 plan，不构成行为契约。
