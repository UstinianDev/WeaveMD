# agent-ux-optimize — Phase 6.5 模块连通性验证报告

> 生成：2026-09-14 | 定档：L | 5 条链路验证

---

## 链路 1: Delete 确认流程（R5）— 状态：✅ 通畅

### 调用链跟踪

```
agentLoop.executeToolRound (L738-801)
  -> FORCE_CONFIRM_TOOLS.has(tc.name)  [agentToolSelector.ts:31-34]
  -> onInteractionRequired([confirmQuestion], 'delete_confirm')  [agentLoop.ts:757]
  -> agentTaskWorker.onInteractionRequired  [agentTaskWorker.ts:374-391]
  -> mainWindow.webContents.send(AGENT_INTERACTION_QUESTION, { variant })  [agentTaskWorker.ts:387-390]
  -> preload.ts: subscribe AGENT_INTERACTION_QUESTION, map to { type:'interaction', variant }  [preload.ts:464-472]
  -> agentStore.onInteraction → set pendingInteraction({ variant })  [agentStore.ts:856-866]
  -> AIPanelSession: variant === 'delete_confirm' ? 'delete_confirm' : 'default'  [AIPanelSession.tsx:119]
  -> QuestionCard variant='delete_confirm' -> 红色警告样式  [QuestionCard.tsx:50, 224-231]
  -> waitForInteraction → answer[toolCallId] === 'yes'?  [agentLoop.ts:760-786]
  -> confirm → executeOneTool / cancel → { cancelled: true }  [agentLoop.ts:774-785]
  -> no interaction support → 安全拒绝对应错误  [agentLoop.ts:787-798]
```

### 接口契约验证

| 项目 | 调用方 | 被调用方 | 匹配 |
|------|--------|----------|------|
| `FORCE_CONFIRM_TOOLS` 集合内容 | agentLoop.ts:740 | agentToolSelector.ts:31-34 (`deleteFile`, `deleteLocalFile`) | ✅ |
| `onInteractionRequired` 签名 | agentLoop.ts:69 | agentTaskWorker.ts:374 | ✅ `(IClarifyQuestion[], variant?: string) => void` |
| `IClarifyQuestion` 字段 | agentLoop.ts:750-754 | shared/ai/clarify.ts:4-11 | ✅ id, text, type:'confirm' |
| `AgentInteractionPayload` | agentTaskWorker.ts:381 | shared/ai/agent.ts:59-64 | ✅ sessionId, conversationId, questions, variant? |
| preload IPC 映射 | preload.ts:466-472 | agentStore.ts:396-401 | ✅ type:'interaction' with variant field |
| QuestionCard variant prop | AIPanelSession.tsx:119 | QuestionCard.tsx:17, 50 | ✅ 'delete_confirm' / 'default' |

### 错误处理

| 场景 | 位置 | 处理 |
|------|------|------|
| `waitForInteraction` 被 reject | agentLoop.ts:761-772 | 注入 `{ cancelled: true }` + errorDesc ✅ |
| args 解析失败（提取 fileInfo） | agentLoop.ts:744-748 | catch 块忽略，仅 fileInfo 为空 ✅ |
| 无 interaction 支持 | agentLoop.ts:787-798 | 注入 error 结果，描述"需用户确认" ✅ |
| persistOnly DB 写入失败 | agentTaskWorker.ts:382-386 | try/catch 降级，不阻断主流程 ✅ |
| resumeInteraction IPC 失败 | agentStore.ts:1424-1427 | try/catch + 清除 pendingInteraction ✅ |
| 任务结束后清理残留交互 | agentTaskWorker.ts:291-298 | finally 块 reject 所有残留交互 ✅ |

### 向后兼容

- `variant` 所有层级均为可选字段 ✅
- 旧路径（无 variant 传入）→ QuestionCard 默认为 'default' ✅

**结论：所有契约对齐，错误处理完整，向后兼容。**

---

## 链路 2: KB 澄清联动（R4）— 状态：✅ 通畅

### 调用链跟踪

```
searchKBHandler.handleSearchKB (L48-108)
  -> res.refused || results.length === 0 检测  [searchKBHandler.ts:77]
  -> buildMinimalUnderstanding(query, res)  [searchKBHandler.ts:78]
       -> detectAmbiguities(query)  [queryPlanner]
       -> classifyIntent(query)  [queryPlanner]
       -> confidence 从 best.score 推断  [searchKBHandler.ts:28-33]
  -> buildClarificationContext(understanding, res.refused || false)  [searchKBHandler.ts:79]
       -> needsClarification(understanding, searchRefused)  [knowledgeClarify.ts:69-80]
       -> generateClarifyQuestions(understanding)  [knowledgeClarify.ts:46-66]
       -> 按 text/choice 分组，构建分轮策略文本  [knowledgeClarify.ts:125-161]
  -> 注入 clarificationNeeded + clarificationContext 到 tool result JSON  [searchKBHandler.ts:83-108]
  -> LLM 在下一轮读取 -> 决定调用 ask_question_card
```

### 接口契约验证

| 项目 | 调用方 | 被调用方 | 匹配 |
|------|--------|----------|------|
| `IQueryUnderstanding` 字段 | buildMinimalUnderstanding (L35-41) | shared/ai/kb.ts:49-55 | ✅ intent, standalone, expanded, ambiguities, confidence |
| `AmbiguityType` 枚举 | questionsForAmbiguity (L15-43) | shared/ai/kb.ts:46 | ✅ pronoun_reference, missing_subject, broad_scope, too_short |
| `buildClarificationContext` 返回类型 | searchKBHandler.ts:79 | knowledgeClarify.ts:115 (string \| null) | ✅ |
| `needsClarification` 逻辑 | buildClarificationContext L119 | knowledgeClarify.ts:69-80 | ✅ 被拒+歧义 / 置信<0.5 / 被拒+过短 |

### 数据格式

| 场景 | tool result 格式 | 说明 |
|------|------------------|------|
| 无澄清需求 + 正常结果 | `JSON.stringify(res.results)` (数组) | searchKBHandler.ts:98 ✅ 向后兼容 |
| 无澄清需求 + 被拒 | `{ refused: true, threshold, best, message }` | searchKBHandler.ts:83-93 ✅ |
| 有澄清需求 + 被拒 | `{ refused: true, threshold, best, message, clarificationNeeded: true, clarificationContext: "..." }` | searchKBHandler.ts:89-93 ✅ |
| 有澄清需求 + 有结果 | `{ results: [...], clarificationNeeded: true, clarificationContext: "..." }` | searchKBHandler.ts:101-108 ✅ |

### 向后兼容

- 无澄清时仍返回原有数组格式（searchKBHandler.ts:97-98）✅
- `clarificationNeeded` 和 `clarificationContext` 仅在有歧义时注入 ✅
- LLM 可选择忽略 clarificationContext（它只是 tool result 中的建议性文本）✅

**结论：类型完备，数据格式正确，向后兼容。**

---

## 链路 3: DiffSummaryCard Store 集成（R1+R6）— 状态：⚠️ 风险

### 调用链跟踪

```
DiffSummaryCard (L450-669)
  -> useDiffSummaryHandlers(source)  [L275-438]
       -> switch source.kind:
            'rewrite'     → rewriteStore   (applyAllRewrites/applyRewrite/clearRewrite/discardAllRewrites/dismissRewriteResult)
            'editBlocks'  → agentStore     (applyEditBlocksProposal/discardEditBlocksProposal/clearEditBlocksProposals)
            'patch'       → agentStore     (applyPatchProposal/discardPatchProposal)
  -> 薄壳卡片:
       RewritePreviewCard   -> source={kind:'rewrite', data:...}   [L113-115]
       EditBlocksPreviewCard -> source={kind:'editBlocks', data:...} [L27]
       PatchPreviewCard     -> source={kind:'patch', data:...}      [L40]
```

### Union type 判别正确性

| source.kind | handleApplyAll 路由 | handleDiscardAll 路由 | handleDismiss 路由 | 状态 |
|-------------|---------------------|-----------------------|-------------------|------|
| `'rewrite'` (单) | `rstore.applyRewrite()` | `rstore.clearRewrite()` | `rstore.dismissRewriteResult()` | ✅ |
| `'rewrite'` (多) | `rstore.applyAllRewrites()` | `rstore.discardAllRewrites()` | `rstore.dismissRewriteResult()` | ✅ |
| `'editBlocks'` | `astore.applyEditBlocksProposal(i)` × N | `astore.discardEditBlocksProposal(i)` × N | `astore.clearEditBlocksProposals()` | ✅ |
| `'patch'` | `astore.applyPatchProposal(p.id)` × N | `astore.discardPatchProposal(p.id)` × N | 遍历 discard 所有 pending | ✅ |

### Store action 签名匹配

| Store action | 薄壳调用 | DiffSummaryCard 调用 | 匹配 |
|-------------|----------|---------------------|------|
| `rewriteStore.applyRewrite()` | 不调用（R6 移除） | L324 (单文件) | ✅ 无参数 |
| `rewriteStore.applyAllRewrites()` | 不调用（R6 移除） | L322 (多文件) | ✅ 无参数 |
| `rewriteStore.clearRewrite()` | 不调用（R6 移除） | L389 (单文件 discard) | ✅ 无参数 |
| `rewriteStore.discardAllRewrites()` | 不调用（R6 移除） | L387 (多文件 discard) | ✅ 无参数 |
| `rewriteStore.dismissRewriteResult()` | 不调用（R6 移除） | L420 (dismiss) | ✅ 无参数 |
| `agentStore.applyEditBlocksProposal(i)` | DetailModal 调用 | L346 (apply all) | ✅ number |
| `agentStore.discardEditBlocksProposal(i)` | DetailModal 调用 | L398 (discard all) | ✅ number |
| `agentStore.clearEditBlocksProposals()` | DetailModal 不调用 | L424 (dismiss) | ✅ 无参数 |
| `agentStore.applyPatchProposal(id)` | DetailModal 调用 | L372 (apply all) | ✅ string, number? |
| `agentStore.discardPatchProposal(id)` | DetailModal 调用 | L407 (discard all) | ✅ string, number? |

### Staleness 检测一致性

| source.kind | DiffSummaryCard 检测方式 | Store 自身检测 | 一致性 |
|-------------|------------------------|---------------|--------|
| `'rewrite'` (单) | apply 后读 `staleRejected` (L327) | applyRewrite 内直接比对 (L260) | ✅ 同步 |
| `'rewrite'` (多) | apply 后读 `staleRejected` (L327) | applyAllRewrites 内直接比对 (L324) | ✅ 同步 |
| `'editBlocks'` | `firstPending.originalContent !== currentContent` (L339) | applyEditBlocksProposal 无 staleness 检测 | ⚠️ DetailModal 路径无保护 |
| `'patch'` | `simpleHash(currentContent)` vs `p.contentHash` (L359-366) | applyPatchProposal 无 staleness 检测 | ⚠️ DetailModal 路径无保护 |

### 风险项

1. **multi-rewrite discard 后 resultState 不更新**
   - 位置: DiffSummaryCard.tsx:285-286 (rewrite resultState 推导) vs rewriteStore.ts:343-350 (discardAllRewrites)
   - 问题: `discardAllRewrites` 只标记文件状态为 discarded，不设置 `rewriteResult`。而 `useDiffSummaryHandlers` 的 rewrite resultState 推导仅读 `rewriteResult` 字段
   - 影响: 多文件改写全部废弃后，DiffSummaryCard 不会显示"已取消"横幅
   - 等级: 低 (操作仍生效，仅 UI 反馈缺失)

2. **DetailModal 路径无 staleness 检测**
   - 位置: EditBlocksDetailModal / PatchDetailModal
   - 问题: 用户通过 DetailModal 的「应用」按钮确认时，不经过 DiffSummaryCard 的 staleness 检测
   - 影响: 用户在 DetailModal 打开后，外部修改了文档，仍可能成功应用到过期文档
   - 等级: 低 (计划明确保留 DetailModal 现状)

**结论：核心路径通畅，两个低风险项为已知限制。**

---

## 链路 4: QuestionCard 向导（R2）— 状态：❌ 断裂

### 调用链跟踪

```
LLM 调用 ask_question_card(questions, round=1, totalRounds=2)
  -> executeAskQuestionCard() 创建 IClarifySession({ questions, round, totalRounds })
     [askQuestionCard.ts:113-119] ✅ round/totalRounds 正确写入 session
  -> agentLoop L601-604: 解析 tool result
     const parsed = JSON.parse(result.content) as {
       success?: boolean;
       session?: { questions?: IClarifyQuestion[] }  // ⚠️ 类型标注缺少 round/totalRounds
     };
     deps.onInteractionRequired(parsed.session.questions);  // ❌ 仅传 questions，丢弃 round/totalRounds
  -> agentTaskWorker L374: onInteractionRequired(questions: IClarifyQuestion[], variant?: string)
     ❌ 签名不支持 round/totalRounds
  -> AgentInteractionPayload (shared/ai/agent.ts:59-64):
     { sessionId, conversationId, questions, variant? }
     ❌ 无 round/totalRounds 字段
  -> preload.ts L464-472: 仅转发 sessionId/conversationId/questions/variant
     ❌ 无 round/totalRounds
  -> agentStore L856-866: pendingInteraction = { sessionId, conversationId, questions, variant }
     ❌ 无 round/totalRounds
  -> AIPanelSession L115-120:
     <QuestionCard questions={...} onSubmit={...} variant={...} />
     ❌ 无 round/totalRounds 传递
  -> QuestionCard L235-239: round={round} totalRounds={totalRounds}
     ✅ 组件层面支持，但数据从未到达
```

### 断裂点分析

| 层级 | 是否有 round/totalRounds | 状态 |
|------|--------------------------|------|
| ask_question_card tool schema (主进程) | ✅ 有 (optional) | OK |
| executeAskQuestionCard → IClarifySession | ✅ 有 | OK |
| agentLoop 解析 tool result | ❌ 类型标注未声明，变量提取不包含 | **断裂** |
| agentLoop onInteractionRequired 签名 | ❌ 无 round/totalRounds 参数 | **断裂** |
| agentTaskWorker onInteractionRequired | ❌ 同上 | **断裂** |
| AgentInteractionPayload 类型 | ❌ 无 round/totalRounds | **断裂** |
| preload IPC 映射 | ❌ 无 round/totalRounds | **断裂** |
| agentStore pendingInteraction | ❌ 无 round/totalRounds | **断裂** |
| AIPanelSession → QuestionCard | ❌ 无 prop 传递 | **断裂** |
| QuestionCard 组件 | ✅ 支持 round/totalRounds prop | OK |

### 数据流断裂示意

```
ask_question_card(round=1, totalRounds=2)
    ↓ ✅
IClarifySession { round:1, totalRounds:2, questions:[...] }
    ↓ ❌ agentLoop 仅提取 questions，丢弃 round/totalRounds
onInteractionRequired(questions)
    ↓ (round/totalRounds 已丢失)
... 整条 IPC 链无 round/totalRounds ...
    ↓
QuestionCard(round=undefined, totalRounds=undefined)
    → 始终显示默认标题 "AI 需要更多信息"
```

### 影响范围

- **功能**：分轮澄清的轮次指示器永不显示（QuestionCard 始终显示默认标题）
- **Prompt**：LLM 可能调用 `ask_question_card(round=1, totalRounds=2)`，但用户看不到轮次信息
- **数据完整性**：轮次元数据在 agentLoop 层丢失

### 修复建议

需在以下 6 处添加 round/totalRounds 透传：

1. `agentLoop.ts:69` — `onInteractionRequired` 签名添加 `round?: number, totalRounds?: number`
2. `agentLoop.ts:601-604` — 提取 `parsed.session.round` 和 `parsed.session.totalRounds`
3. `agentTaskWorker.ts:374` — `onInteractionRequired` 回调添加两个参数
4. `shared/ai/agent.ts:59-64` — `AgentInteractionPayload` 添加 `round?` `totalRounds?`
5. `preload.ts:464-472` — IPC 映射转发 round/totalRounds
6. `agentStore.ts:163-169` — `pendingInteraction` 类型 + `AIPanelSession.tsx:119` — 传递 prop

**结论：round/totalRounds 在 agentLoop 层丢失，整条 IPC 链无透传。核心 ask_question_card 功能正常，但 R3 需求中的轮次显示功能不工作。**

---

## 链路 5: Clarification Rules 注入（R3）— 状态：✅ 通畅

### 验证项目

| 项目 | 位置 | 状态 |
|------|------|------|
| "分轮澄清策略" 段落在写入规则之前 | agentPromptBuilder.ts:171 vs 193 | ✅ |
| 场景 1: 创建缺位置/文件名模板 | agentPromptBuilder.ts:175-177 | ✅ |
| 场景 2: 修改缺目标模板 | agentPromptBuilder.ts:179-181 | ✅ |
| 场景 3: 删除缺目标模板 | agentPromptBuilder.ts:183-185 | ✅ |
| 场景 4: 模糊需求模板 | agentPromptBuilder.ts:187-189 | ✅ |
| 每轮最多 2 个问题约束 | agentPromptBuilder.ts:173 | ✅ |
| round/totalRounds 参数使用指导 | agentPromptBuilder.ts:191 | ✅ |
| 删除操作强制确认说明 | agentPromptBuilder.ts:196-197 | ✅ |
| ask_question_card tool schema round/totalRounds | askQuestionCard.ts:50-59 | ✅ |
| IClarifySession round/totalRounds 字段 | shared/ai/clarify.ts:18-19 | ✅ |
| executeAskQuestionCard 正确处理 round/totalRounds | askQuestionCard.ts:117-118 | ✅ |

### 段落位置验证

```
agentPromptBuilder.ts 输出结构：

【核心规则】
## 工作流
## 工具规则
## 分轮澄清策略          ← L171 R3 新增段落
## 写入规则              ← L193 (在澄清策略之后 ✅)
## 要点
## 回答格式
[文件列表快照]
[本地文件快照]
```

### 场景模板完整性验证

| 需求中的场景 | 代码中的场景 | 参数 | 匹配 |
|-------------|-------------|------|------|
| 创建文档缺位置/文件名 | 场景 1: 第 1 轮问文件名 → 第 2 轮问位置 | text + choice | ✅ |
| 修改文档缺目标 | 场景 2: 第 1 轮列 5 文件 → 第 2 轮问方向 | choice+其它 + choice | ✅ |
| 删除文档缺目标 | 场景 3: 第 1 轮列候选 → 第 2 轮二次确认 | choice+其它 + confirm | ✅ |
| 模糊需求 | 场景 4: 第 1 轮问风格 | choice | ✅ |

**结论：Prompt 段落位置正确，4 个场景模板完整，ask_question_card 工具 schema 支持 round/totalRounds。**

---

## 汇总

| 链路 | 需求 | 状态 | 关键发现 |
|------|------|------|----------|
| 1: Delete 确认流程 | R5 | ✅ 通畅 | 双层防线完整，错误处理齐备，向后兼容 |
| 2: KB 澄清联动 | R4 | ✅ 通畅 | IQueryUnderstanding 字段完备，格式正确，向后兼容 |
| 3: DiffSummaryCard Store 集成 | R1+R6 | ⚠️ 风险 | 核心路径通畅，2 个低危已知限制 |
| 4: QuestionCard 向导 | R2 | ❌ 断裂 | round/totalRounds 在 agentLoop 层丢失，整条 IPC 链缺失透传 |
| 5: Clarification Rules 注入 | R3 | ✅ 通畅 | Prompt 段落位置正确，4 场景完整 |

### 需修复项

1. **必须修复（Phase 6.5 阻塞）**：链路 4 — round/totalRounds IPC 透传
   - 修复范围：6 处变更（agentLoop / agentTaskWorker / shared/ai/agent.ts / preload / agentStore / AIPanelSession）
   - 预计工作量：约 30 行变更

### 可接受项（已知限制，不阻塞）

1. 链路 3 — multi-rewrite discard 后 resultState 不显示（UI 细微缺陷）
2. 链路 3 — DetailModal 路径无 staleness 检测（保留现状，计划明确）

---

## 附录 A: 已验证的共享类型契约

| 类型 | 文件 | 字段 | 跨层使用 |
|------|------|------|----------|
| `IClarifyQuestion` | shared/ai/clarify.ts | id, text, type, options?, dependsOn?, condition? | agentLoop, agentTaskWorker, preload, agentStore, QuestionCard |
| `IClarifySession` | shared/ai/clarify.ts | questions, answers, phase, round?, totalRounds? | askQuestionCard.ts 内部，agentLoop 部分提取 |
| `AgentInteractionPayload` | shared/ai/agent.ts | sessionId, conversationId, questions, variant? | agentTaskWorker, preload, agentStore (缺 round/totalRounds) |
| `IQueryUnderstanding` | shared/ai/kb.ts | intent, standalone, expanded, ambiguities, confidence | searchKBHandler, knowledgeClarify |
| `DiffSummarySource` | DiffSummaryCard.tsx | kind: 'rewrite'\|'editBlocks'\|'patch', data | 三个薄壳卡片 |
| `EditBlocksProposal` | agentStore.ts | toolName, fileId?, fileName?, originalContent, newContent, status | DiffSummaryCard, EditBlocksPreviewCard |
| `IPatchProposal` | shared/ai/clarify.ts | id, files, status, contentHash? | DiffSummaryCard, PatchPreviewCard |