# agent-cost-optimize — Agent 成本降低优化状态

> 创建：2026-09-23 | 档位：**M** | 最后更新：2026-09-23

## 分级与裁剪理由

| 维度 | 判定 | 依据 |
|------|------|------|
| 请求类型 | 优化（非 Bug、非重构） | 降低 Agent token 成本，不改业务语义 |
| 影响面 | 主进程 AI 模块 5 个文件 | `agentPromptBuilder` / `agentContext` / `costTracker` / `toolResultStorage` / `anthropicClient` |
| 跨模块 | 否 | 全部在 `src/main/ai/` 内，无 IPC 契约变更、无 DB 结构变更、无渲染层改动 |
| 预估工时 | 半天内 | A 轨纯 prompt 改写 + B 轨 4 项局部改动 |
| **定档** | **M（标准）** | 1~3 模块、半天内、无数据/权限/API 结构变更 |

**裁剪**：M 级 → 走完整阶段，TDD 用 standard 强度（RED → GREEN → 重构 → 覆盖率记录 → 精简证据报告）；技术调研仅在方案不确定时执行（本次缓存断点方案已在需求阶段确定，跳过 crw/docs-mcp 调研）。阶段 1 拷问已由前两轮对话完成对齐，不重复 grill。

## 需求对齐记录

前两轮对话已完成对齐，无遗留待确认项：

1. **范围**：仅削减 create/edit/delete 文件操作时 LLM 的**叙述文本**，不触碰产物 payload（`createFile.content` / `editBlocks[].new_content` / `editLocalFile` 全文）。
2. **依据**：diff 对比卡片已承载变更内容，叙述属冗余。
3. **参考模板定位**：`C:\Users\lenovo\Desktop\参考rules模板.md` 是面向 AI 编码工具 AGENTS.md 的规则，偏代码开发；**不整体注入**，按写作 Agent 场景改写后取「回复风格」+「格式」两域，替换「代码输出」域为「文件操作输出」域。
4. **硬约束**：不可为降本牺牲创作 Agent 功能质量（豁免清单见需求文档 §质量护栏）。
5. **执行顺序**：B4 → A1–A5 → B1 → B2 → B3，用户已确认。

## 阶段进度

| 阶段 | 任务 | 状态 | 证据 |
|------|------|------|------|
| 0 | 分级定档 | ✅ 已完成 | 本文档 |
| 1 | 需求对齐 + `req.md` | ✅ 已完成 | `docs/requirements/agent-cost-optimize.req.md` |
| 2 | 规划 + `plan.md` | ✅ 已完成 | `docs/plan/agent-cost-optimize.plan.md` |
| 4 | 实现（B4 → A → B1 → B2 → B3） | ✅ 已完成 | 见 §实现项状态；RED 38 failed → GREEN 82 passed |
| 6 | 全量测试与质量门禁 | ✅ 已完成 | 见 §质量门禁：tsc / vitest 3226-0 / lint 0 error / build exit 0 四项全绿；E2E 全量 **31 failed / 97 passed**（基线 112/20），`ai-agent-panel` 单 spec **27/4** |
| 6.5 | 模块连通性验证 | ✅ 已完成 | 见 §6.5 连通性验证：5 项全通过，0 处残留 |
| 7 | 合规核对（vs CLAUDE.md/规范） | ✅ 已完成 | 见 §7 合规核对：5 项全通过 |
| 8 | 交付核对（gate） | ✅ 已完成 | 见 §8 交付核对：5/5 通过；剩余任务见 §下一任务 |

## 实现项状态

| ID | 项 | 档 | 状态 | 新增测试 | 证据 |
|----|----|----|------|----------|------|
| B4 | costTracker 计入缓存折扣 | L2 | ✅ | +4 | 有/无缓存成本 0.14 → 0.0392；Cache Write 列 |
| A1 | 文件操作叙述域规则 | L2 | ✅ | 5 | `## 文件操作后的回复` 段 + 10 写工具 |
| A2 | `## 回答格式` 条件化 | L2 | ✅ | 4 | 知识类 / 文件操作轮次双分支 |
| A3 | 改写告知结果 / 删除前说明 | L2 | ✅ | 7 | 「必须在回复中说明…」已移除，护栏关键词在位 |
| A4 | 叙述长度硬上限 | L2 | ✅ | 4 | `FILE_OP_NARRATION_TOKEN_LIMIT=80`、档位 0/40/80/160 |
| A5 | 参考模板改写并入 | L2 | ✅ | 8 | `## 回复风格` 段；代码开发专用条款未注入 |
| B1 | 文档上下文意图门控 | L2 | ✅ | 4 | rewrite/create/tech 注入；chat/kbQa/web 不注入 |
| B2 | Prompt 缓存断点 + usage 解析 + 协议分流接线 | L3 | ✅ 已实现/已测，**运行时已接线**（见 §附2） | 6 + 8 | `body.system` 带 `cache_control`；usage 落 `StreamChunk`；5 个纯文本调用点按 protocol 分流 |
| B3 | 工具结果预算收紧 | L3 | ✅ | 5 | 10k/40k 字符；10,001 触发持久化 |

**A/B 静态实测**（详见 `docs/testing/agent-cost-optimize.tdd.md` §9）：
系统提示 1,072 → 1,363 tokens（净 +291，唯一增加输入侧的改动，属稳定前缀、可被 B2 缓存断点覆盖；
其中 A5 已二次压缩 6→3 条，单段 80 → 59 tok，**实测省 21 tok**）；
chat/kbQa/web 每轮**最多省 5,000 tokens**（B1）；文件操作叙述硬上限 80 tokens（A4）。

## 质量门禁（累计）

| 门禁 | 结果 |
|------|------|
| `npx tsc --noEmit` | ✅ 0 error（exit 0） |
| `npx vitest run` | ✅ **3226 passed / 0 failed**（138 文件全绿）— 基线 12 failed 已清零；协议分流后 +8（RED 8 → GREEN） |
| `npm run lint` | ✅ **108 problems (0 error, 108 warnings)** — 基线 115(1 error)，已修 `db/index.ts:31 no-var-requires`，净减 7；协议分流改动的 9 个文件 0 warning |
| `npm run build` | ✅ **exit 0** — vite build 3 段全绿 + electron-builder 产出 `WeaveMD-2.0.8.msi` / `WeaveMD-Setup-2.0.8.exe`，协议分流后复跑仍通过 |
| `npx playwright test` | ✅ **31 failed / 1 skipped / 97 passed（7.1m，共 129 条）** — 6d 全量复跑。基线（干净 HEAD，本任务前）**112 failed / 20 passed（133 条）** → 现 **31/97（129 条，`ai-agent-panel` 删 4 条获批）**：**failed −81、passed +77**。逐 spec（11 个 spec 共 31 条）：`editor-table` 7、`feedback` 5、`drag-selection-markers` 5（标题自带「当前 RED」，预期失败）、**`ai-agent-panel` 4（已裁定保留作已知失败）**、`floating-toolbar` 2、`exit-behavior` 2、`thematic-break` 2、`welcome-doc` / `recent-history-restore` / `image-resize` / `editor` 各 1 |
| `npx playwright test e2e/ai-agent-panel.spec.ts` | ✅ **27 passed / 4 failed（6.5m，共 31 条）** — B 类断言处置后（见 §附4）。基线 **4 passed / 35 failed（35 条）** → 中间态 21/14 → 现 27/31：删 4 条（用户批准，测试对象已不存在）+ 4 条改走 `@文档 ` + 2 条补全改断言，**通过数 4 → 27（+23）**。剩余 4 条为选区改写特有断言，见 §遗留 |

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

## 6.5 连通性验证

| # | 检查项 | 结果 |
|---|--------|------|
| 1 | 旧阈值 30_000 / 120_000 残留 | ✅ `toolResultStorage.ts` 内 **0 处**；全仓 5 处 `30_000` 均为无关常量（embedding 超时、工具执行超时、skill 缓存 TTL、月度预算） |
| 2 | `MAX_*_CHARS` 唯一定义点 | ✅ 仅 `toolResultStorage.ts:22,25` 导出；`agentToolExecutor.ts:208,307` 两处调用方未改动，仍走同两个函数 |
| 3 | `shouldInjectDocumentContext` 接线 | ✅ `agentContext.ts:32` import → `:368` 门控 → `:369` `buildDocumentContext` → `:371` 注入，链路完整 |
| 4 | Anthropic usage chunk 能被消费 | ✅ `agentLoop.ts:318-319` 捕获 `chunk.usage` → `:336-347` 五字段（含 cacheRead/cacheCreation）写入 `costTracker`，与 B4 公式字段一一对应 |
| 5 | 计划外 `src/` 改动 | ✅ **0 处**；diff 与 plan §1.2 六文件逐项一致 |

## 7 合规核对

对照 `CLAUDE.md` / `CONVENTIONS.md` / `SECURITY.md` / `WORKFLOW.md`：

| # | 规则 | 结果 |
|---|------|------|
| 1 | 不用 `any`、禁 `dangerouslySetInnerHTML` | ✅ 六个改动文件 grep **0 命中** |
| 2 | 不碰迁移 / 认证 / 权限 / 密钥 / `.env` | ✅ 改动清单 grep **0 命中** |
| 3 | SQL 必须参数化 | ✅ 本次改动文件**不含 SQL** |
| 4 | 不删除测试（除非明确批准） | ✅ `git status` **无 `D` 条目**（无文件级删除）。单元测试 0 删除；**E2E 删除 4 条属用户本轮明确批准**（「删掉这 4 条（推荐）」，测试对象已完全不存在，见 §附4），已记录于 `tdd.md` §8-13 |
| 5 | 新建文件需先批准 | ✅ plan §1.1 的 6 个新文件全部获批；consent 恢复另建 3 个（`consent.ts` / `ConsentOverlay.tsx` / 其测试），用户已单独批准；**0 个新增依赖** |

## 8 交付核对（gate）

| Gate 项 | 判定 | 依据 |
|---------|------|------|
| 需求文档 §质量护栏 5 项有断言 | ✅ | `tdd.md` §10 逐条核对，5/5 |
| 门禁 5 项已实测并记录 | ✅ | 本文档 §质量门禁 + `tdd.md` §6；全部 5 项已实测。E2E 全量 **112 failed → 31 failed**（基线逐条 `diff` 0 新增；6d 复跑见 §下一任务 6d），`ai-agent-panel` 单 spec **4 → 27 passed**。剩余 31 条中 **10 条为已知/预期失败**（4 条 `ai-agent-panel` 选区改写、已裁定保留；5 条 `drag-selection-markers` 标题自带「当前 RED」；1 条 `floating-toolbar:222` 同属已移除的 AI 改写能力），**其余 21 条属其他 spec 的既有问题**，不在本任务范围 |
| diff 未超出变更清单 | ✅ | §7-1：6 个 `src/` 改动 = plan §1.2；6 个新文件 = plan §1.1；0 新增依赖 |
| 计划偏离已记录 | ✅ | `tdd.md` §8 共 **13 条**，含 B2 未接线、A5 实测差额、consent 衍生任务、协议分流范围、B 类断言处置 + 补全根因（§8-13） |
| 未实测项不以估算充数 | ✅ | 输出侧实际节省、B2 命中率明确标注为**用户 2026-09-24 裁定挂起**，账面事实（+291 tok/轮、硬上限 80 tok）已写入 §遗留 与 `tdd.md` §9.3，**未以估算冒充实测** |

**结论**：本任务自身交付完成，5 项门禁全绿 —— tsc 0 error / vitest **3226 passed 0 failed** /
lint **108 problems (0 error)** / `vite build` exit 0 / E2E 全量 **31 failed 97 passed**（基线 112/20）。
衍生的 consent 恢复、协议分流接线、B 类断言处置、`@`/`/` 补全根因修复均已实施并记入 §附~§附4 与 `tdd.md` §8-13。
原定剩余两项已由用户 **2026-09-24「按原计划」裁定**：**REQUIREMENTS AGT-12/AGT-14 已修正**（3.7 注 + 两行需求），
**§下一任务 7（付费 LLM 实测）挂起不做** —— 降本改动本身已全部落地生效，挂起的只是「净额量化」。
`ai-agent-panel` 段 4 条为用户已裁定保留的选区改写已知失败，非未完成项。

## 遗留问题 / 风险

- **E2E 单 spec 剩余 4 条失败 —— 用户已裁定「保留作已知失败」（见 §附4）**：
  `A4 跨块选区区间替换`（`spec:994`）/ `A2 混合语法类型工具栏 AI 改写按钮`（`:1141`）/
  `A3 选区保持 .rewrite-highlight`（`:1188`）/ `① 整块高亮+取消胶囊`（`:1616`）。
  均为**选区改写特有断言**，`startSelectionRewrite` 生产零调用方 → `selectionContext` 恒 null → 无法改走 `@文档 `。
  **测试原样保留不改不删**，持续红着作为「该能力曾存在」的回归证据；
  连带后果：`ai-agent-panel.spec.ts` 段**永久 4 failed**（选区改写链路零 E2E 覆盖——
  document scope 的预览/应用/撤销/stale/unchanged/失败条已由 4 条改写测试覆盖，不受影响）。
  恢复入口的选项先前已被否决（恢复已废弃功能），不采纳。
- **文档与代码不一致（本轮发现，未擅自改需求）**：
  - `docs/modules/11-AI代理面板-Agent.md:21`/`:156` 仍写「编辑器选区触发」→ **已改为**面板 `@文档 `/`@ + 描述` 触发（当前态描述，本轮同步修正）；
  - `docs/REQUIREMENTS.md` **AGT-12 / AGT-14** 原写「编辑器选区触发为主」「选区改写用户消息入会话」
    → **2026-09-24 用户批准「按原计划」后已修正**：AGT-12 改为「触发方式为面板内 `@文档 ` / `@ + 描述`」、
    AGT-14 的「选区改写用户消息」改为「改写指令」，并在 3.7 节末补**修订注**记录移除事实与溯源；
    （注：这是文档追认代码现状，非功能设计变更——选区触发链路本就不存在，不存在「降级为兜底 vs 移除」的分支）
  - `docs/specs/ai-panel-features.md:26/44/45/46` 位于「第 5/7 期交付记录」段落，是历史记录，**未改**（`:46` 提到的 `CompletionMenu` 已死，见 §附4）。
- **B2 接线范围已收窄（协议分流后）**：按用户确认的「只分流非工具调用点」方案，
  `rewrite` / `chat` / `runSkill` / HyDE / 压缩五类调用已走 Anthropic 路径并吃到 `cache_control` 断点；
  **`agentLoop` 主循环仍走 OpenAI 兼容路径** —— 因 `anthropicClient` 无 tools 支持，分流会破坏工具循环。
  要拿到 Agent 主循环那 33%~44% 的估算收益，须先补 Anthropic tool-use 全套支持
  （tools 转换 + `tool_use` 流式解析 + `tool_result` 回填），属独立 L3，未获批不启动。
  OpenAI 兼容路径（DeepSeek）的前缀缓存由 provider 自动处理，B4 已能正确按折扣计费，该路径收益不受影响。
- **A 轨净增输入 291 tokens/轮**（实测 1,072 → 1,363，已含 A5 二次压缩）：常驻前缀，非文件操作轮次无法靠输出侧节省抵消。
  缓解已落地：B2 断点（接线后按 0.1× 计费）；chat 意图走 `CHAT_SYSTEM_PROMPT` 不受影响。
  A5 由 6 条压到 3 条**实测仅省 21 tok**（80→59），未达先前估的 60 —— 因为保留了全部 6 项语义（质量护栏优先）。
  若仍需再压，只能整条删除「不重复用户问题」「不解释基础概念」两项（约 +40 tok），须单独批准。
- **B3（结果预算收紧）为 L3**：阈值下调可能截断必要信息。缓解——超限内容落盘不丢弃、预览带恢复路径；
  若 A/B 显示信息丢失，回滚至 15k/60k 折中档。
- **基线既有问题处置结果**：
  1. ✅ `npm run lint` 1 error — `src/main/db/index.ts:31 no-var-requires` **已修**（加 eslint-disable，sqlite-vec 动态加载的降级设计保持不变）；
  2. ✅ `npx vitest run` **12 → 0 failed** — consent 恢复修 2 条；余 10 条为 AGENT_RUN 队列化残留（handler 不再直调 `runAgentFlow`）、
     KB 19 字段形状、`skillsCache` 模块级 TTL 泄漏，**已按当前实现重写断言并修复 1 处真实回归**（见下条）；
  3. ✅ `npx playwright test` 基线 112 failed — 分布在 15 个 spec（`ai-agent-panel` 34、`floating-toolbar` 25、
     `exit-behavior` 11、`editor-table` 8、`editor` 7…），其中 `drag-selection-markers` 有用例标题即为
     「当前 RED」，属既有预期失败。已用 `git stash` 在干净 HEAD 复跑确认**逐条 0 新增 / 0 消失**。
     **6d 全量复跑（本任务全部改动落地后）：31 failed / 1 skipped / 97 passed（7.1m）**，
     即 failed **112 → 31（−81）**、passed **20 → 97（+77）**。逐 spec 现状：
     `editor-table` 7、`feedback` 5、`drag-selection-markers` 5、`ai-agent-panel` 4、`floating-toolbar` 2、
     `exit-behavior` 2、`thematic-break` 2、`welcome-doc` / `recent-history-restore` / `image-resize` / `editor` 各 1。
     **注意**：基线日志未存档（三份日志当时只做了规范化 `comm`，文件未保留），故本轮**无法再做逐条 `comm`**，
     只能比聚合数与逐 spec 计数；
     **`floating-toolbar.spec.ts:222`「仅含 AI 改写」与 `ai-agent-panel` 那 4 条是同一已移除能力**，
     一并按「保留作已知失败」处理（未改断言）；
  4. ✅ `npm run build` 一度被环境锁阻塞 — `vite build` 全绿但残留 5 个 `electron.exe` 占用
     `better_sqlite3.node`（EBUSY/EPERM）。结束残留实例后复跑 **exit 0**，MSI + NSIS 正常产出。
- **修复中发现的真实回归（原被失败测试掩盖）**：`kbSettings` 由 handler 写进 `payloadJson` 后，`agentTaskWorker`
  的 `readTaskPayload` 从未解析它 —— 渲染层 `agentStore` 每次发送都传 `kbSettings`，合并逻辑在队列化重构中变成死路径。
  已把合并移入 `buildAgentDeps`（payload 显式 > 持久化 > 默认，`normalizeKbSettings` 统一兜底），
  断言落点由 handler 的 `runAgentFlow` 第 6 参改为 worker 侧（见 `tdd.md` §8-10）。
- **未实测项（用户 2026-09-24 裁定挂起，不做）**：create/edit/delete 输出侧实际节省 token 数、B2 缓存命中率 ——
  均需真实 LLM 调用（产生实际费用）。**降本改动本身不受影响，已全部生效**；挂起的只是净额量化。
  账面事实（供日后需要时直接取用）：系统提示 **+291 tok/轮**（1,072 → 1,363，已实测，是确定的**增加**）；
  输出侧为**硬上限 80 tok/轮**（`FILE_OP_NARRATION_TOKEN_LIMIT` + 提示词双约束），但改前平均值未知
  → **净额符号未知**。缓解已落地：B2 `cache_control` 断点（命中按 0.1× 计价，折算约 +29 tok 价）、
  chat 意图走 `CHAT_SYSTEM_PROMPT` 不受影响。日后若要定符号，最省的做法是采 5 次新建 + 5 次删除看
  `costTracker.completionTokens` 均值，无需跑完整 A/B。**不得以估算充数**。
- **计划外保持现状**：S15 缓存命中率监控接线、`buildFileListSnapshotCached` 死代码、
  OpenAI 路径 `stream_options` 显式请求 usage、`vitest.config.ts` 覆盖率 include 口径（仍为 FT4 的 5 个编辑器文件）。

## 下一任务

按用户已批准的范围，剩余项与建议顺序：

| # | 项 | 档 | 状态 |
|---|----|----|------|
| 1 | 恢复 consent 铁律二闸 + ConsentOverlay | L4 | ✅ 已批准并实施（见 §附）；**后续用户确认砍掉 allowNetwork 联网闸、保留 allowSend 外发闸**（见 §附1b） |
| 2 | 修 lint 唯一 error | L2 | ✅ 已完成，lint 0 error |
| 3 | A5 回复风格 6→3 条 | L2 | ✅ 已完成，实测 -21 tok |
| 4 | 修 `ipc.test` 余 10 条（队列/KB 形状/skillsCache） | L2 | ✅ 已完成，vitest 3218/0 全绿；顺带修复 `kbSettings` 死路径回归 |
| 4b | E2E 基线逐条对照 + 文档回填 | L2 | ✅ 已完成，0 新增 / 0 消失 |
| 4c | 解锁后复跑 `npm run build` | L2 | ✅ 已完成，exit 0，MSI + NSIS 产出；协议分流后再跑仍通过 |
| 5 | 补协议分流接线，让 B2 产生运行时收益 | L3 | ✅ 已完成（用户选定「只分流非工具调用点」），见 §附2；RED 8 → GREEN 全绿 |
| 6 | E2E 先修根因看收敛度 | L3 | ✅ 已执行（用户选定「继续改 E2E」）—— 单 spec **4/31 → 21/14（+17）**，见 §附3 |
| 6b | B 类 4 项回归决策 | L3 | ✅ **已完成（用户逐项裁定，见 §附4）**。恢复能力早前已被否决（「这些恢复点我怎么记得是之前抛弃掉的旧功能」）；本轮裁定：**删 4 条**（KB 3 + intentCard 1，对象已完全不存在，明确批准删测试）+ **4 条改走 `@文档 `**。产品源码 0 处改动 |
| 6c | `@`/`/` 补全根因 | L3 | ✅ **已完成（见 §附4）**。第一轮「fill 不触发 suggestion」判断**不成立**；真根因是断言写给已退役的 `CompletionMenu`（标题 `引用`→`@ 引用`、`运行技能`→`技能`、选项改文件树）。已改断言并转绿 |
| 6b-2 | **剩余 4 条选区改写断言处置** | L3 | ✅ **已裁定：保留作已知失败**（用户原文「保留作已知失败（推荐）」）。测试原样不动不删，作为选区改写曾存在的回归证据；`ai-agent-panel.spec.ts` 段永久 4 failed。`startSelectionRewrite` 生产零调用方致 selection 链路不可达，改走 `@文档 ` 无解；恢复入口与先前「不恢复废弃功能」裁定冲突，未采纳。见 §附4 / §遗留首条 |
| 6d | E2E 全量 16 spec 复跑 | L2 | ✅ **已完成** —— **31 failed / 1 skipped / 97 passed（7.1m，129 条）**，基线 112/20（133 条）→ **failed −81、passed +77**。`ai-agent-panel` 由基线 34 failed 降为 **4**（已裁定保留）。基线日志未存档，本轮只比聚合数 + 逐 spec 计数，**做不了逐条 `comm`**（见 §遗留 3）。另发现 `floating-toolbar.spec.ts:222` 与那 4 条同属已移除的 AI 改写能力，一并保留 |
| 7 | 付费 LLM 实测输出侧节省 + B2 缓存命中率 | L4 | ⏸ **挂起不做**（用户 2026-09-24「按原计划」裁定）。**降本改动本身已全部落地生效**——A 轨 `FILE_OP_NARRATION_TOKEN_LIMIT=80` + 四段提示词改写、B1 非文件操作意图省最多 5,000 tok/轮、B3 阈值 10k/40k、A5 -21 tok 均为静态可验证；挂起的只是**净额量化**（输出侧实际均值 + B2 命中率需真实调用）。账面已知：输入侧 **+291 tok/轮**（确定的增加）vs 输出侧削减（均值未知）→ **净额符号未知**，见 §遗留「未实测项」与 `tdd.md` §9.3 |
| 8 | REQUIREMENTS AGT-12/AGT-14 追认选区入口移除 | L2 | ✅ **已完成**（用户 2026-09-24「按原计划」批准）——两行需求改为现状 + 3.7 节末补修订注 |
