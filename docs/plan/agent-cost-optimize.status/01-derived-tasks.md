# agent-cost-optimize — 衍生任务记录（附1~附4）

> 拆分自 [agent-cost-optimize.status.md](../agent-cost-optimize.status.md)，原 §附、§附1b、§附2、§附3、§附4（本任务范围外，用户单独批准）；2026-09-27 按渐进式披露拆分，正文未改动。
> 返回索引：[agent-cost-optimize.status.md](../agent-cost-optimize.status.md)

---

## 附：铁律二 consent 闸恢复（衍生任务，L4，用户已批准）

> 本项**不属于** agent-cost-optimize 范围，是排查其门禁问题时发现并由用户单独批准的恢复。
> 按「不擅自新建文件」约束，暂记录于此而非另开 devflow 文档集；如需独立归档可再拆分。

**发现的两处回归（均有提交级证据）**：

| 提交 | 回归内容 |
|------|----------|
| `b55bd58` (2026-08-25) | 删除 `src/main/ai/consent.ts`（17 行）→ `ipc.test` / `agentLoop.test` / `agent-perf-benchmark` 三个文件的 `vi.mock('@main/ai/consent')` **自此空转** |
| `61e8036` (2026-08-27) | 有意删除 `ConsentOverlay.tsx`(81) + 其测试(65)、摘除 chat/rewrite/agent 三处闸、掏空 `needsConsent`→恒 false、改写 `consent.test.ts` 与 `agentStore.test.ts` 断言 |

**恢复内容**（新建 3 + 修改 12，全部为逆向取回原语义，非重写）：

| 层 | 文件 | 改动 |
|----|------|------|
| 注入缝 | `src/main/ai/consent.ts`（新建） | `needsConsent` re-export + `needsKbSendConsent`，恢复三个测试文件的 mock 落点 |
| 判定 | `src/shared/ai/config.ts` | `needsConsent` 恢复为 `!consent?.allowNetwork` |
| 主进程闸 | `chatHandlers` / `rewriteHandlers` / `agentHandlers` / `agentContext` | 恢复 `consent_required` 抛出/返回；agent 侧为**入队前同步拒绝**（不可入队后再拒） |
| 迁移 | `agentHelpers.ts` → `consent.ts` | `needsKbSendConsent` 迁至注入缝，恢复 `!consent.allowSend` |
| UI | `panel/ConsentOverlay.tsx`（新建）+ `panel/AIAgentPanel.tsx` 挂载 | 从 `61e8036^` 取回；i18n 键 `ai.consent.*` 三语言本就完整保留 |
| 触发 | `agentStore.ts` 3 段 | 发送前联网闸 / KB 外发闸、`failedCode==='consent_required'` 与 catch 分支 → `pendingConsent:true` |
| 测试 | `consent.test.ts`、`agentStore.test.ts`、`ConsentOverlay.test.tsx`（新建） | 恢复原正向断言；还原 `61e8036` 反向改写的 3 条；补回 2 条 `consent_required` 信封用例 |

**不做 UI 的后果（恢复前已验证）**：`allow_network`/`allow_send` DB 默认值为 `0`，`agentStore` 触发逻辑与 overlay 同时被删 —— 只恢复闸会使 chat/agent/rewrite **全部永久返回 `consent_required`**。故 UI 必须同步取回。

**不恢复铁律一**：`61e8036` 同时移除了写入确认（`writeMode` 默认改 `auto`、工具直写盘）。用户仅批准恢复**铁律二**，写入侧保持现状，已核实无越界改动。

**E2E 归因（双重证据）**：
1. **结构不可达** —— `vite.test.config.ts` 为 renderer-only（无 `vite-plugin-electron`，主进程不启动）；
   本次 6 个改动文件的 `src/` 反向依赖全部闭合在 `src/main/ai/` 内，renderer 对 `@main` 的引用仅
   `import type`（`env.d.ts` / `weaveMDBridge.ts` / `agentStore.ts` / `useNavbarActions.ts`，编译期擦除）。
2. **基线逐条比对（已完成，结论：0 新增失败）** —— `git stash push --include-untracked` 后在干净 HEAD 复跑得
   **112 failed / 1 skipped / 20 passed（23.5m）**；consent 恢复 + 门禁修复后复跑得
   **112 failed / 1 skipped / 20 passed（22.1m）**；协议分流接线后全量复跑得
   **112 failed / 1 skipped / 20 passed（21.9m）**。三份日志失败用例集合经规范化（去序号 / 时长 / 填充线 / CR）
   后 `comm` 双向对比：**新增 0 条、消失 0 条**，`diff` 判定完全一致。
   `git stash pop` 返回 0，工作区 14 个文件全部恢复，复验 `vitest` 3218/0、`tsc` exit 0。
3. **ConsentOverlay 两条 E2E 仍失败（既有问题，未因恢复而变坏）** ——
   `ai-agent-panel.spec.ts:537`（同意后放行）与 `:576`（拒绝则中止）在基线与当前**均失败**（均 1.0m 超时），
   落在上述 0 差异集合内；说明 overlay 恢复后这两条未转绿，归入下一任务「E2E 先修根因」一并排查，不属本次引入。

### 附1b：联网同意闸停用（L4 安全策略变更，用户已确认）

> 恢复后用户追问「铁律二为什么还要联网同意 —— 我已要求 LLM/Embedding/搜索三配置齐全才能用 Agent，
> 少一个都上锁，这不冗余吗」。判定成立并经用户**「确认」**批准：砍 `allowNetwork` 层，保留 `allowSend` 层。

**判定依据**：后端恒 remote + `isConfigured` 三配置门禁，配置 key 本身已表达联网意愿，再弹联网同意属重复确认。
`allowSend` **不冗余**：配置门禁管「能不能发」，`allowSend` 管「发什么」——典型场景为配了 key 让 Agent 回答，
但不希望它把当前文档全文外发。

| 层 | 文件 | 改动 |
|----|------|------|
| 判定 | `src/shared/ai/config.ts` | `needsConsent` 改为恒 `return false`（签名与导出保留，4 个主进程调用点与 `agentStore` re-export 兼容） |
| 渲染闸 | `src/render/stores/agentStore.ts` | `sendAgentMessage` 删联网闸分支，仅留 `useKnowledgeBase && !allowSend`；`import { needsConsent }` 从值导入降为纯 re-export |
| UI | `ConsentOverlay.tsx` + `AIAgentPanel.tsx` | 弹层只剩「允许笔记外发」勾选（`ConsentChoice` 仅 `allowSend`）；`onRemember` 恒置 `allowNetwork: true` 兼容持久化字段 |
| 注释 | `agentContext` / `agentHandlers` / `chatHandlers` / `rewriteHandlers` / `agentLoop` / `consent.ts` / `rewrite.ts` | 7 处改为「联网闸已停用」，调用点与 `consent_required` 同步返回约束保留 |
| i18n | `en/zh-CN/zh-TW.json` | 删孤儿键 `ai.consent.allowNetwork`（UI 已不引用）；`IAIConsent.allowNetwork` 与 DB 列 `allow_network` **保留**作历史数据兼容 |
| 测试 | `consent.test.ts` / `agentStore.test.ts` / `ConsentOverlay.test.tsx` / `e2e/ai-agent-panel.spec.ts` | 断言改为「恒 false / 不弹层」；E2E 新增 `agentResult.consentRequired` mock 以驱动 `consent_required` → 弹层 → 拒绝 的兼容路径 |
| 文档 | `.claude/CLAUDE.md`、`REQUIREMENTS.md` AGT-19、`specs/ai-panel-features.md`、`modules/11-AI代理面板-Agent.md`、`architecture/security.md` | 铁律二措辞同步为「笔记外发需知情同意」 |

**已知残留（记录，未处理）**：
1. `ConsentOverlay` 在生产中**当前不可达** —— 渲染侧唯一触发条件是 `useKnowledgeBase && !allowSend`，
   而 `useKnowledgeBase` 硬编码 `false` 且 `setUseKnowledgeBase` 无任何组件调用方（KB 开关属 B 类 4 项，
   用户已判定为有意废弃，不恢复）。E2E 只能经 mock 的 `consent_required` 信封驱动弹层。
2. `agentHandlers` 中 `consent_required` 的注释写「KB 外发闸沿用同一错误码」，但该 handler 目前
   **只有** `needsConsent` 一条返回路径（现恒 false），KB 外发闸并未在 AGENT_RUN 层实现。
3. 主进程 4 个 `needsConsent` 调用点与 `ipc.test` 3 条 `consent_required` 用例保留（分支仍在，mock 可驱动）。
4. i18n 遗留孤儿键 `ai.settings.allowNetwork`（本次改动前已无引用，未动）。

## 附2：协议分流接线（衍生任务，L3，用户已确认方案）

> 用户选定「**只分流非工具调用点**」。关键前提：`anthropicClient.ts` / `anthropicCompat.ts` 全文零
> `tool`/`tools`/`tool_use` 命中 —— Anthropic 路径无工具调用支持，把 `agentLoop` 分流过去会打爆
> 创作 Agent 工具循环（createFile / editBlocks / searchKB / ask_question_card），违反质量硬约束。

### 方案：protocol 落 `ai_config` + 5 个纯文本调用点分流

**A. protocol 持久化（5 文件）**

| 文件 | 改动 |
|------|------|
| `src/main/db/index.ts` | `addColumnIfMissing(database, 'ai_config', 'protocol', "TEXT NOT NULL DEFAULT 'openai'")`（沿用 write_mode 既有幂等补列模式，不动历史迁移） |
| `src/main/db/ai.ts` | `AiConfigRow.protocol` + `AiConfigDbRow.protocol` + `mapConfigRow`（非法/缺失收敛 `openai`）+ `AiConfigUpdate.protocol` + UPDATE/INSERT/返回值 |
| `src/shared/ai/config.ts` | `IAIConfig.protocol?: ModelProtocol`（**可选**：旧数据与既有测试字面量缺省即走 openai，安全默认方向） |
| `src/main/ai/ipc/shared.ts` | `toIAIConfig` 映射（`config.protocol ?? 'openai'`）+ `DEFAULT_AI_CONFIG.protocol` |
| `src/main/ai/ipc/modelConfigHandlers.ts` | 激活模型配置时把 `modelConfig.protocol` 同步进 `ai_config`（原先只同步 baseUrl/model/apiKeyEnc） |

**B. 调用点分流（全仓 7 个 LLM 调用点：6 分 1 不分）**

| 调用点 | 是否分流 | 理由 |
|--------|----------|------|
| `rewrite.ts` | ✅ 分流 | 纯对话，不带 tools |
| `chatHandlers.ts` | ✅ 分流 | 纯对话，不带 tools |
| `skillLoader.ts` `runSkill` | ✅ 分流 | 纯文本生成，不带 tools |
| `agentContext.ts` HyDE | ✅ 分流 | 假设文档生成，纯文本 |
| `contextManager.ts` 回退模式 | ✅ 分流 | 独立 system prompt 压缩，纯文本 |
| `contextManager.ts` cache-safe fork | ⚠ **分流但不传 tools** | 压缩只读文本、不消费 `tool_use`；**不分流会让 anthropic 配置下压缩打到错误端点直接失败**。openai 路径 `tools` 前缀缓存优化保持原样 |
| `agentLoop.ts:270` 主循环 | ❌ **唯一不分流** | 带 tools 的 Agent 工具循环，Anthropic 路径无 tool-use 支持 |

分流形式为调用点内联三元（`protocol === 'anthropic' ? streamAnthropicCompletion(opts) : streamChatCompletion(opts)`），
**不新建文件、不新增依赖**；`SkillRunnerCtx` / `SummarizeCtx` 各加可选 `protocol` 字段，由
`agentContext.ts` 构造 `skillContext` 时从 `config.protocol` 透传（该对象同时充当两者的 ctx）。

**TDD**：RED **8 failed**（`aiDao.test.ts` +4、`ipc.test.ts` +3、`skillLoader.test.ts` +1）→ GREEN 全绿。

**边界**：全仓 7 个 LLM 调用点已复核，仅 `agentLoop.ts:270` 主循环保持 OpenAI 兼容路径。
故 B2 缓存断点收益覆盖 rewrite / chat / runSkill / HyDE / 压缩五类调用；Agent 主循环的
33%~44% 估算收益需先补 Anthropic tool-use 支持，属独立 L3，未获批不启动。
`anthropicCompat.ts` 的 `isAnthropicModel` 仍无外部调用方，保持现状（计划外）。

## 附3：E2E 锚点改写（衍生任务，L2，用户已选定「继续改 E2E」）

> 用户选项原文：「4 个已删 testid（ai-mode-select / open-settings-btn / model-form-save / provider-disconnect）
> 改为新锚点，composer 的 textarea 改为 TipTap 锚点。跟随产品有意演进，不动产品。」

**只改 `e2e/ai-agent-panel.spec.ts`，0 处产品源码改动。** 收敛：单 spec **4 passed / 31 failed → 21 passed / 14 failed（+17）**；
第二轮 B 类断言处置 + 补全根因修复后 **→ 27 passed / 4 failed（共 31 条，见 §附4）**。

### A 类 — 有明确记录的有意移除 / 文案变更（已改写）

| 项 | 证据 | E2E 改法 |
|----|------|---------|
| composer `textarea` → TipTap | TipTap 重构后无 textarea | 23 处 `.composer-tiptap-editor` + 6 处 `toHaveValue`→`toHaveText` |
| 4 个已删 testid | `ai-mode-select` 随单面板化删除等 | `switchMode` 改为断言 count 0；设置类 4 条改走全局 `UnifiedSettings` + `model-config-*` |
| Chat 模式已删 | CLAUDE.md「③ 删除 Chat 模式」 | 5 条 `你好，我是 mock AI。你说的是：X` → `Agent 完成：X`（与 `routePlainAgent` 实际路由一致） |
| 改写预览卡标题 | `ai.rewrite.previewTitle` 零代码引用；实际标题为 `文档改写(−X / +Y)` | 7 处 `改写预览` → `/文档改写\(/` |
| 卡片按钮文案 | `ai.diff.*` 全不在 zh-CN，走 fallback | `应用`→`全部应用`、`取消`→`全部废弃` |
| 内联 diff 收起 | `DiffSummaryCard` 注释「单文件：不再展开内联 diff」 | `[data-type]` 断言改为先点「查看详情」进 `RewriteDetailModal`（Escape 关闭） |
| FileMenu 已删 | `TopBar` 注释「移除 FileMenu/HistoryMenu/MoreMenu/ExportMenu」 | 改走文件树：再点一次已打开文件即关闭（`FileTreePanel.handleFileClick`） |
| mock 数据源 | `ModelDropdown` 读 `modelConfigs` 而非 `ai.listModels` | 新增 `opts.modelConfigs`，模型下拉用例注入 3 条 |
| mock 缺 API | `updateMessageToolCalls is not a function` → pageerror | 补 mock 方法 |

### B 类 — 疑似真实回归（**4 项**；处置结果见 §附4，下表保留为断链点证据）

第一轮按硬规则「改断言 = 替用户确认功能移除」「不确定时必须先请求确认」，这 4 项的 E2E 断言**原样保留作为回归证据**。
后续用户裁定见 §附4。**下表「卡住的 E2E」列的行号是 §附4 处置前的旧文件行号**（该轮删 4 条 + 改 8 条后已整体位移），仅作历史索引；
处置后的行号见 §附4「剩余 4 条为什么改不了」表。

| # | 功能 | 断链点 | 双重证据 | 卡住的 E2E |
|---|------|--------|----------|-----------|
| B1 | **选区改写闭环** | `21fedb2` 删浮动工具栏「AI 改写」按钮（CLAUDE.md 有记录），但连带 `readDocumentSelection`→`startSelectionRewrite` 全链**生产调用方归零**（仅单测调用）→ `selectionContext` 恒 null → `routeSelectionRewrite` 永不进入。**删按钮有记录，能力丢失无记录** | `rewriteStore.ts:10` 头注释仍写该入口；store/预览卡/应用逻辑全活 | 8 条（865/961/1002/1078/1225/1272/1680/1726） |
| B2 | **KB 导入入口** | `dfa54ff` 删 `AIPanelSession` 中 `KnowledgeBaseSettings` 渲染，重构目标 `AIPanelSettings` **从无 KB tab**，`ec566fc` 的 `UnifiedSettings` 8 个 tab 也**无 knowledge**；IPC（`kbHandlers` + preload `kb.importFile`/`importDir`）完整存活但**零 UI 入口** | `KnowledgeBaseSettings.tsx` 全仓零引用；`AIPanelSession.tsx:5` 注释仍写「agent 模式显示 KnowledgeBaseSettings（原样复用，R15）」 | 735 |
| B3 | **知识库创作开关** | `agentStore.ts:260` `useKnowledgeBase: false` 硬编码，`setUseKnowledgeBase`（:1024）**无任何组件调用** → `agentToolSelector` 注入 `searchKB` 的条件永不成立 | `agentLoop.test.ts` / `agent-perf-benchmark.test.ts` 该字段仍有大量单测 | 621、1472 |
| B4 | **意图卡（低置信澄清）** | `runAgent` 已改任务队列+SSE（返回只读 `taskId`），而 SSE 事件类型仅 `chunk/tool/interaction/done/error`（`conversation.ts:67-69` 的 `done` **不带 intent**）→ `intentCard` **全仓只被清空、从未写入** → `IntentCard` 永不渲染 | 主进程 `agentLoop.ts` 仍产出 `ctx.intent` 并进 `shared/ai/task.ts:69` 任务结果；`IntentCard.tsx` + `AgentTab.tsx:311` + `ai.intent.*` i18n 全活 | 761 |

### 既有失败（非本轮引入，基线即红）

`@ 补全`（1328）、`/ 补全`（1383）—— 第一轮判断「扩展与 i18n 均正常但 `fill('@')` 不触发 suggestion」**不成立**。
第二轮实测定位的真根因是**断言写给已退役的 `CompletionMenu`**（期望值与屏幕不符，与弹层是否挂载无关），
已按用户裁定改断言对齐现状并转绿，详见 §附4。

## 附4：B 类断言处置 + `@`/`/` 补全根因（用户逐项裁定，已执行）

> 第一轮按硬规则未改断言、等用户裁定；本轮用户对三组分别给出答复，全部执行完毕。
> **只改 `e2e/ai-agent-panel.spec.ts`，0 处产品源码改动。**

### 裁定与执行

| 组 | 用户裁定 | 执行结果 |
|----|---------|---------|
| 知识库 3 条 + intentCard 1 条（测试对象已完全不存在） | 删掉这 4 条（明确批准删测试） | 已删：`智能体模式…知识库开关/压缩/知识库设置入口`、`知识库设置区…导入按钮`、`意图卡片…低置信 intent`、`B3 专属控件归属`。测试 35 → 31 |
| AI 改写 8 条（能力还在，只是工具栏入口没了） | 改走 `@文档 ` 路径，保住覆盖 | 4 条闭环类已切到 `sendRoutes.routeDocScope` → `startDocumentRewrite`；4 条选区特有断言无法转换（见下表） |
| `@`/`/` 补全 2 条 | 改断言对齐现状 | 已改并转绿 |

### 删前 4 条的证据

- `KnowledgeBaseSettings.tsx` 全仓**零引用**（仅 `AIPanelSession.tsx:5` 一句注释提到，组件从未 import/渲染）
- `ai.agent.kbSettings` / `ai.agent.useKnowledgeBase` / `ai.agent.compress` 三个 i18n 键**代码引用数 0**（孤儿键）
- `intentCard` 在 `agentStore` **只被写 null**（:541 / :616 / :1277 / :1292 / :1317），无任何写入非 null 的路径 → `IntentCard` 永不渲染

### 4 条改走 `@文档 ` 的改法

| 测试 | 触发改动 | 断言保持不变 |
|------|---------|-------------|
| 改写闭环 | `selectTextRange`+点按钮 → `composer.fill('@文档 …')`；mock 补 `documentText` | 预览卡红删绿增 → 全部应用 → 内容更新 → 一次 Ctrl+Z 还原 |
| stale 拒绝 | 同上 | 预览期间改文档 → 应用被拒「文档已变更」 |
| unchanged | 同上；mock `documentText` 与原文相同 → `stateToMarkdown` 往返不变 | 提示「无变化」且不弹预览卡 |
| 改写失败条 ✕ | 同上 | 提示条出现 → 点 ✕ → 消失 |

顺带修掉一处被更早失败掩盖的 locator 缺陷：原 `getByRole('button',{name:'关闭'})` 同时命中面板关闭（`title=关闭`）、
会话关闭（`title=关闭当前会话`）、提示条 ✕（`aria-label=关闭`）三个元素 → strict mode 违规；
改 `getByLabel('关闭',{exact:true})` 精确定位 ✕。

### 剩余 4 条为什么改不了

根因比「入口换了」更深：`startSelectionRewrite` 在 `src/` **零生产调用方**（仅 `rewriteStore.ts` 自身声明/实现 +
`rewriteStore.test.ts`），最后一个调用方随 `21fedb2` 删除 AI 改写按钮一起消失。连带 `selectionContext` 恒 null →
`.rewrite-highlight`、`.rewrite-cancel-capsule`、composer 占位提示「描述如何改写选中内容」、
`routeSelectionRewrite`（`if (!ctx.selectionContext) return false`）**全部生产不可达**。

| 测试（处置后行号） | 核心断言 | 能否改走 `@文档 ` |
|------|---------|------------------|
| A4 跨块选区改写（`spec:994`） | 只替换**选中区间**，区间外字节零改动 | ❌ document scope 改的是整块编号映射，无「区间」语义 |
| A2 混合语法类型（`:1141`） | 工具栏含「AI 改写」按钮、无行内格式/块类型下拉 | ❌ 断言对象就是已删除的按钮 |
| A3 选区保持（`:1188`） | `.rewrite-highlight` 持久高亮 + 面板聚焦不清除 | ❌ 高亮由 `selectionContext?.sel` 驱动，恒 null |
| ① 整块高亮+取消（`:1616`） | 渐变高亮 + 左缘取消胶囊 + 点取消清高亮 | ❌ 胶囊与高亮同源，同为 selection 驱动 |

**用户裁定：保留作已知失败**（「保留作已知失败（推荐）」）—— 测试原样不动不删，作为该能力曾存在的回归证据；
`ai-agent-panel.spec.ts` 段**永久 4 failed**。恢复入口选项与先前「不恢复废弃功能」的裁定冲突，未采纳。

### 补全 2 条的真根因（推翻第一轮判断）

第一轮记的「扩展与 i18n 均正常但 `fill('@')` 不触发 suggestion」**不成立** —— 实测首条断言就超时，
因为**期望值与屏幕不符，与弹层是否挂载无关**：

| 断言 | 测试期望 | `29f6ec2` 后实际 |
|------|---------|-----------------|
| `@` 标题 | `引用`（exact，i18n `ai.completion.refTitle`） | `@ 引用`（`MentionSuggestionList.tsx:67` 硬编码） |
| `@` 选项 | `当前文档` / `知识库文档` | 文件树文件/目录（`setMentionItemsGetter`） |
| `/` 标题 | `运行技能`（exact，i18n `ai.completion.skillsTitle`） | `技能`（`SkillSuggestionList.tsx` 硬编码） |

佐证：`CompletionMenu.tsx` / `MentionList.tsx` 全仓 **0 引用**（已死组件仍在盘上）；
`ai.completion.{skillsTitle,refTitle,currentDoc,currentDocDesc,kbDoc,kbDocDesc}` 六键**代码引用数 0**。
另发现菜单 `props.mount()` 默认挂 `document.body` 而非 AI 面板 aside → 断言定位由 `panel.` 改 `page.` +
`[role="listbox"]` 过滤。`/` 测试后半段改走 chip 路径（点选项注入 `skillTag` → `pressSequentially` 补指令 → Enter），
避开纯文本 `/技能名 ` 仍让 suggestion 激活、其 `onKeyDown` 吞 Enter 的问题。

### 收敛

单 spec **21 passed / 14 failed → 27 passed / 4 failed（6.5m）**；测试总数 35 → 31。
通过数相对原始基线 **4 → 27（+23）**。
