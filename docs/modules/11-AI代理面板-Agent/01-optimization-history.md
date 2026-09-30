# 最近优化与 Skills 加载链路、提炼技能、经验注入（§3.1-§3.2）

> 拆分自 [11-AI代理面板-Agent.md](../11-AI代理面板-Agent.md)，原 §3.1 最近优化、§3.2 Skills 加载链路、提炼技能与经验注入；2026-10-01 按渐进式披露拆分，正文未改动。
> 返回索引：[11-AI代理面板-Agent.md](../11-AI代理面板-Agent.md)

---

## 3.1 最近优化（2026-09-18 agent-md-kb-optimize）

### 知识库检索管线可观测性

在 `searchKB()` 全链路添加 `performance.now()` 耗时统计和候选数量统计，返回可选 `diagnostics` 字段：

```typescript
interface IKbDiagnostics {
  timings: { fts5Ms, vectorMs, titleMs, rrfMs, weightingMs, aggregationMs, rerankMs, totalMs };
  counts: { fts5Candidates, vectorCandidates, titleCandidates, mergedCandidates, afterWeighting, afterAggregation, finalResults };
  cacheSnapshot?: { searchResultHit, rerankHit };
  queryUnderstanding?: { intentType, isFallthrough, hadPronounRef };   // D1 已接线（2026-09-30）
  researchLoop?: { subQueryCount, cacheHits, totalResults };           // 仅声明，尚未赋值
}
```

**关键文件**：`src/shared/ai/kb.ts`（接口）+ `src/main/ai/knowledge/kbSearch.ts`（埋点）

#### `queryUnderstanding` 已接线（2026-09-30 agent-memory-optimize-3 / D1）

- 赋值点：`kbSearch.ts` 主路径、缓存命中变体、两条早退路径（`cleaned` 空 / 候选为空）**四处全部回传**，四类调用都计入指代触发率分母。
- `intentType` = `mapIntentToType(detectQueryIntent(query))`（独立取值，不与 rerank 局部变量耦合）；`isFallthrough` = 意图规则零命中 → chat fallback（`intentRouter.classifyIntent(query).intent === 'chat'`）。
- `hadPronounRef` 由新增可选入参 `KbSearchOptions.hadPronounRef` 驱动（kbSearch 不持有 history，改写在 `searchKBHandler` 层发生），缺省保守记 `false`。
- 落点：`searchKBHandler` 把 diagnostics 作为**独立小节**挂进工具 `content`（`ai_messages.content` / `agent_run_events.payload_json` 两个既有 sink 可 SQL 查询），既有字段 `results`/`refused`/`threshold`/`best`/`clarificationContext` 一律不动；`searchKb` 未回传 diagnostics 时 content 保持改前的裸数组形状。
- **反向指标警告**：`detectAmbiguities` 的 `pronoun_reference` = 有指代词但无历史（未消解），与 `hadPronounRef` 方向相反，**不可互推**。
- `researchLoop` 字段目前仍**仅声明未赋值**（`researchLoop()` 在 `knowledgeContext.ts`，不产出 `IKbDiagnostics`），待后续接线。

### 研究循环并行化

`knowledgeContext.ts` 的 `researchLoop()` 从串行 `for...of` 改为 `Promise.allSettled()` 并行执行：

- **并发限制**：最多 3 个并行子查询
- **提前终止**：`highQuality >= 3` 时停止
- **错误隔离**：单个子查询失败不影响其他
- **串行 fallback**：并行执行失败时自动降级

**关键文件**：`src/main/ai/knowledge/knowledgeContext.ts`

### Agent 代码重复消除

提取 `processStreamingToolRound()` 和 `executeToolRound()` 的 8 块公共逻辑到 `agentToolExecutor.ts`：

| 函数 | 说明 |
|------|------|
| `deduplicateAskQuestionCards` | ask_question_card 去重 |
| `assembleToolTurn` | toolTurn 组装 |
| `extractThinkingText` | thinking 文本提取 |
| `validateQuestionCardArgs` | 参数预验证 |
| `checkForceConfirmTools` | FORCE_CONFIRM_TOOLS 拦截（统一浅拷贝） |
| `mergeResultsWithBudget` | 结果合并 + 聚合预算 |
| `processToolResultsLoop` | handleToolResult 循环 |
| `handleInteractionPause` | 交互暂停 |

**关键文件**：`src/main/ai/agent/agentToolExecutor.ts`（导出）+ `src/main/ai/agent/agentLoop.ts`（调用）

### 延迟工具重发优化

- **重发上限**：`while (deferredRetryCount < 3)` — 最多 3 次总调用（1 原始 + 2 重试）
- **保留已执行结果**：通过 `executor.waitForAll(skipSet)` 收集非延迟工具结果，注入 LLM 上下文
- **Schema 升级追踪**：`upgradedDeferredTools` Set 避免无限重试
- **遥测日志**：`console.debug('[AgentLoop] 延迟工具重发', {...})`

**关键文件**：`src/main/ai/agent/agentLoop.ts` L259-430

## 3.2 Skills 加载链路、提炼技能与经验注入（2026-09-30 agent-memory-optimize-3 / D3 + D4）

### 加载链路（六.1 的三条断链已修复）

修复前：`agentContext.ts` 与 `skillManager.ts` **4 处无参 `loadSkills()`** → 只返回内置 3 个
core skill → 用户手写技能与提炼技能对 `runSkill` / `list_skills` 完全不可见（渲染侧
`agent:skills:list` 另有 5 个目录，保持不动）。

修复后（`src/main/ai/skills/skillPaths.ts` 统一推导目录）：

| 调用点 | 改动 |
|---|---|
| `agentContext.ts`（组装 `ctx.skills`） | `loadSkills(getDefaultSkillDirs())` —— 影响 `runSkill` |
| `skillManager.ts` × 3（`getManagedSkills` / `getManagedSkill` / `setSkillEnabled`） | 同上 —— 影响 `list_skills` / `get_skill_details` |
| `loadSkills()` 无参 | 默认走 `getDefaultSkillDirs()`（含 `userData/skills`），非 Electron 环境返回 `[]` |

扫描目录 = `userData/skills`，支持三种结构：`<name>/SKILL.md`、`<name>.md`、
`_auto/<name>.md`；**同名冲突 `console.warn` 后跳过后加载者**（内置 core 优先）。

### 提炼技能存储（纯文件系统，无 DB 表）

```
userData/skills/
├── <name>.md / <name>/SKILL.md   # 用户手写技能（既有）
└── _auto/                        # 提炼生效技能（status: active）
    └── _drafts/                  # 提炼草稿（status: draft，人工确认前绝不生效）
```

- 单文件格式沿用 front matter + 正文：`name:` / `description:` / `status:` / `source: auto`。
- **双重防线**：`_drafts/` 不参与扫描；`_auto/` 内必须 `status: active`；任意位置
  `status: draft` 一律过滤 —— 未确认草稿不进 `ctx.skills` / `list_skills` / `runSkill` / 任何 prompt。
- 技能名闸 `auto_[a-z0-9_]{1,60}`（`skillPaths.AUTO_SKILL_NAME_RE`）+ 路径闸 `isPathInside`
  （解析后绝对路径必须落在目标目录内），两道闸任一不过即拒绝、零副作用。

### 后台提炼任务（`skillDistiller.ts`，范式抄第二批 `memoryWriter.ts`）

触发链：`AgentTaskWorker.handleTaskSuccess` 在 **`AI_STREAM_DONE` 之后**调
`maybeEnqueueSkillDistillation`（同步快速返回：节流 + 同会话 pending 去重 + 入队，绝不调 LLM）
→ 队列轮询取出 → `processSkillDistillTask` → `runSkillDistillJob`：

1. 轨迹筛选：`hasCompletedAgentTask(conversationId, userId)` 只认 `agent_task_queue.status='completed'`；
2. 轨迹读取：**新增** `getConversationMessagesPage(conversationId, userId, { limit, beforeId })`
   （`rowid` 游标分页 + `user_id` 隔离 + 全参数化），既有 `getRecentMessagesByRounds` **零改动**；
3. LLM 结构化提炼 → `parseSkillDrafts` 严格校验（name 正则 / 长度 / 条数 ≤ 3，
   **任一项不合法整批抛错零写入**）→ 语义去重（同 name / 同 description 跳过并 warn）→ **只写草稿目录**；
4. 失败落 `failed` 不重试、`console.error` 带上下文，**永不 reject**（不阻塞下一轮提问）。

节流常量 `SKILL_DISTILL_MIN_ROUND_GAP = 4`（**无实测数据、待校准**）。pending 去重按
「同会话任意 pending」判定，避免 `AgentTaskQueue.enqueue` 的 supersede 误伤 `memory_extract`。

### 人工确认入口（半自动铁律）

- IPC 三通道 `ai:skilldraft:list` / `:approve` / `:reject`（`ipc/skillDraftHandlers.ts`），
  **照抄第二批 C3 `memoryHandlers.ts` 范式**：`isTrustedSender` + JWT 解 `userId` + `findById`
  + fail-closed + 名称/路径双闸；**不接受渲染层传入 userId**。
- `approveDraftSkill` 是**唯一** draft → active 路径（写 `_auto/<name>.md` 并标 `status: active`，
  再删草稿）；`rejectDraftSkill` 删除草稿文件。
- 设置页入口：`Settings/SkillsPanel.tsx`「提炼技能（待确认）」栏 —— 只读列表 + 二次确认的
  「确认启用 / 驳回」，数据走 `agentStore.loadSkillDrafts / approveSkillDraft / rejectSkillDraft`。

**关键文件**：`src/main/ai/skills/{skillPaths,skillLoader,skillAutoStore,skillDistiller,skillManager}.ts`、
`src/main/db/ai.ts`（分页查询 + 成功终态）、`src/main/ai/agent/agentTaskWorker.ts`（触发与路由）、
`src/main/ai/ipc/skillDraftHandlers.ts`、`src/render/components/AIAgent/settings/SkillsPanel.tsx`

**已知缺口（记 TODO）**：`sendRoutes.ts` 的 `routeSlashSkill` 仍把 `/skillname` 前缀剥掉
（技能名不进主进程），改渲染→主进程载荷结构超出 D3 范围；`isSkillEnabled` 仍无调用方。

### 任务类型标注与经验注入（2026-09-30 agent-memory-optimize-3 / D4 六.2）

**经验的载体 = D3 的生效技能文件正文**（`_auto/<name>.md` 的 instructions markdown 步骤天然
保持顺序），**不新建存储、不建表、不碰 `db/index.ts` 与迁移**。D4 只做两件事：front matter 加
`intents` 字段 + 按意图注入经验块。

#### front matter 新增可选 `intents:`（D4 唯一的数据结构扩展）

| 环节 | 行为 |
|---|---|
| `skillLoader.parseSkillMarkdown` | 逗号分隔 `rewrite, kbQa` 或 JSON 数组 `["rewrite","kbQa"]` 等价；值须落在白名单，**非法值（含 `chat`）忽略并 `console.warn`**；字段缺失 → `undefined`（未标注）、全非法 → `[]`（已标注却不适用） |
| `skillAutoStore.assertValidSkillDraft` | 草稿侧**严格校验**：非数组 / 空数组 / 白名单外（含 `chat`）→ 抛错，与其余字段同口径整批拒写；缺省合法（D3 与更早格式零回归） |
| `skillAutoStore.serializeSkillFile` | 带 `intents` 才写该键，老文件往返无差异 |

**白名单 `EXPERIENCE_INTENTS = [rewrite, kbQa, tech, web, create]`**（定义在
`agentPromptBuilder.ts`，注入侧与技能侧共用同一口径）。**`chat` 不在其中**：它是 `intentRouter`
的无规则 fallback（`scores.size===0` 即落 chat），无法区分闲聊与未知任务类型，**一律不注入**。

#### 注入链路（读取一次，两个分支各传一次）

```
prepareAgentContext
  ├─ skills    = loadSkills(getDefaultSkillDirs())   # D3 已修的加载链路
  ├─ intent    = classifyIntent(...)                 # 既有计算，零成本
  └─ experienceBlock = buildExperienceBlock(skills, intent.intent)
        ├─ intent 不在白名单（含 chat）→ ''（一律不注入）
        ├─ 技能标了 intents → 只看显式命中，不回落推断（[] = 已标注却不适用）
        ├─ 未标 intents → classifyIntent(name + description) 推断，不中就不注入
        └─ 无匹配 / 无技能 → ''（零占位噪音，与 A1/B4 同口径）
  └─ buildAgentSystemPrompt(…第 7 参) / buildChatSystemPrompt(…第 3 参)
        块位置：核心规则 → 三文件 → 画像 → **经验** → ## 工作流（chat 侧 → 锚点前）
```

- **顺序保持**：块内按 `skills` 原序拼接（显式命中在前、推断命中在后），instructions 正文
  原样插入 —— 步骤顺序不被洗乱；超 `EXPERIENCE_TOKEN_LIMIT` 截断 + `(经验过长已截断)` 标注。
- **预算**：`EXPERIENCE_TOKEN_LIMIT = 2000`，与 A1/B4 同一预算刻度（三层个性化块合计 ≤6000
  = 9.4% 窗口）。实测（`estimateTokens`）：典型提炼技能 **188 token**、4000 字极限技能
  **2521 token**（截断保留 2000）；主提示三块典型满载 **3150（4.92%，余量 60850）**、
  三块顶格最坏 **7562（11.82%，余量 56438）**。单次会话匹配技能条数分布 **[待校准]**。
- **护栏**：缺省第 7 参 / 传空串 / 传纯空白 → 输出与改动前**逐字一致**（sha256 基线全绿），
  空块不留标题、不留空行残留。
- **调试用**：`chat` 意图、未命中意图、无技能三条路径均为零注入，因此经验块只在 5 个显式
  规则意图上出现。

**D4 关键文件**：`src/main/ai/agent/agentPromptBuilder.ts`（`EXPERIENCE_INTENTS` /
`EXPERIENCE_TOKEN_LIMIT` / 两函数加参与插块）、`src/main/ai/agent/agentContext.ts`
（`buildExperienceBlock` + 两分支接线）、`src/main/ai/skills/skillLoader.ts`（`intents` 解析）、
`src/main/ai/skills/skillAutoStore.ts`（草稿校验与落盘）、`src/main/ai/skills/skillDistiller.ts`
（提炼 prompt 要求标注 `intents`）。

