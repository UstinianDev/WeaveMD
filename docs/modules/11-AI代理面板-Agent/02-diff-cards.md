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

---

