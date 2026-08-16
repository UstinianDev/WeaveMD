# ai-rewrite-highlight-draft — 需求文档

> 2026-08-16 | 需求已通过 grill-me 对齐（AskUserQuestion 确认 4 项决策）
> 任务 = AI 改写优化（①渐变整块高亮 + 取消按钮；②composer 草稿跨视图保存）

## 目标

优化 AI 改写体验与面板输入保持：
1. **① 高亮**：编辑器选区点「AI 改写」后，对**选区覆盖的所有块**做**整块渐变蓝高亮**（左浅右深），高亮最左端有一个渐变胶囊「取消」按钮（始终可见），点击即去掉高亮并重置本次改写。
2. **② 草稿**：修复 composer 输入在视图切换（会话↔设置↔主界面）间丢失的问题——草稿跨视图保留，切换会话/新建会话/面板重开才清空。

## 已对齐决策（grill-me 结论）

| 决策点 | 结论 |
| --- | --- |
| 高亮范围 | **选区覆盖的所有块整块亮**（正文/标题/列表/引用/代码块一视同仁，跨块不碎片） |
| 取消语义 | 取消 = **清除高亮 + 重置改写状态**（pendingRewrite/rewriteError/stale 一并清，等同退出本次改写） |
| 取消按钮形态 | **高亮最左端悬浮胶囊，始终可见**（非悬停显示），渐变蓝底 + 「取消」 |
| 草稿保存 | **视图切换保留；切换会话/新建会话清空；面板关闭重开清空** |

## 现有实现基线（复用点）

- **A3 选区持久高亮**（第 7 期已交付）：
  - `src/render/editor/rewrite/highlight.ts`：`buildHighlightRanges(content, SelectionRef)` 把选区映射为**叶级区间** `{leafIndex, start, end}`（目前是选中区间，跨叶首尾裁剪）。
  - `.rewrite-highlight` 纯 CSS overlay（`globals.css` ~2459）：`background: color-mix(accent 16%, transparent)` + accent outline；`pointer-events:none` 不拦编辑器；`z-index:60`。
  - 渲染：`EditorV2.tsx` 读 `selectionContext`（rewriteStore）→ `buildHighlightRanges` → 渲染每叶 overlay。
- **rewriteStore**：`selectionContext`（驱动高亮）、`pendingRewrite`/`rewriteError`/`staleRejected`（改写状态）、`clearRewrite()`（重置全部）、M2 新增 `dismissRewriteBanner()`（仅清 stale/error）。「取消=重置改写」应走 `clearRewrite()`（清 selectionContext 即清高亮）。
- **composer 草稿丢的根因**：`AIPanelComposer.tsx` 的 `input` 是组件本地 `useState('')`；`AIAgentPanel.tsx` 的 `view` 切换（home/session/settings）会 **unmount composer**，本地 state 随之丢失。

## 需求清单

### ① AI 改写渐变整块高亮 + 取消

- **A1** 整块高亮：`buildHighlightRanges` 改为产出**整块范围**（每叶 `start:0, end:叶长`），即选中任意部分 → 选区覆盖的每个块整块亮。跨块 = 各块均整块。失同步/越界保守跳过逻辑保留。
- **A2** 渐变蓝：新增/改造 CSS——高亮背景为**渐变蓝，左中浅、右深**（如 `linear-gradient(90deg, rgba(59,130,246,0.16), rgba(37,99,235,0.45))`），兼顾暗色主题可见性；保留圆角与 outline 层次。
- **A3** 取消胶囊：在**高亮最左端**（首个高亮块左缘）悬浮一个渐变蓝底小胶囊「取消」按钮，**始终可见**；点击 = 清除高亮 + 重置改写状态（调用 `clearRewrite` 或等价动作）。胶囊需 `pointer-events:auto`（高亮区本体保持 `pointer-events:none`）。
- **A4** 生命周期：点「AI 改写」出现 → 保持至「取消」或「应用/确认」或新选区改写；应用/确认后清除。高亮仍为纯 CSS overlay，**不入 contentEditable、不改块文本**（保持文本输出不变式铁律）。
- **A5** 适用范围：仅选区触发改写（selection scope）。文档整篇改写（document scope）无选区高亮，不在本次范围。
- **A6** 对齐 A3 现有测试：更新 `highlight.ts` 相关单测断言（整块 vs 选中区间）。

### ② composer 草稿跨视图保存

- **B1** Bug 复现：composer 输入（如 `1+1`）→ 点 ⚙（设置视图）→ 返回会话视图 → 输入丢失。
- **B2** 预期：composer 草稿在面板内**视图切换（会话↔设置↔主界面）间保留**。
- **B3** 清空时机：**切换会话（loadConversation）/ 新建会话（newChat）清空；面板关闭重开清空；发送成功后清空**（现状保留）。
- **B4** 实现方向：草稿**提升**到 `AIAgentPanel`（composer 之上的容器）state，composer 改受控组件；home/session 共享同一草稿；`newChat`/`loadConversation` 时重置草稿。
- **B5** 兼容：发送分流、补全菜单、停止按钮等行为不变；仅 input 值改为受控 + 容器持有。

## 验收标准

- **A**：选中正文部分 → 「AI 改写」→ 该块整段渐变蓝高亮（左浅右深），跨块选区各块均整块亮；高亮最左端胶囊「取消」始终可见；点击后高亮消失且改写状态（预览卡/错误条）一并清空；预览「应用」确认后高亮消失；高亮不写入文档文本（往返不变式保持）。
- **B**：在 composer 输入后切 ⚙ 设置再返回，输入仍在；切到另一会话/新建后清空；发送后清空；面板关闭重开清空。
- **门禁**：`tsc 0` + `vitest 全绿` + `lint 0` + `vite build` + `Playwright 全绿`（新增：渐变整块高亮+取消、草稿跨视图保留用例）。

## 范围外

- 文档整篇改写（document scope）的高亮。
- 高亮渐变色的深度主题定制（仅保证明暗主题可见）。
- 草稿持久化到磁盘 / 跨面板重开保留。
- 会话级多草稿（同一面板同时记多个会话的草稿）。
