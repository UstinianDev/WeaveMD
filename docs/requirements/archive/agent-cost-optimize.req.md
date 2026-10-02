# agent-cost-optimize — Agent 成本降低优化需求

> 创建：2026-09-23 | 来源：智能创作 Agent 降本方向 + 两轮对齐 | 状态：需求确认完成

## 背景

智能创作 Agent 在 create/edit/delete 文件时，LLM 叙述文本过长，而变更内容已由系统的 diff 对比卡片清晰展示，叙述属冗余。同时输入侧存在三项结构性浪费，构成叙述削减的收益天花板。

## 硬性约束

| 约束 | 说明 |
|------|------|
| 功能质量不可降 | 任何优化不得削弱创作 Agent 的现有功能（完整豁免清单见 §质量护栏） |
| 产物 payload 不动 | `createFile.content`、`editBlocks[].new_content`、`editLocalFile` 全文一律不削减、不压缩 |
| 不减轮次 | `maxRounds` 按意图动态分配机制保持不变 |
| 不减澄清 | 分轮澄清（`ask_question_card`）轮次与问题文本保持不变 |
| 不减确认卡片 | `FORCE_CONFIRM_TOOLS` 删除确认硬拦截保持不变 |
| 不改工具语义 | 工具 schema 的字段、必填项、副作用一律不变 |
| 不引依赖 | 本次不新增任何 npm 依赖 |

## 需求清单

### A 轨 — 文件操作叙述削减（核心诉求）

| # | 需求 | 文件 | 验收标准 |
|---|------|------|----------|
| A1 | 新增「文件操作后的回复」域规则：执行后 ≤2 行、不复述卡片已展示内容、不加标题/列表/总结段 | `agentPromptBuilder.ts` | 系统提示含该段；单测断言关键词存在 |
| A2 | `## 回答格式` 由无条件改为条件式：结构化 Markdown 仅用于知识类回答 | `agentPromptBuilder.ts` | 两条分支均存在；原规则未被删除 |
| A3 | 改写 `告知结果` → `执行成功即可`；删除前说明 → 仅目标不唯一时列清单 | `agentPromptBuilder.ts` | 不再出现「必须在回复中说明即将删除的内容和原因」 |
| A4 | 叙述长度硬上限常量（0/40/80/160 档位，默认 80 tokens） | `agentPromptBuilder.ts` | 常量导出且写入提示 |
| A5 | 参考 rules 模板按写作 Agent 场景改写并入 | `agentPromptBuilder.ts` | 保留「回复风格」+「格式」两域，替换「代码输出」为「文件操作输出」域 |

**A5 模板适配说明**（源模板偏代码开发，需按写作 Agent 调整）：

| 源模板条目 | 适配处理 |
|-----------|----------|
| 回复风格（禁寒暄、不复述问题、结论先行、不解释基础概念） | **保留**，适用于写作 Agent |
| 代码输出（只出 diff、新建才出全量、禁叙述性注释） | **替换**为「文件操作输出」域：变更由 diff 卡片承载，回复不复述内容 |
| 格式（禁 emoji、列表 ≤5、段落 ≤3 句） | **保留**，原 prompt 已有禁 emoji 条款，合并 |

### B 轨 — 输入侧天花板

| # | 需求 | 文件 | 验收标准 |
|---|------|------|----------|
| B4 | `calculateCost` 计入 `cacheReadTokens` / `cacheCreationTokens` 折扣 | `costTracker.ts` | 缓存命中不再按全价计；单测覆盖有/无缓存两态 |
| B1 | 当前文档上下文按意图门控注入（`rewrite`/`create`/`tech` 注入；`chat`/`kbQa`/`web` 不注入） | `agentContext.ts` | 三个写作意图注入行为不变；chat/kbQa/web 不注入 |
| B2 | Anthropic 协议加 `cache_control` 断点；defer schema 升级后前缀可恢复稳定 | `anthropicClient.ts` + `agentLoop.ts` | 稳定前缀带缓存断点；升级后不破坏已建断点 |
| B3 | 工具结果预算由 30k/120k 字符收紧至 10k/40k 字符 | `toolResultStorage.ts` | 常量下调；现有持久化与聚合逻辑回归通过 |

## 质量护栏（豁免清单）

以下内容任何情况下不削减、不压缩：

1. **产物 payload** — `createFile.content`、`editBlocks[].new_content`、`editLocalFile` 全文
2. **澄清问题文本** — `ask_question_card` 的 questions 与选项
3. **知识库出处** — 引用来源与可跳转链接
4. **错误与安全警告** — 含不可逆操作提示
5. **非文件操作场景的回答** — 检索解读、分析、问答一律不受 A 轨影响；A1 域规则仅在调用写工具的轮次生效

## 已对齐问题清单

| # | 问题 | 结论 |
|---|------|------|
| 1 | 是否作用于产物 payload | 否，仅叙述文本（用户两次明确） |
| 2 | 与 `## 回答格式` 的冲突如何解 | 条件化而非删除（A2） |
| 3 | 删除前强制说明是否可删 | 卡片已含文件名与不可逆提示，重复部分削减，目标不唯一时保留清单（A3） |
| 4 | 参考模板是否整体注入 | 否，避免每次调用 +~1,000 input tokens 短问答倒亏；改写后取两域（A5） |
| 5 | 叙述削减的收益量级 | 估算 删除 5.7%~12.6% / 编辑 4.5%~9.4% / 新建 3.3%~6.2%（输入侧天花板所致） |
| 6 | 输入侧是否纳入 | 纳入，B 轨为收益上限决定项；B2 单项估算 33%~44% 且零质量影响 |
| 7 | 执行顺序 | B4 → A1–A5 → B1 → B2 → B3（用户已确认） |
| 8 | 执行档位 | M，TDD standard |

## 验收标准（总体）

1. `npx tsc --noEmit` 0 error、`npx vitest run` 全绿、`npm run lint` 0 error、`npm run build` 成功、`npx playwright test` 通过。
2. 豁免清单 5 项均有测试断言兜底。
3. 叙述削减有 A/B 场景（create/edit/delete 各一套）记录 token 差值。
4. 成本估算含缓存折扣，`formatCostTable` 输出与扣减后一致。
