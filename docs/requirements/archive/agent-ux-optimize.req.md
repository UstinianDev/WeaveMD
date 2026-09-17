# agent-ux-optimize — 需求文档

> 来源：`优化方向.md` + grill-me 两轮对齐 | 定档：L | 2026-09-14

## 需求清单

### R1: DiffSummaryCard 统一摘要卡片

**目标**：消除 RewritePreviewCard / EditBlocksPreviewCard / PatchPreviewCard 三张卡片的 diff 渲染重复逻辑，统一为一个 DiffSummaryCard 组件。

**验收标准**：
- [ ] 新建 `src/render/components/AIAgent/cards/DiffSummaryCard.tsx`
- [ ] 三旧卡片改为别名重导出：`export { DiffSummaryCard as RewritePreviewCard }` 等
- [ ] 摘要卡片布局：标题行（图标 + 文件数 + 增删统计）→ 操作行（查看详情/全部废弃/全部应用），结果态操作行替换为关闭按钮
- [ ] 单文件时显示 `文件名 + (−X / +Y)`，diff 行**默认折叠**，点击展开内联 diff；**不显示「查看详情」按钮**
- [ ] 多文件时标题行显示前 2 个文件名 + `等N个文件`，悬停 tooltip 显示完整列表；提供「查看详情」按钮打开已有 DetailModal
- [ ] 展开态统一截断 200 行 + 「显示全部」按钮展开余下内容
- [ ] 统一颜色方案：`text-red-500 bg-red-500/10`（删除）/ `text-green-600 bg-green-500/10`（插入）
- [ ] 空 diff 显示「无变更」而非空卡片
- [ ] 应用/废弃操作更新对应 store 的 proposal status（pending → applied/discarded）
- [ ] staleness detection（MD5 contentHash）在应用时二次校验，过期则拒绝并提示

**对齐决策（Q1/Q5/Q6/Q7）**：
- 旧卡片保留文件名，内部 import DiffSummaryCard 作为薄壳
- 展开态统一 200 行截断，RewritePreviewCard 需补上截断逻辑
- 单文件不显示「查看详情」按钮，Modal 仅多文件场景使用
- 保留文件名向后兼容，下次 major 版本删除旧文件

### R2: QuestionCard 向导式重构

**目标**：将列表式（所有题目堆叠滚动）改为向导式（每次一题、放大字体、进度导航、未回答震动跳转）。

**验收标准**：
- [ ] 向导模式：每次只显示一道题，底部「上一题/下一题」按钮 + 进度圆点指示器
- [ ] 单题时（visibleQuestions.length === 1）不显示导航，直接展示题目 + 提交按钮
- [ ] 2 题及以上显示完整向导 UI
- [ ] 选择题（choice/confirm）选完自动滑到下一题（水平滑动 200ms ease-out）
- [ ] 文本题需手动点「下一题」
- [ ] 选项列表末尾固定「其它」按钮，点击后 inline 展开文本输入框，自动聚焦
- [ ] confirm 类型也视为选择题，选完自动跳转
- [ ] 提交验证：遍历找第一个未回答 → 设为当前题 + shake 动画（5px 0.4s）+ 红边框 2s
- [ ] 空问题集返回 null，Agent loop 自动 continue
- [ ] 纯 CSS transition（`translateX(100%→0)` 进入 / `0→-100%` 退出），不引入 Framer Motion
- [ ] 用户可通过「上一题」回去改选
- [ ] 新增 `@keyframes shake` 和 `@keyframes slide-horizontal` 到 `globals.css`

**对齐决策（Q2/Q8）**：
- 进度圆点为纯指示器不可点击
- 「其它」为 inline 展开文本输入框
- 动画前进左滑（100%→0）、后退右滑（0→-100%）
- 纯 CSS transition，不引入外部动画库

### R3: Agent 澄清规则注入（Clarification Rules）

**目标**：在 system prompt 中注入分轮澄清规则，让 LLM 在信息不足时主动分轮提问。

**验收标准**：
- [ ] `agentPromptBuilder.ts` 中新增「Clarification Rules」段落（放在写入规则之前）
- [ ] 分轮策略模板（注入 prompt，LLM 自主决策）：
  - 创建文档缺位置/文件名 → 第 1 轮问文件名，第 2 轮问存放位置（列文件树根文件夹 choice）
  - 修改文档缺目标 → 第 1 轮列最近编辑 5 文件（choice + 其它），第 2 轮问修改方向（润色/精简/扩写/结构调整/自定义）
  - 删除文档缺目标 → 第 1 轮列候选文件（choice + 其它），第 2 轮二次确认（confirm）
  - 模糊需求（风格/格式等）→ 第 1 轮问目标风格（正式/轻松/学术/创意/自定义）
- [ ] `ask_question_card` 工具新增可选参数 `round`（number，默认 1）和 `totalRounds`（number，可选），向后兼容
- [ ] 渲染侧根据 round/totalRounds 在标题显示「第 X 轮提问」或「追问（X/Y）」
- [ ] 每轮最多 2 个问题（prompt 层面约束，schema maxItems 保持 5）
- [ ] `round`/`totalRounds` 由代码层自动填充（Agent loop 上下文推断）

**对齐决策（Q3）**：
- 分轮由 LLM 自主决策（符合 Agent 设计哲学）
- Clarification Rules 放在写入规则之前
- `round`/`totalRounds` 代码层自动填充

### R4: 知识库澄清与 KB 查询联动

**目标**：统一 `knowledgeClarify.ts` 和 `ask_question_card` 两套澄清路径，复用 Agent 的向导模式。

**验收标准**：
- [ ] KB 搜索检测到歧义后，`knowledgeClarify.ts` 生成的 IClarifyQuestion 数组注入 Agent 上下文
- [ ] LLM 决策是否调用 `ask_question_card`（复用 Agent 通道 + pause/resume）
- [ ] 分轮策略：第 1 轮核心歧义（指代消解）、第 2 轮范围细化（概念/步骤/细节/最佳实践）
- [ ] KB 场景同样支持 round/totalRounds 参数
- [ ] `needsClarification` 钩子接入 KB 搜索链路（`searchKBHandler`）

**对齐决策（Q4）**：
- 复用 Agent 的 `ask_question_card` 通道，不另建 IPC

### R5: Delete 操作强制确认

**目标**：`deleteLocalFile` / `deleteFile` 在任何 writeMode 下强制走用户确认，不依赖 LLM 自觉。

**验收标准**：
- [ ] 新增 `FORCE_CONFIRM_TOOLS` 集合（`agentToolSelector.ts`），包含 `deleteFile` / `deleteLocalFile`
- [ ] `agentLoop.ts` 执行前检查工具名 ∈ `FORCE_CONFIRM_TOOLS` → 强制走 confirm 流程
- [ ] 确认内容：① 列出文件名和路径 ② 「删除不可恢复」警告 ③ 「确认删除」/「取消」
- [ ] 确认卡片复用 QuestionCard confirm 类型，增加红色警告图标 + 「不可恢复」文案
- [ ] 用户拒绝后，Agent loop abort 当前 tool call，不继续下一轮
- [ ] Prompt 层同步更新：`agentPromptBuilder.ts` 删除提示必须「先说明变更 → 等待确认」

**对齐决策（Q2/Q9）**：
- 双层防线：`agentToolSelector` 分类 + `agentLoop` 硬编码拦截
- 复用 QuestionCard confirm 类型（非弹窗），增加红色警告

### R6: DiffSummaryCard 与写控制集成

**目标**：DiffSummaryCard 对接 rewriteStore 和 agentStore 的 proposal 状态管理。

**验收标准**：
- [ ] DiffSummaryCard 内部判断数据来源（rewriteStore vs agentStore），用 union type 区分
- [ ] 对接 `rewriteStore`：pendingRewrite / applyRewrite / clearRewrite / contentHash staleness
- [ ] 对接 `agentStore`：editBlocksProposals / patchProposals 的 apply/discard/clear
- [ ] 应用/废弃操作正确更新 proposal status（pending → applied/discarded）
- [ ] 超长文件列表（> 50 个）提供截断 + 「显示全部」

### R7: 技术文档索引（支撑任务）✅

- [x] react 49p / tailwindcss 99p / zustand 71p — docs-mcp-server 索引完成
- [x] fastcrw 设计资料抓取完成（Wizard/Stepper 模式、Diff 卡片 UI）
- [x] grill-me / grilling skill 已加载

---

## 已对齐问题清单

| # | 问题 | 决议 |
|---|------|------|
| Q1 | 旧卡片与 DiffSummaryCard 关系 | 保留文件名，别名重导出，内部 import |
| Q2 | Delete 确认实现深度 | 双层防线：分类 + 硬编码拦截 |
| Q3 | 分轮澄清执行者 | LLM 自主决策 + 代码层自动填充 round/totalRounds |
| Q4 | KB 澄清触发链路 | 复用 Agent ask_question_card 通道 |
| Q5 | 截断策略 | 展开态统一 200 行 + 「显示全部」 |
| Q6 | 单文件「查看详情」 | 不显示，Modal 仅多文件 |
| Q7 | 三旧卡片废弃策略 | 保留文件名，别名重导出 |
| Q8 | 向导动画方案 | 纯 CSS transition |
| Q9 | Delete 确认表现形式 | 复用 QuestionCard confirm + 红色警告 |
| Q10 | 实现顺序 | Delete+DiffCard → 集成 → QCard+澄清 → RAG-KB |

## 变更文件清单

| 操作 | 文件 | 关联需求 |
|------|------|----------|
| 新建 | `src/render/components/AIAgent/cards/DiffSummaryCard.tsx` | R1, R6 |
| 修改 | `src/render/components/AIAgent/cards/RewritePreviewCard.tsx` | R1（改为别名重导出） |
| 修改 | `src/render/components/AIAgent/cards/EditBlocksPreviewCard.tsx` | R1（改为别名重导出） |
| 修改 | `src/render/components/AIAgent/cards/PatchPreviewCard.tsx` | R1（改为别名重导出） |
| 修改 | `src/render/components/AIAgent/cards/QuestionCard.tsx` | R2 |
| 修改 | `src/main/ai/tools/askQuestionCard.ts` | R3（新增 round/totalRounds） |
| 修改 | `src/main/ai/agent/agentPromptBuilder.ts` | R3, R5（注入 Clarification Rules + 删除提示） |
| 修改 | `src/main/ai/agent/agentToolSelector.ts` | R5（新增 FORCE_CONFIRM_TOOLS） |
| 修改 | `src/main/ai/agent/agentLoop.ts` | R5（硬编码 delete 拦截） |
| 修改 | `src/main/ai/knowledge/knowledgeClarify.ts` | R4（接入 ask_question_card 通道） |
| 修改 | `src/main/ai/tools/searchKBHandler.ts` | R4（needsClarification 钩子） |
| 修改 | `src/render/styles/globals.css` | R2（新增 shake/slide 动画） |
| 不改 | RewriteDetailModal / EditBlocksDetailModal / PatchDetailModal | 保持现状 |

## 风险登记

| 风险 | 等级 | 缓解 |
|------|------|------|
| DiffSummaryCard 对接双 store 类型复杂 | 中 | union type + 充分类型守卫 |
| Delete 硬编码拦截影响 Agent 自主性 | 低 | 仅拦截 delete 类工具，其他 write 工具不受影响 |
| 向导模式改动面大（QuestionCard 重写） | 中 | 保留现有 props 接口，内部重构 |
| KB 澄清链路改造涉及主进程 IPC | 中 | 最小侵入：仅在 searchKBHandler 加钩子 |