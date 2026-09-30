# 提问卡片系统（§8）

> 拆分自 [11-AI代理面板-Agent.md](../11-AI代理面板-Agent.md)，原 §8 提问卡片系统；2026-10-01 按渐进式披露拆分，正文未改动。
> 返回索引：[11-AI代理面板-Agent.md](../11-AI代理面板-Agent.md)

---

## 8. 提问卡片系统

### 8.1 QuestionCard 向导模式

`QuestionCard`（`cards/QuestionCard.tsx`）实现类 `useReducer` **单题向导状态机**：

- **状态**：`answers`（Record<string, string>）、`currentIndex`、`slideDirection`、
  `shakeTarget`、`showOtherInput`、`otherText`
- **可见性过滤**：支持 `dependsOn` + `condition` 条件依赖，不满足条件的问题自动跳过
- **底部滑入动画**：半透明遮罩层（`z-40`）+ 面板从底部 `translateY` 滑入（`z-50`），
  使用 `requestAnimationFrame` 触发 CSS transition
- **进度圆点指示器**：纯指示器（不可点击），当前题 accent 填充 + ring，已答半透明，
  未答空心边框

### 8.2 选择题 300ms 自动跳转

选择题和确认题选中后 **300ms 自动跳转到下一题**（最后一题不自动跳转），
通过 `useRef<setTimeout>` 管理，切换题目时清除前一个定时器。

### 8.3 未回答提交检测

点击提交时遍历所有可见题，找到第一个未回答的题：
- 跳转到该题（`setCurrentIndex`）
- 设置 `shakeTarget` 触发红色震动 + 边框动画（`question-card-shake` CSS）
- 2 秒后自动清除震动状态

### 8.4 ABCD 选项标签 + 加粗蓝色问题

- **选项标签**：`String.fromCharCode(65 + idx)` 生成 A/B/C/D 圆形标签，
  选中时 accent 填充白色数字
- **题目文本**：`text-[var(--accent)] font-bold`（加粗蓝色），字号 15px
- 选择题提供"其它"按钮，点击后弹出内联文本输入框，自动聚焦

### 8.5 删除确认变体

`variant="delete_confirm"` 触发红色警告样式：
- 标题：红色脉冲圆点 + "此操作不可恢复"
- 确认按钮：`bg-gradient-to-r from-red-500 to-red-600`
- 取消按钮：红色边框透明背景

### 8.6 分轮澄清策略（buildClarificationContext）

`knowledgeClarify.ts` 中的 `buildClarificationContext` 实现分轮策略，
与 Agent 的 `ask_question_card` 工具联动：

| 场景 | 歧义类型 | 问题类型 |
|------|----------|----------|
| 代词指代不清 | `pronoun_reference` | 文本题："你提到的「X」具体指的是什么？" |
| 缺少主语 | `missing_subject` | 文本题："能否提供更多细节？" |
| 范围过广 | `broad_scope` | 选择题："概念解释/操作步骤/技术细节/最佳实践" |
| 太短 | `too_short` | 文本题："请描述更详细一些" |

**分轮策略**：第 1 轮核心歧义消解（文本提问，最多 2 题）→ 第 2 轮范围细化（choice 提问，
最多 2 题）。生成格式化的澄清上下文字符串，注入 `searchKB` 工具的返回结果，
引导 LLM 在下一轮调用 `ask_question_card`。

### 8.7 detectTextQuestions 文本问题检测兜底

`agentLoop.ts` 中的 `detectTextQuestions` 函数作为兜底扫描器：

- 匹配问号（`?` / `？`）
- 匹配提问关键词模式
- 匹配编号问题模式

当 LLM 在文本中直接提问（而非使用 `ask_question_card` 工具调用）时，
系统注入指令强制下一轮使用正确的工具调用形式。仅在有 `ask_question_card` 工具可用时触发。

### 8.8 needsClarification 意图标记

`intentRouter.ts` 在以下条件设置 `needsClarification: true`：

- 置信度 < 0.7
- 输入文本 < 6 字符
- 置信度 < 0.85 且文本 < 10 字符
- chat fallback 时文本 < 10 字符

`agentLoop.ts` 启动时检查 `needsClarification` 标志：即使意图判为 chat，
只要 `needsClarification` 为 true，就使用 Agent 提示词 + 提供
`ask_question_card` 工具，确保模糊输入可以被追问澄清。

---

