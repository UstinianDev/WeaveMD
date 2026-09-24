# agent-cost-optimize — TDD 证据报告（M / standard）

> 创建：2026-09-23 | 档位：**M** | 强度：standard（RED → GREEN → 重构 → 覆盖率记录 → 本报告）
> 来源：[计划](../../plan/agent-cost-optimize.plan.md) / [需求](../../requirements/agent-cost-optimize.req.md)

## 1. 测试范围

| 文件 | 类型 | 用例数 | 覆盖项 |
|------|------|--------|--------|
| `tests/main/ai/agentPromptBuilder.test.ts` | 新建 | 36 | A1–A5、B1 门控、5 项质量护栏豁免 |
| `tests/main/ai/anthropicCache.test.ts` | 新建 | 6 | B2 缓存断点 + usage 解析 |
| `tests/main/ai/costTracker.test.ts` | 扩展 +9 | 15 | B4 缓存折扣计费（原 6 项回归全绿） |
| `tests/main/ai/toolResultStorage.test.ts` | 扩展 +5 | 25 | B3 阈值收紧（原 20 项回归全绿） |
| `tests/main/db/aiDao.test.ts` | 扩展 +4 | — | 协议分流：`ai_config.protocol` UPDATE/INSERT/mapConfigRow 兜底 |
| `tests/main/ai/ipc.test.ts` | 扩展 +3 | 35 | `toIAIConfig` protocol 映射 + `DEFAULT_AI_CONFIG` |
| `tests/main/ai/skillLoader.test.ts` | 扩展 +1 | — | `runSkill` 按 protocol 分流到 `streamAnthropicCompletion` |
| **合计** | | **90+** | |

## 2. RED（先写失败测试，实际执行）

```
$ npx vitest run tests/main/ai/agentPromptBuilder.test.ts \
    tests/main/ai/anthropicCache.test.ts \
    tests/main/ai/costTracker.test.ts \
    tests/main/ai/toolResultStorage.test.ts
```

实际输出（2026-09-23 17:32:31）：

```
Test Files  4 failed (4)
     Tests  38 failed | 44 passed (82)
  Duration  8.68s
```

失败样例（原始输出摘录）：

```
FAIL tests/main/ai/toolResultStorage.test.ts > single-result threshold is 10,000 chars
AssertionError: expected 30000 to be 10000

FAIL tests/main/ai/toolResultStorage.test.ts > aggregate threshold is 40,000 chars
AssertionError: expected 120000 to be 40000

FAIL tests/main/ai/toolResultStorage.test.ts > 10,001 chars triggers persistence
AssertionError: expected false to be true

FAIL tests/main/ai/costTracker.test.ts > B4: formatCostTable exposes a Cache Write column
（表头缺 Cache Write 列）
```

RED 覆盖 4 个文件、38 条失败用例 —— B4 / A1–A5 / B1 / B2 / B3 五组需求均有先失败的测试。

## 3. GREEN（最小实现后实测）

同一命令，实际输出（2026-09-23 17:41:16）：

```
✓ tests/main/ai/anthropicCache.test.ts     (6 tests)
✓ tests/main/ai/agentPromptBuilder.test.ts (36 tests)
✓ tests/main/ai/costTracker.test.ts        (15 tests)
✓ tests/main/ai/toolResultStorage.test.ts  (25 tests)

Test Files  4 passed (4)
     Tests  82 passed (82)
  Duration  7.26s
```

最终复跑（A5 措辞压缩后，2026-09-23 18:19:21）：`4 passed / 82 passed`。

## 4. 覆盖率记录（M 档不强制 80% 门槛）

- `vitest.config.ts` 的 `coverage.include` 固定为 PLAN-EDIT-FT4 的 5 个编辑器文件
  （`inlineLexer` / `inlineRenderer` / `selection` / `formatCtrl` / `ContentBlock`），
  本次 AI 模块文件**不在报告口径内**，故以用例数记录：新增 42、扩展 14，合计 82。
- 该 include 属既有配置，本次未改动（改动会影响 FT4 的覆盖率口径，超出任务范围）。

## 5. 实现项 → 测试映射

| 项 | 实现 | 断言落点 |
|----|------|----------|
| B4 | `costTracker.ts` `calculateCost` 扣减 + `CACHE_READ_RATE/WRITE_RATE` + 表头 Cache Write 列 | `costTracker.test.ts` 4 条 B4 用例 |
| A1 | `agentPromptBuilder.ts` `## 文件操作后的回复` 段 | 5 条 |
| A2 | `## 回答格式` 条件化（知识类 / 文件操作轮次双分支） | 4 条 |
| A3 | `写入规则` 改写（去「直接执行并告知结果」「必须说明即将删除的内容和原因」） | 7 条 |
| A4 | `FILE_OP_NARRATION_TOKEN_LIMIT`(=80) / `_LIMITS`(=0/40/80/160) 导出并写入提示 | 4 条 |
| A5 | `## 回复风格` 段（模板按写作 Agent 改写，未注入代码开发专用条款） | 8 条 |
| B1 | `shouldInjectDocumentContext` + `agentContext.ts` 门控 | 4 条 |
| B2 | `anthropicClient.ts` system 断点 + `message_start`/`message_delta` usage | 6 条 |
| B3 | `toolResultStorage.ts` 阈值 10k/40k | 5 条 |
| 护栏 | payload / 提问文本 / 澄清轮次 / 安全警告 / 知识类格式 | 6 条 |

## 6. 全量门禁

| 门禁 | 命令 | 结果 |
|------|------|------|
| 类型检查 | `npx tsc --noEmit` | **0 error**（exit 0） |
| 单元测试 | `npx vitest run` | **3226 passed / 0 failed**（138 文件全绿）— 基线 12 failed：consent 恢复修 2 条、队列化残留测试修复 10 条；协议分流 +8 |
| Lint | `npm run lint` | **108 problems (0 error, 108 warnings)** — 基线 115(1 error)，已修 `db/index.ts:31`；协议分流 9 个改动文件 0 warning |
| 构建 | `npm run build` | **exit 0** — vite build 3 段全绿 + electron-builder 产出 MSI/NSIS（曾被残留 `electron.exe` 锁 `better_sqlite3.node`，结束实例后复跑通过；协议分流后再跑仍通过） |
| E2E | `npx playwright test` | **112 failed / 1 skipped / 20 passed（21.9m）** — 协议分流后全量复跑，失败集合与基线双向 `diff` **0 新增 / 0 消失**（见 §7） |
| E2E（单 spec 锚点改写后） | `npx playwright test e2e/ai-agent-panel.spec.ts` | **21 passed / 14 failed（12.0m）** — 基线 4 passed / 31 failed，**净 +17**；4 条门禁复验：tsc 0 error、vitest **3226/0**（无并发干净跑）、lint **108 (0 error)**、`npx vite build` exit 0 |

**新增/改写测试**（consent 恢复 + 门禁修复，非本任务原范围）：`ConsentOverlay.test.tsx` +4、`consent.test.ts` +2、
`agentStore.test.ts` +2（`consent_required` 信封/异常）并还原 3 条被 `61e8036` 反向改写的断言；
`ipc.test.ts` 10 条按 AGENT_RUN 队列化后的实际实现重写（见 §8-10）。

## 6.5 连通性验证 / 7 合规核对

| 项 | 结果 |
|----|------|
| 旧阈值 30_000 / 120_000 残留 | ✅ 0 处（全仓 5 处 `30_000` 为无关超时/预算常量） |
| `MAX_*_CHARS` 唯一定义 + 调用方未变 | ✅ 仅 `toolResultStorage.ts`；`agentToolExecutor.ts` 两处调用未改动 |
| `shouldInjectDocumentContext` 接线完整 | ✅ import → 门控 → 构建 → 注入 |
| Anthropic usage chunk → costTracker 五字段 | ✅ `agentLoop.ts:318,336-347` |
| 计划外 `src/` 改动 | ✅ 本任务 0 处，与 plan §1.2 六文件一致；consent 恢复的 10 处为**用户单独批准的衍生任务**（见 §8-9） |
| `any` / `dangerouslySetInnerHTML` | ✅ 0 命中 |
| 迁移 / 认证 / 权限 / 密钥 | ✅ 0 命中 |
| SQL 参数化 | ✅ 改动文件不含 SQL |
| 删除测试 | ✅ 无 `D` 条目 |
| 新建文件与依赖 | ✅ plan §1.1 的 6 个新文件 + 用户单独批准的 3 个 consent 恢复文件（见 §8-9），0 新增依赖 |

## 7. 基线对照（区分「本次引入」与「既有问题」）

方法：`git stash push --include-untracked` 暂存本次全部改动 → 在干净 HEAD 上复跑 → `git stash pop` 恢复。

| 项 | 本次改动后 | 干净 HEAD 基线 | 结论 |
|----|-----------|----------------|------|
| lint problems | **108 (0 error, 108 warnings)** | 115 (1 error, 114 warnings) | **净减 7**：修掉唯一 error + consent 相关 6 个 unused-var 警告，未新增任何问题 |
| lint 唯一 error | **已消除** | `src/main/db/index.ts:31` `no-var-requires` | 已修：加 `eslint-disable-next-line`（sqlite-vec 可选扩展动态加载的降级设计不变） |
| `ipc.test.ts` | **32 passed / 0 failed** | 12 failed / 20 passed | **12 条全清**：2 条随 consent 恢复变绿，10 条按队列化后的真实实现重写（并修复 1 处真实回归，见 §8-10） |
| **E2E 全量** | **112 failed / 1 skipped / 20 passed（21.9m）** | **112 failed / 1 skipped / 20 passed（23.5m）** | **逐条 0 新增 / 0 消失** — 三份日志（基线 / consent 恢复后 22.1m / 协议分流后 21.9m）失败集合规范化（去序号/时长/填充线/CR）后 `comm` 双向对比为空，`diff` 完全一致。`ai-agent-panel.spec.ts:537`/`:576`（ConsentOverlay）基线同样失败，属既有问题，归入下一任务的 E2E 根因排查 |
| **E2E `ai-agent-panel` 单 spec** | **21 passed / 14 failed（12.0m）** | **4 passed / 31 failed** | **净 +17 通过**。17 条转 pass 全部来自「跟随产品有意演进」的锚点改写（chat 删除 / 卡片文案 / 内联 diff 收起 / FileMenu 删除 / mock 数据源，0 处产品源码改动，见 status §附3）。剩余 14 条 = **B 类 4 项疑似回归 12 条** + 既有 `@`/`/` 补全 2 条，**断言原样保留作回归证据，未擅自改写** |

## 8. 计划偏离记录

| # | 偏离 | 原因 |
|---|------|------|
| 1 | B1 测试并入 `agentPromptBuilder.test.ts`，未单开 `agentContextDocGate.test.ts` | 谓词定义在无 electron 依赖的 `agentPromptBuilder.ts`，可直接单测；`agentContext.ts` 需整套 electron/db mock |
| 2 | B4 公式为 `promptTokens - cacheRead - cacheCreation`（计划只扣 cacheRead） | `cacheCreationTokens` 同样是 `promptTokens` 的子集，只扣 read 会把写入部分按全价计两次 |
| 3 | `promptTokens` 语义明确为**含缓存的输入总量**；Anthropic 客户端上报前换算 `input + cache_read + cache_creation` | OpenAI/DeepSeek 的 `prompt_tokens` 本就是总量，两条协议必须统一口径，否则同一公式在两条路径上算出不同价 |
| 4 | B2 首条断言由 `promptTokens === 1000` 改为 `2000` | 随 #3 的总量语义（1000 input + 300 写 + 700 读） |
| 5 | B2 中 `agentLoop.ts` 仅为注释改动 | `upgradedDeferredTools` 已保证同一工具只升级一次，前缀在升级轮之后即恢复稳定，无行为可改 |
| 6 | A5 三条豁免合并为一行、工具列表去掉空格 | 见 §9 实测，压缩 36 tokens |
| 7 | **B2 首轮未做协议接线**（后续已补，见 #11） | 实施期 `grep` 证实 `streamAnthropicCompletion` 在 `src/` 内零调用方：`agentLoop → streamChatCompletionWithRetry → streamChatCompletion` 无条件走 OpenAI 兼容路径，`ModelProtocol` 只存在于 DB/IPC 读写、从未参与分流。补接线属 L3 且不在当时已批准的变更清单内，列为遗留项 |
| 8 | A5 由 6 条压到 3 条，**实测仅省 21 tok**（80→59），先前估的 60 未达成 | 压缩采用「合并」而非「删除语义」——6 项语义全部保留，36 条 A5 断言无需删减任何一条。要拿到 60 tok 必须整条删除「不重复用户问题」「不解释基础概念」，与质量护栏冲突，须单独批准 |
| 9 | **consent 铁律二恢复属本任务范围外**（用户单独批准的衍生任务） | 新建 3 文件 + 修改 12 文件，全部逆向取回 `b55bd58` / `61e8036` 的原语义；详见 `docs/plan/agent-cost-optimize.status.md` §附 |
| 10 | **修复 10 条基线失败的 `ipc.test` 时发现并修复了一处真实回归** | AGENT_RUN 队列化后 handler 只入队、`runAgentFlow` 由 `agentTaskWorker` 执行，原测试仍按直调断言（6 条）；另 3 条断言 4 字段而实际返回 `normalizeKbSettings` 的 19 字段、1 条撞上 `skillsCache` 模块级 30s TTL 泄漏。**真实回归**：handler 把 `kbSettings` 写进 `payloadJson`，worker 的 `readTaskPayload` 却从不解析它（渲染层每次都传），合并逻辑成了死路径 —— 已把合并移入 `buildAgentDeps`（payload 显式 > 持久化 > 默认）。断言落点改为 `buildWorkerDeps`（private 方法类型断言取回），`consent_required` 前置闸改为「入队前同步拒绝且不入队」 |
| 11 | **协议分流按「只分流非工具调用点」实施（衍生任务，L3，用户确认）** | `ai_config` 幂等补 `protocol` 列 + 激活模型配置时同步 + `IAIConfig.protocol?`（可选，缺省即 openai）+ 全仓 7 个 LLM 调用点中 **6 处三元分流**，仅 `agentLoop:270` 主循环**不分流**（Anthropic 路径无 tools 支持）。偏离点：`contextManager` 的 cache-safe fork 分支**带 tools 却仍分流** —— 压缩只读文本不消费 `tool_use`，不分流会让 anthropic 配置下压缩打错端点直接失败；openai 路径的 tools 前缀缓存优化原样保留。`IAIConfig.protocol` 由必填改可选，避免为一个可安全默认的字段改动 10+ 个测试/渲染层字面量。RED 8 failed → GREEN 全绿。详见 `status.md` §附2 |
| 12 | **#9 恢复的联网同意闸随后被用户叫停并砍除（衍生任务，L4，用户「确认」）** | 用户指出三配置门禁已表达联网意愿、再弹同意属冗余，判定成立：`needsConsent` 改恒 `false`、渲染侧删联网闸分支、`ConsentOverlay` 只剩 `allowSend` 勾选；`allowSend` 与主进程 4 个调用点保留。断言改写涉及 `consent.test.ts` / `agentStore.test.ts` / `ConsentOverlay.test.tsx` / `e2e/ai-agent-panel.spec.ts`（E2E 新增 `agentResult.consentRequired` mock 驱动兼容路径）。详见 `status.md` §附1b |

## 9. 静态 A/B 实测

工具：`esbuild` 打包 HEAD 版与当前版 `agentPromptBuilder` → `estimateTokens`（CJK 0.75 / 其他 0.25）。

### 9.1 系统提示（所有 Agent 轮次共享）

| 版本 | 字符 | tokens |
|------|------|--------|
| HEAD（改前） | 2,064 | **1,072** |
| 首轮改后 | 2,714 | **1,383** |
| **A5 二压后（当前）** | 2,680 | **1,363** |
| 差值 vs HEAD | +616 | **+291（+27.2%）** |

澄清场景（`needsClarification=true`）同步：1,107 → 1,397 tokens（+290，同源）。
A5 单段实测：`## 回复风格` 6 条 135 字符/80 tok → 3 条 101 字符/59 tok，**-21 tok**。

说明：这是本次唯一**增加**输入侧的改动 —— A 轨新增的域规则与回复风格条款是常驻前缀。缓解：
1. 属稳定前缀，B2 在 Anthropic 路径打了 `cache_control` 断点，命中后按 0.1× 计费（折算约 +29 tokens 价）；
2. 相对整体注入参考模板原文（+~1,000 tokens，Caveman 自承的短问答倒亏值），本方案取两域改写只用三分之一；
3. chat 意图走 `CHAT_SYSTEM_PROMPT`，不受影响。

### 9.2 三场景输入/输出侧变化（静态可测部分）

| 场景 | 输入侧变化 | 输出侧变化 |
|------|-----------|-----------|
| 新建（create） | 系统提示 +291 tok/轮；文档上下文仍注入（B1 保留 create） | 叙述由无上限 → **≤80 tok** |
| 编辑（rewrite/edit） | 同上 | 同上 |
| 删除（delete） | 同上 | 同上；且不再要求「说明即将删除的内容和原因」，删除清单只在目标不唯一时出现 |
| chat / kbQa / web | **−最多 5,000 tok/轮**（B1 不再注入文档上下文，`DOC_CONTEXT_TOKEN_LIMIT`） | 不变（走 A 轨以外路径） |
| 大结果轮次 | 单结果 30k→10k 字符、聚合 120k→40k 字符，最多各减 20k / 80k 字符 | 不变（超限内容落盘、预览带恢复路径） |

### 9.3 未测项（需真实 LLM 调用）

create/edit/delete 的**输出侧实际节省 token 数**需跑真实模型对比基线叙述长度 —— 每次运行都产生实际费用，按规范需先获批准。当前只能给出**硬上限 80 tokens**（由 A4 常量 + 提示词共同约束），不以估算冒充实测。
B2 的**缓存命中率**同理，需真实多轮会话才能观测（S15 统计接线属计划外遗留项）。

## 10. 质量护栏核对

| 护栏 | 断言 |
|------|------|
| 1 产物 payload 不受叙述域限制 | `payload 不适用于` + `createFile.content` |
| 2 澄清提问不受限 / 分轮澄清未削减 | `提问文本 不适用于` + `分轮澄清策略` + `每轮最多 2 个问题` + `round 和 totalRounds` |
| 3 知识库出处 | 未触碰 `searchKB` 相关条款（回归通过） |
| 4 错误与安全警告未削减 | `此操作不可恢复` + 豁免行内 `错误与安全警告` |
| 5 知识类回答仍可用完整结构化格式 | `## 回答格式` 切片含 `知识类回答` + `Markdown` |

铁律（`ask_question_card` 强制提问）、`FORCE_CONFIRM_TOOLS` 删除硬拦截、`maxRounds` 动态分配、工具 schema 语义 —— 均未改动，回归通过。
