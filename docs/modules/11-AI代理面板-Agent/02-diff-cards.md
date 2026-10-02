# Diff 卡片系统（§7）

> 拆分自 [11-AI代理面板-Agent.md](../11-AI代理面板-Agent.md)，原 §7 Diff 卡片系统；2026-10-01 按渐进式披露拆分，正文未改动。
> 返回索引：[11-AI代理面板-Agent.md](../11-AI代理面板-Agent.md)

---

## 7. Diff 卡片系统

### 7.1 DiffSummaryCard 统一组件

三种写工具的预览卡片——改写（rewrite）、块级编辑（editBlocks）、文件补丁（patch）——曾分别独立
实现 diff 渲染逻辑。现已统一为 `DiffSummaryCard` 单一组件，通过 **discriminated union type**
路由数据源：

```ts
type DiffSummarySource =
  | { kind: 'rewrite'; data: RewriteProposal | RewriteFileProposal[] }
  | { kind: 'editBlocks'; data: EditBlocksProposal[] }
  | { kind: 'patch'; data: IPatchProposal[] };
```

- **`normalizeSource()`**：将三种异构数据源标准化为 `NormalizedDiffFile[]`（label / oldContent /
  newContent / sourceIndex）
- **`diffLines()`**（`src/render/filters/rewriteDiff.ts`）行级 LCS diff，红删绿增统一渲染
- 单文件场景在标题行直接显示 `(−N / +M)` 统计；多文件场景显示文件名列表（>50 个文件默认截断，
  提供"显示全部"按钮）
- 操作行：`全部废弃` / `查看详情` / `全部应用`（应用后切换为 `关闭`）
- 结果态横幅：已应用（绿色）+ 已取消（灰色）

### 7.2 三种薄壳卡片

| 卡片 | 文件 | 职责 |
|------|------|------|
| `RewritePreviewCard` | `cards/RewritePreviewCard.tsx` | 读 rewriteStore，构建 `{ kind: 'rewrite' }` source，error/stale banner 逻辑 |
| `EditBlocksPreviewCard` | `cards/EditBlocksPreviewCard.tsx` | 读 agentStore.editBlocksProposals，构建 `{ kind: 'editBlocks' }` source |
| `PatchPreviewCard` | `cards/PatchPreviewCard.tsx` | 读 agentStore.patchProposals，构建 `{ kind: 'patch' }` source |

薄壳卡片仅负责 **store 读写 + 详情面板开关**，diff 渲染全量委托给 `DiffSummaryCard`。
不传 `onApplyAll` / `onDiscardAll` / `onDismiss` 时，`DiffSummaryCard` 内部
`useDiffSummaryHandlers` hook 按 `source.kind` 自动路由到对应 store 方法。

### 7.3 DetailModal 系统

三种详情面板，均通过 `createPortal` 挂载到 `document.body`，实现**居中全应用模态框**：

| 详情面板 | 文件 | 特性 |
|----------|------|------|
| `RewriteDetailModal` | `cards/RewriteDetailModal.tsx` | 左侧文件列表 + 右侧行级 diff；单文件按 fileName 选 |
| `EditBlocksDetailModal` | `cards/EditBlocksDetailModal.tsx` | 左侧文件列表 + 右侧行级 diff；**同名文件合并**（`mergeProposalsByFile`）；按 toolName 区分标题 |
| `PatchDetailModal` | `cards/PatchDetailModal.tsx` | 展平所有 proposal.files 的扁平列表；[新增]/[删除] 类型标记 |

三个 DetailModal 共享样式风格：
- macOS 三色圆点标题栏（复用 `insert-url-modal` CSS class）
- `Escape` 键关闭
- 左侧文件列表可点击切换，右侧实时 diff 预览

### 7.4 mergeProposalsByFile（同名文件合并）

`editBlocks` 工具可能在同一轮被多次调用（例如 LLM 先输出草稿再修正同一文件），同一文件名的
多个提案需要合并为一个展示：

- 以 `fileName` 为 key 去重，取首个 `originalContent` + 最后一个 `newContent`
- 返回合并后的虚拟提案列表 + 每个虚拟项对应的原始索引数组（`originalIndices`），
  便于 apply/discard 时批量操作

### 7.5 流式延迟显示

三种薄壳卡片在渲染时均检查 `useAgentStore.isStreaming`：

```
if (isStreaming) return null;
```

流式传输期间不显示任何预览卡片，避免用户在 LLM 回答未完成时误触 `全部应用` /
`全部废弃`。流式结束后（isStreaming 切回 false），卡片自动出现。

### 7.6 Staleness 检测

用户在 AI 回答期间可能手动编辑文档，导致预览 diff 的基准内容过期。
`useDiffSummaryHandlers` hook 在 apply 前执行 staleness 检测：

| source.kind | 检测方式 |
|-------------|----------|
| `rewrite` | 调 rewriteStore.applyRewrite → 读 `staleRejected` 标记 |
| `editBlocks` | 对比首个 pending proposal 的 `originalContent` 与当前编辑器 `content`。**豁免**：`editLocalFile` / `createFile`（直接写盘工具，文件已变更，无需比对 originalContent） |
| `patch` | 对比 proposal 的 `contentHash`（数组或单值）与当前编辑器 `simpleHash(content)` |

检测失败时显示红色横幅 `"文档已被外部修改，请重新生成"`，apply 操作被拦截。

#### 7.6.1 链写批次 staleness（按子任务 / 按项粒度，agent-multi-intent 任务 12）

与上表互补、不重叠：上表是**渲染侧 apply 级**检测（有 apply 步骤的提案卡）；
链写批次条目是主进程**直接写盘工具**（`batch` 档，无 apply 步骤），走主进程确认级检测：

- **收集时记写前哈希**：`checkForceConfirmTools` 的 batch 分支在执行写工具**之前**读目标
  文件现内容取 `xxHash64Sync`（`WriteBatchItem.originalContentHash`，参照
  `editBlocksHandler` / `previewFileRevision` 先例）；同时从 `ctx.currentSubtaskId /
  currentSubtaskIndex`（`applySubtaskContext` 在子任务切换时写入）标注条目归属。
  目标不可读（新建 / `file_id` 类）缺省 `undefined` → 确认时跳过复检。**收集仍为零打断**。
- **确认时逐项复检**：`confirmWriteBatch` 构造 `write_batch` 问题前逐项重读现内容哈希，
  与写前哈希不一致（或已不可读）→ 该项 question `text` 加前缀「⚠️ 目标在执行后被外部修改。」，
  并进 `WriteBatchConfirmResult.staleIds`。**不改 `IClarifyQuestion` 类型**；用户仍逐项决定
  （不自动拒绝、不自动回滚——方向交给人）。`BatchConfirmCard` 逐项渲染 `q.text`，前缀自然呈现
  （组件测试 `tests/components/BatchConfirmCard.test.tsx`）。

#### 7.6.2 汇总确认与部分拒绝语义（Q13 + Q22）

- **链末汇总为唯一默认确认点**：不逐子任务打断；执行期收集零打断（既有断言不变）。
  `confirmWriteBatch` 返回值仍为 `string`（明示文本），结构化结果
  `{rejectedIds, acceptedIds, items, cascadeSkippedIds, staleIds}` 经可选第三参 sink 传出。
- **拒 k → 一次性快照回滚**：`rollbackToSnapshot` 恰一次；已接受的 `editLocalFile`
  回滚后重放（保留确认变更）。回滚粒度限制如实记录、不扩大承诺——交叉引用
  [`specs/ai-agent/agent-tool-runtime.md` §14.3](../../specs/ai-agent/agent-tool-runtime.md)
  （遗留 5：非内容型写——新建/重命名/移动——不在快照覆盖范围）。
- **取消（reject）**：`waitForInteraction` reject 沿 `finalizeChainRun` 向上传播 →
  外层 `AI_STREAM_ERROR` 单次收口、不锁死 `waiting_interaction`（不引入
  `waiting_operation_confirmation`）。

#### 7.6.3 级联口径（Q22 落地解释）

依赖来源 = `intent_json.deps`（`buildDepsMap(plan)`，`serial_after` 归一，含
`normalizeTaskPlan` 对不同对象写的自动串行标注）。`cascadeSkipDependents(chain, record,
rejectedId)` 求**传递闭包**后按当前状态标注：

| 场景 | 触发点 | 标注 | 行为 |
|------|--------|------|------|
| 链中拒绝 | `subtask_failed` 用户跳过 k（或无交互 fail-safe 跳过） | 未执行后继 → `skipped_dependency` | 从执行序列剪出，**不再下达指令**；明示进链 buffer |
| 链末批次拒绝 | `write_batch` 确认拒项 | 已执行后继 → `dependency_rejected` | **只入报告标注，不自动回滚后继产物** |

- 已执行产物不回滚的理由：逐项可拒是用户权利，级联只做报告标注与明示，避免二次回滚
  放大不可逆损失；无依赖的子任务闭包为空 → 零误伤。
- 报告呈现：`ChainReportTask.cascade` 为加法可选字段（缺省不产出键，既有
  `toEqual` 断言等价）；`renderReportSegment` 仅对级联项输出条件新增行
  （`- s2：已跳过（级联：前置依赖未执行）` / `- s2：已级联标注（依赖的前置写入被拒绝，已执行产物保留）`），
  既有 成功/失败/已跳过 文案与 6 处全文 `toBe` 锚点逐字不变。

---

