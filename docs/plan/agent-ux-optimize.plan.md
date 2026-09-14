# agent-ux-optimize — 实施计划

> 生成：2026-09-14 | 基于：[需求文档](../requirements/agent-ux-optimize.req.md) | 定档：L

---

## 1. 变更清单

### 1.1 新建文件

| 文件 | 用途 |
|------|------|
| `src/render/components/AIAgent/cards/DiffSummaryCard.tsx` | 统一 diff 摘要卡片 |

### 1.2 修改文件

| 文件 | 关联需求 | 变更级别 |
|------|----------|----------|
| `src/render/components/AIAgent/cards/RewritePreviewCard.tsx` | R1 | 薄壳：import DiffSummaryCard，store→props 转换 |
| `src/render/components/AIAgent/cards/EditBlocksPreviewCard.tsx` | R1 | 薄壳：import DiffSummaryCard，store→props 转换 |
| `src/render/components/AIAgent/cards/PatchPreviewCard.tsx` | R1 | 薄壳：import DiffSummaryCard，store→props 转换 |
| `src/render/components/AIAgent/cards/QuestionCard.tsx` | R2, R3, R5 | 向导模式重写 + round 显示 + delete_confirm variant |
| `src/main/ai/tools/askQuestionCard.ts` | R3 | 新增 round/totalRounds 可选参数 |
| `src/main/ai/agent/agentPromptBuilder.ts` | R3, R5 | 注入 Clarification Rules + 更新写入规则 |
| `src/main/ai/agent/agentToolSelector.ts` | R5 | 新增 FORCE_CONFIRM_TOOLS 集合 |
| `src/main/ai/agent/agentLoop.ts` | R5 | 硬编码 delete 拦截 |
| `src/main/ai/knowledge/knowledgeClarify.ts` | R4 | 新增 buildClarificationContext() |
| `src/main/ai/tools/searchKBHandler.ts` | R4 | 注入 clarificationContext 到搜索结果 |
| `src/shared/ai/clarify.ts` | R3 | IClarifySession 新增 round?/totalRounds? |
| `src/render/styles/globals.css` | R2 | 新增 @keyframes shake/slide-horizontal-in/slide-horizontal-out |

---

## 2. 实施步骤（按 Q10 顺序）

### Step R1: DiffSummaryCard 基础组件 + 三卡片薄壳化

#### 2.1 创建 DiffSummaryCard.tsx

**数据类型：**

```typescript
type DiffSummarySource =
  | { kind: 'rewrite'; data: RewriteProposal | RewriteFileProposal[] }
  | { kind: 'editBlocks'; data: EditBlocksProposal[] }
  | { kind: 'patch'; data: IPatchProposal[] };
```

**组件结构：**

1. `useDiffSummaryData(source)` — 规范化 hook：将三种数据源统一为 `NormalizedDiffEntry[]`
2. 标题行：`[Icon] [文件名 + (−X / +Y)]` 或 `[Icon] [前2文件名 + 等N个文件]`（tooltip 完整列表）
3. 操作行：`[查看详情]`（仅多文件）`[全部废弃]` `[全部应用]`
4. 结果态：操作行替换为 `[关闭]`
5. Diff 区域：单文件默认折叠，展开后 `.slice(0, 200)` + `[显示全部]`
6. 颜色统一：删 `text-red-500 bg-red-500/10`，增 `text-green-600 bg-green-500/10`
7. 空 diff → 「无变更」

#### 2.2 三个旧卡片改为薄壳

```typescript
// RewritePreviewCard.tsx (示例)
import DiffSummaryCard from './DiffSummaryCard';

const RewritePreviewCard: React.FC = () => {
  const pendingRewrite = useRewriteStore(s => s.pendingRewrite);
  const pendingMultiRewrite = useRewriteStore(s => s.pendingMultiRewrite);
  // ... error/stale banner 逻辑保留 ...

  const source = pendingMultiRewrite
    ? { kind: 'rewrite' as const, data: pendingMultiRewrite }
    : pendingRewrite
      ? { kind: 'rewrite' as const, data: pendingRewrite }
      : null;

  if (!source) return /* 原有 banner 状态 */;
  return <DiffSummaryCard source={source} />;
};
```

EditBlocksPreviewCard、PatchPreviewCard 同理。

#### 2.3 globals.css 新增 keyframes

```css
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  10%, 50%, 90% { transform: translateX(-5px); }
  30%, 70% { transform: translateX(5px); }
}
@keyframes slide-horizontal-in {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
@keyframes slide-horizontal-out {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(-100%); opacity: 0; }
}
```

**验收标准：**
- [ ] DiffSummaryCard 单文件模式：文件名 + (−X/+Y) + 折叠 diff
- [ ] 单文件无「查看详情」
- [ ] 多文件：前 2 文件名 + tooltip + 「查看详情」
- [ ] 200 行截断 + 「显示全部」
- [ ] 颜色统一
- [ ] 三旧卡片编译通过、渲染正常

---

### Step R5: Delete 操作强制确认

#### 2.4 agentToolSelector.ts — 新增 FORCE_CONFIRM_TOOLS

```typescript
export const FORCE_CONFIRM_TOOLS = new Set([
  'deleteFile',
  'deleteLocalFile',
]);
```

#### 2.5 agentLoop.ts — 硬编码拦截

在 `executeToolRound` 中，进入 writableTcs 循环前检查：

```
FORCE_CONFIRM_TOOLS.has(tc.name) →
  1. 构建 confirm 类型 IClarifyQuestion（文件名 + 路径 + "不可恢复"）
  2. 调用 onInteractionRequired + waitForInteraction
  3. 用户确认 → 正常执行删除
  4. 用户取消 → 注入 { cancelled: true } 的 tool result
  5. 无 interaction 支持 → 注入 error tool result（安全优先）
```

#### 2.6 agentPromptBuilder.ts — 更新写入规则

```
## 写入规则
- 安全变更：直接执行。
- 删除文件（deleteFile / deleteLocalFile）：系统强制弹出确认卡片。
  调用删除工具前，必须在回复中说明即将删除的内容和原因。
```

#### 2.7 QuestionCard.tsx — delete_confirm variant

新增 `variant?: 'default' | 'delete_confirm'` prop：
- `delete_confirm` 模式下：标题显示红色警告图标 + 「此操作不可恢复」文案
- 确认按钮红色 `bg-red-500 hover:bg-red-600`

**验收标准：**
- [ ] FORCE_CONFIRM_TOOLS 含 deleteFile / deleteLocalFile
- [ ] Agent 调 deleteFile → 拦截 → 确认卡片弹出
- [ ] 确认卡片：文件名 + 路径 + 警告 + 确认/取消
- [ ] 取消 → tool call abort
- [ ] 确认 → 正常执行
- [ ] Prompt 含删除确认说明

---

### Step R6: DiffSummaryCard 写控制集成

#### 2.8 DiffSummaryCard 内部 store 对接

- `useDiffSummaryHandlers(source)` hook：根据 `source.kind` 返回正确的 apply/discard 函数
- Staleness 检测：apply 时对比 contentHash → 过期拒绝 + toast
- 文件列表截断：> 50 文件截断 + 「显示全部 N 个文件」

**验收标准：**
- [ ] 正确区分 rewriteStore / agentStore 数据源
- [ ] apply/discard 调正确的 store action
- [ ] Staleness 检测工作正常
- [ ] 文件列表截断正常

---

### Step R2: QuestionCard 向导式重构

#### 2.9 内核：useReducer 步骤状态机

```typescript
type WizardState = {
  currentIndex: number;
  direction: 'forward' | 'backward';
  answers: Record<string, string>;
  shakeTarget: string | null;
  showOtherInput: boolean;
};
```

#### 2.10 渲染

- 进度圆点：纯指示器，不可点击
- 单题：无导航 UI，直接题目 + 提交按钮
- 多题：`[上一题]` + 进度圆点 + `[下一题]`
- 动画：前向 `slide-horizontal-in`，后向 `slide-horizontal-out`，200ms ease-out
- choice/confirm：选完 300ms 延迟自动跳转
- text：手动点「下一题」
- 「其它」：inline 展开文本输入框，auto-focus
- shake：未回答提交 → 跳动到第一个未答题，红边框 2s（`animate-[shake_0.4s_ease-in-out]`）
- 空问题集：`return null`

**验收标准：**
- [ ] 单题无导航、多题向导 UI
- [ ] 选择自动跳转、文本手动
- [ ] 「其它」inline 输入
- [ ] shake 动画 + 红边框
- [ ] 前进/后退滑动动画
- [ ] 空问题集返回 null
- [ ] 无 Framer Motion 依赖

---

### Step R3: Agent 澄清规则注入

#### 2.11 agentPromptBuilder.ts — 新增 Clarification Rules

插入「写入规则」之前：

```
## 分轮澄清策略

信息不足时使用 ask_question_card 分轮提问（每轮最多2个问题）：

场景1-创建文档缺位置/文件名：第1轮问文件名 → 第2轮问位置（choice列根文件夹）
场景2-修改文档缺目标：第1轮列最近5文件（choice+其它）→ 第2轮问方向
场景3-删除文档缺目标：第1轮列候选 → 第2轮二次确认
场景4-模糊需求：第1轮问风格（正式/轻松/学术/创意/自定义）
```

#### 2.12 askQuestionCard.ts — 新增 round/totalRounds

Schema 新增（均为可选，向后兼容）：
- `round: { type: 'number', description: '当前轮次(1-based)' }`
- `totalRounds: { type: 'number', description: '预计总轮次' }`

#### 2.13 shared/ai/clarify.ts — IClarifySession 扩展

```typescript
interface IClarifySession {
  // ... existing fields ...
  round?: number;
  totalRounds?: number;
}
```

#### 2.14 QuestionCard.tsx — 显示轮次信息

标题区：`round && totalRounds ? "追问（X/Y）" : round ? "第X轮提问" : 默认标题`

**验收标准：**
- [ ] Prompt 含「分轮澄清策略」
- [ ] 4 场景模板完整
- [ ] ask_question_card schema 含 round/totalRounds
- [ ] QuestionCard 显示轮次
- [ ] 向后兼容（旧调用无 round 参数仍正常）

---

### Step R4: 知识库澄清联动

#### 2.15 knowledgeClarify.ts — 新增 buildClarificationContext()

```typescript
export function buildClarificationContext(
  understanding: IQueryUnderstanding,
  searchRefused: boolean
): string | null
```

生成注入 Agent 上下文的澄清提示文本，让 LLM 决定是否调用 ask_question_card。

#### 2.16 searchKBHandler.ts — needsClarification 钩子

搜索无结果或被拒绝时：
1. `buildMinimalUnderstanding(query, res)` 构建理解
2. `buildClarificationContext()` 生成上下文
3. 注入 `clarificationNeeded` + `clarificationContext` 到 tool result

**验收标准：**
- [ ] `buildClarificationContext` 生成可注入文本
- [ ] `searchKBHandler` 在无结果时注入 clarificationContext
- [ ] LLM 可读取 context 并决定是否调 ask_question_card
- [ ] KB 场景支持分轮策略

---

## 3. 模块依赖图

```
渲染层:
  globals.css ← QuestionCard.tsx (动画)
  rewriteDiff.ts → DiffSummaryCard.tsx ← rewriteStore / agentStore
  DiffSummaryCard.tsx ← RewritePreviewCard / EditBlocksPreviewCard / PatchPreviewCard (薄壳)

主进程:
  agentPromptBuilder.ts → agentLoop.ts
  agentToolSelector.ts (FORCE_CONFIRM_TOOLS) → agentLoop.ts (拦截)
  askQuestionCard.ts ← agentLoop.ts (pause/resume)
  knowledgeClarify.ts → searchKBHandler.ts → agentLoop.ts (context 注入)

共享层:
  shared/ai/clarify.ts (IClarifySession 扩展) ← askQuestionCard.ts + QuestionCard.tsx
  shared/ai/kb.ts (IQueryUnderstanding) ← knowledgeClarify.ts
```

## 4. 数据流：Delete 确认

```
LLM 调 deleteFile(id) → agentLoop 检测 FORCE_CONFIRM_TOOLS →
构建 confirm IClarifyQuestion → IPC → QuestionCard(variant='delete_confirm') →
用户确认 → 执行删除 / 用户取消 → 注入 { cancelled: true }
```

## 5. 数据流：KB 澄清

```
searchKBHandler 无结果 → buildClarificationContext() →
注入 tool result → LLM 读取 → 决定调 ask_question_card →
agentLoop pause/resume → QuestionCard → 用户回答 → LLM 继续搜索
```

## 6. 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| DiffSummaryCard union type 复杂 | 中 | `useDiffSummaryData` 规范化 + exhaustive narrowing |
| QuestionCard 重写影响现有调用 | 中 | 保留 props 接口，增量添加 |
| Delete 拦截影响 agentLoop 稳定性 | 低 | 仅 FORCE_CONFIRM_TOOLS，其他 write 不变 |
| KB 上下文注入可能干扰 LLM | 中 | 作为 tool result 元数据，非 system prompt |
| Staleness 误报（空白字符变化） | 低 | `simpleHash(content.trim())` |
| round/totalRounds 向后兼容 | 低 | Schema optional，渲染层 null 检查 |