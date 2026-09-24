# agent-cost-optimize — 实施计划

> 创建：2026-09-23 | 来源：[需求文档](../requirements/agent-cost-optimize.req.md) | 定档：**M** | TDD：standard

---

## 1. 变更清单

### 1.1 新建文件

| 文件 | 用途 |
|------|------|
| `tests/main/ai/agentPromptBuilder.test.ts` | A1–A5：域规则 / 条件化回答格式 / 长度上限 / 模板改写 / 豁免关键词；**含 B1 门控谓词测试** |
| `tests/main/ai/anthropicCache.test.ts` | B2：cache_control 断点 + usage 解析 |

> 复用已有测试文件扩展：`costTracker.test.ts`（B4）、`toolResultStorage.test.ts`（B3）。
>
> **⚠ 偏离原方案记录**：原计划为 B1 单开 `agentContextDocGate.test.ts`。实现期改为把 B1 断言并入 `agentPromptBuilder.test.ts` —— 门控谓词 `shouldInjectDocumentContext` 定义在 `agentPromptBuilder.ts`（纯函数、无 electron 依赖，可直接单测），而 `agentContext.ts` 引入 `electron`/`db`，单测需整套 mock。收益不变，测试文件由 3 个减为 2 个。

### 1.2 修改文件

| 文件 | 关联项 | 变更级别 | 说明 |
|------|--------|----------|------|
| `src/main/ai/costTracker.ts` | B4 | 小 | `calculateCost` 计入缓存读/写折扣；新增 `resolveCachePricing` |
| `src/main/ai/agent/agentPromptBuilder.ts` | A1–A5 | 中 | 新增域规则段、条件化回答格式、改写写入规则、导出长度上限常量 |
| `src/main/ai/agent/agentContext.ts` | B1 | 小 | `buildDocumentContext` 调用加意图门控 |
| `src/main/ai/llm/anthropicClient.ts` | B2 | 中 | `system` 加 `cache_control` 断点；解析 `message_start.usage` |
| `src/main/ai/agent/agentLoop.ts` | B2 | 小 | defer schema 升级后标记前缀变更点 |
| `src/main/ai/agent/toolResultStorage.ts` | B3 | 小 | 阈值常量 30k/120k → 10k/40k 字符 |

### 1.3 依赖变更

无。本次不新增任何 npm 依赖。

---

## 2. 详细方案

### 2.1 B4 — 成本估算计入缓存折扣

**现状**：`costTracker.ts:74-79` 的 `calculateCost` 只算 `promptCost + completionCost`，已采集的 `cacheReadTokens` / `cacheCreationTokens` 被完全忽略。OpenAI 兼容路径的 `prompt_tokens` 含缓存命中部分，按全价计 → 成本高估。

**方案**：

```
可计费 input = promptTokens - cacheReadTokens - cacheCreationTokens   // 两者都是 promptTokens 的子集
inputCost      = 可计费 input × prompt 单价
cacheReadCost  = cacheReadTokens × prompt 单价 × CACHE_READ_RATE    // 0.1
cacheWriteCost = cacheCreationTokens × prompt 单价 × CACHE_WRITE_RATE // 1.25
outputCost     = completionTokens × completion 单价
```

- `CACHE_READ_RATE = 0.1`、`CACHE_WRITE_RATE = 1.25`（Anthropic 与 DeepSeek 均为此量级）
- 未知模型回退 `default` 单价逻辑保持不变
- `formatCostTable` 增加 Cache Write 列，Cache Hit 列语义改为「已按折扣计费」

**⚠ 偏离原方案记录**：初版公式只扣 `cacheReadTokens`。实现期复核发现 `cacheCreationTokens`
同样是 `promptTokens` 的子集，只扣 read 会把写入部分按全价计一次、再按 1.25× 计一次（重复计费）。
故补扣 write。同时明确 **`promptTokens` = 含缓存的输入总量**（OpenAI/DeepSeek `prompt_tokens` 语义），
Anthropic 客户端上报前换算为 `input_tokens + cache_creation + cache_read`，两条协议共用同一公式。
原公式的两个用例（只设 read、只设 write）结果不变，仅两者同时非零时才产生差异。

**回滚**：纯函数改动，单测覆盖有/无缓存两态，回退即恢复原式。

### 2.2 A1–A5 — 文件操作叙述削减

**现状**（三处冲突规则，行号基于 `agentPromptBuilder.ts`）：

| 行 | 现规则 | 问题 |
|----|--------|------|
| :204 | `安全变更…：直接执行并告知结果` | diff 卡片已展示，强制复述 |
| :206-207 | `调用删除工具前，必须在回复中说明即将删除的内容和原因` | 与确认卡片 `确认删除 ${fileInfo}？此操作不可恢复` 内容重复 |
| :215-219 | `## 回答格式 … 善用标题/列表/代码块 … 长回答用标题分段` | 无条件生效，把结果报告撑成结构化 Markdown |

**方案**：

- **A1** 新增 `## 文件操作后的回复` 段，插在 `## 写入规则` 之前，列举 8 个写工具名，规定 ≤2 行、不复述卡片内容、不加标题/列表/总结/后续建议、澄清提问不受限。
- **A2** `## 回答格式` 拆为条件式：知识类回答（检索/分析/问答）保持原结构化规则；文件操作轮次走 A1。原条款保留为分支，不删除。
- **A3** 改写 :204 与 :206-207 —— 结果告知降为「执行成功即可」；删除前说明降为「仅目标不唯一时列清单」，其余由确认卡片承担。
- **A4** 导出 `FILE_OP_NARRATION_TOKEN_LIMIT = 80`，写入 A1 段；档位常量 `0/40/80/160` 供 A/B 调参。
- **A5** 参考模板改写并入，取舍如下：

| 源模板条目 | 适配 |
|-----------|------|
| 回复风格（禁寒暄 / 不复述问题 / 结论先行 / 不解释基础概念） | 保留，追加到 `## 回答格式` 顶部 |
| 代码输出（只出 diff / 新建才出全量 / 禁叙述性注释） | **替换**为「文件操作输出」——写工具产物由 diff 卡片承载，回复不复述 |
| 格式（禁 emoji / 列表 ≤5 / 段落 ≤3 句） | 保留，与现有禁 emoji 条款合并 |

**不整体注入模板原文**：避免 Caveman 自承的「规则文件每次调用 +~1,000 input tokens，短问答倒亏」。

### 2.3 B1 — 文档上下文意图门控

**现状**：`agentContext.ts:366-371` 对所有非 chat 意图注入 `buildDocumentContext(payload.currentDocument)`，上限 5,000 tokens，**每轮重发**。create/delete/web/kbQa 场景本就读不到当前文档。

**方案**：门控改为 `intent ∈ {rewrite, create, tech} && payload.currentDocument` 才注入；`chat` / `kbQa` / `web` 一律不注入。`needsClarification` 分支（chat 判定但走 Agent 提示）同样不注入。

**⚠ 偏离原方案记录**：初版写为「仅 rewrite 注入」，实现前复核发现该口径有质量风险 —— `create` 意图下模型需要当前文档作参考（如「参考文档 A 建 B」），且 `editBlocks` 在 create/tech 意图可用（`agentToolSelector.ts:124`）。故放宽至三个写作意图，仅剔除与当前文档无关的 `chat`/`kbQa`/`web`。收益面收窄，质量约束优先。

**回滚**：一行条件改动。

**风险**：`editBlocks` handler 读的是 `toolCtx.currentDocument`（payload 直传，不受本项影响）；但模型侧确实需要看到文档全文才能产出合理改写，故 `rewrite`/`create`/`tech` 必须保留注入。`chat`/`kbQa`/`web` 的回答来源分别是对话、知识库、搜索结果，当前文档对它们是纯冗余。

### 2.4 B2 — Prompt 缓存断点 + defer 升级

**现状**：
- 全代码库 `grep cache_control` 零命中；`anthropicClient.ts:145-150` 的 `body.system = systemParts.join('\n\n')` 是字符串，无断点 → 4k–9k 稳定前缀每轮全价。
- `anthropicClient.ts:101-104` 对 `message_start` 直接忽略 → **Anthropic 协议路径从不上报 usage**，缓存效果无法验证、`costTracker` 无数据。
- `agentLoop.ts:376` 将 deferred stub 替换为完整 schema 会改写 `tools` 数组，而 `createFile`/`deleteFile`/`editLocalFile`/`renameFile`/`moveFile`/`preview_file_revision` **全部 deferred** —— 恰好在目标场景打穿前缀。

**方案**：

1. `system` 由 `string` 改为 `[{type:'text', text, cache_control:{type:'ephemeral'}}]`，断点落在系统提示块末尾。
2. `messages` 侧：`tools` 数组整体作为一个可缓存单元，在 OpenAI 兼容路径通过 `stream_options` 不可行，故**只在 Anthropic 路径加断点**（OpenAI 兼容路径依赖 provider 自动前缀缓存，DeepSeek 已有）。
3. 解析 `message_start` 的 `message.usage` → `StreamChunk.usage`（`input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens`），与 OpenAI 路径字段对齐。
4. defer 升级处理：升级发生在 `agentLoop.ts:376`，升级后**该轮及之后的缓存前缀必然失效**（无法避免，schema 确实变了）。缓解措施——把升级时机**前移到首次 LLM 调用之前不可行**（不知道会调哪个工具），故采用：升级后不重建断点（断点由 API 自动按前缀匹配），并在 `upgradedDeferredTools` 已有集合基础上确保同一工具**只升级一次**（现状已满足）。真正收益来自未触发 defer 的轮次（占多数）。

**验收**：单测断言 body.system 为带 `cache_control` 的数组；`message_start` usage 被解析进 `StreamChunk.usage`。

**⚠ 实施期发现（必须知悉）**：`streamAnthropicCompletion` **在 `src/` 内零调用方** ——
`agentLoop` → `streamChatCompletionWithRetry` → `streamChatCompletion`（OpenAI 兼容路径）无条件分支，
`ModelProtocol` 只在 DB/IPC 层读写，从未参与请求分流；`anthropicCompat.ts` 同样无外部调用方。
即 B2 的断点与 usage 解析**已实现并通过单测，但当前不产生运行时收益**，属既有接线缺口。
同理 `agentLoop.ts` 的注释改动也只对未来生效。

**后续接线（衍生任务，L3，用户已确认方案）**：按「只分流非工具调用点」补齐 B2 运行时收益 —— 见
`docs/plan/agent-cost-optimize.status.md` §附2 协议分流接线。

**回滚**：还原 `body.system` 为 join 字符串、还原 `message_start` 为 return null。

### 2.5 B3 — 工具结果预算收紧

**现状**：`toolResultStorage.ts:20,23` 单工具 30k 字符（≈7.5k tok）、聚合 120k 字符（≈30k tok），而 `CONTEXT_WINDOW = 64k` —— 单轮即可吃掉近半上下文。

**方案**：`MAX_SINGLE_RESULT_CHARS` 30_000 → **10_000**（≈2.5k tok）；`MAX_AGGREGATE_RESULTS_CHARS` 120_000 → **40_000**（≈10k tok）。`PREVIEW_LENGTH` 500 不变。注释同步更新。

**质量风险与缓解**：阈值下调可能截断必要信息。缓解——
1. 超限内容**写入文件而非丢弃**，预览带恢复路径（现有机制，行为不变）；
2. A/B 三场景（create/edit/delete）验证工具调用正确率不降；
3. 若 A/B 显示信息丢失，回滚至 15k/60k 折中档。

**回滚**：改回常量即可。

---

## 3. TDD 计划（standard）

| 项 | RED（先写失败测试） | GREEN（最小实现） |
|----|---------------------|-------------------|
| B4 | 断言有缓存时成本 < 无缓存时成本；`formatCostTable` 含 Cache Write 列 | `calculateCost` 扣减 + 折扣 |
| A1–A5 | 断言新域规则存在、旧强制表述不存在、长度常量导出、豁免关键词在位 | 改写 `buildAgentSystemPrompt` |
| B1 | 断言 rewrite 注入 / create·delete·web·kbQa·chat 不注入 | `agentContext.ts` 门控条件 |
| B2 | 断言 `body.system` 带 `cache_control`；`message_start` usage 被解析 | `anthropicClient.ts` 两处改动 |
| B3 | 断言新阈值生效且 10_001 字符触发持久化 | 改常量 |

覆盖率记录（不强制 80% 门槛），精简版 TDD 证据写入 `docs/testing/agent-cost-optimize.tdd.md`。

---

## 4. 验收标准

1. 质量门禁全绿：`npx tsc --noEmit` 0 error、`npx vitest run` 全过、`npm run lint` 0 error、`npm run build` 成功、`npx playwright test` 通过。
2. 需求文档 §质量护栏 5 项豁免均有测试断言。
3. create/edit/delete 各一套 A/B 场景记录 token 差值。
4. `formatCostTable` 输出与含缓存折扣的计算一致。
5. 计划变更清单之外无改动；实际 diff 逐项核对。

## 5. 范围控制

只实现本计划 §1 内容。计划外（S15 缓存命中率监控接线、`buildFileListSnapshotCached` 死代码清理、OpenAI 路径 `stream_options` 显式请求 usage）**保持现状**，仅在交付核对时记为遗留问题。
