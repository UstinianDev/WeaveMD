# ai-panel-ux-optimize — 需求文档

> 2026-08-16 | 两轮 grill-me 已对齐（AskUserQuestion）
> 任务 = AI 面板与改写体验综合优化（5 项功能 + 1 项另开任务）

## 目标

优化 AI 面板与 AI 改写体验，消除使用困惑：

1. **① 改写高亮**：编辑器选区点「AI 改写」→ 选区覆盖的所有块**整块渐变蓝高亮**（左浅右深），高亮最左端渐变胶囊「取消」（始终可见），点击=清高亮+重置改写。
2. **② 草稿**：composer 输入跨视图切换（会话↔设置↔主界面）保留；切会话/新建/发送/关面板清空。
3. **③ 完全去除 ollama 支持**：UI + 主进程（chat/agent/embedding/KB）ollama 路径全部删除，后端固定远程 API、必须填 key。
4. **④ 当前提供商状态 + 断开**：API key 与允许联网之间显示当前实时后端（如「已连接：DeepSeek API」），可「断开连接」=清除已存 key + 置为断开。
5. **⑤ 字体放大**：AI 模块整体放大一档。
6. **表格渲染**：可编辑表格块 → **另开独立任务**，本次不实现。

## 已对齐决策（两轮）

**第一轮（高亮 + 草稿）**

| 决策点 | 结论 |
| --- | --- |
| 高亮范围 | 选区覆盖的所有块整块亮（任何块类型一视同仁） |
| 取消语义 | 取消 = 清除高亮 + 重置改写状态（pendingRewrite/rewriteError/stale 清空） |
| 取消按钮形态 | 高亮最左端悬浮渐变胶囊，始终可见（非悬停） |
| 草稿保存 | 视图切换保留；切会话/新建/发送/关面板清空 |

**第二轮（补充）**

| 决策点 | 结论 |
| --- | --- |
| ollama 去除范围 | **完全去除**（UI + 主进程 chat/agent/embedding/KB 全删；后端固定远程，必须填 key） |
| 当前提供商 | 状态显示（实时后端）+ 断开连接 = 清除已存 key + 置断开 |
| 表格渲染 | **可编辑表格块，另开独立任务**（本次不实现） |
| 字体 | 整体放大一档 |

## 现有实现基线（复用点）

- **A3 选区持久高亮**（第 7 期）：`src/render/editor/rewrite/highlight.ts` `buildHighlightRanges(content, SelectionRef)` → 叶级区间 `{leafIndex,start,end}`；`.rewrite-highlight` 纯 CSS overlay（`globals.css` ~2459，`pointer-events:none`、z-60）；`EditorV2.tsx` 读 rewriteStore.selectionContext 渲染。**当前是选中区间**，需改整块 `[0,叶长]`；渐变蓝 + 左端胶囊需 `pointer-events:auto`。
- **rewriteStore**：`selectionContext`（驱动高亮）、`pendingRewrite`/`rewriteError`/`staleRejected`、`clearRewrite()`（清全部，含 selectionContext → 即清高亮）、M2 `dismissRewriteBanner()`（仅清 stale/error）。
- **composer 草稿丢根因**：`AIPanelComposer.tsx` 的 `input` 是组件本地 `useState('')`；`AIAgentPanel.tsx` 切 view 即 unmount composer → 丢失。修复=草稿提升到 AIAgentPanel state，composer 受控。
- **ollama 相关代码面**（完全去除需覆盖）：`src/shared/ai.ts` `ChatBackend = 'ollama' | 'remote'`、`AiHealth`、`IAIConfig`；`src/main/ai/llmClient.ts`（ollama 调用分支 + `probeOllama`）；`ipc.ts`（AI_HEALTH ollama 探针）；`agentLoop.ts`（ollama 降级纯 chat 分支）；`embeddingClient.ts` + `kbIndexer.ts`/`kbSearch.ts`（本地向量化）；`rewrite.ts`（consent ollama 分支）；`consent.ts`（ollama 不需同意逻辑）；`src/main/db/ai.ts` config 字段；`settings/ModelForm.tsx`（后端选择 ollama 选项 + ollama 地址字段）；i18n `ai.settings.backend.ollama` 等；相关测试。
- **ModelForm**（迁自 SettingsModal）：后端选择 / 地址 / 模型 / API key（hasApiKey）/ 同意开关 / KB 参数。④ 的「当前提供商 + 断开」插在 API key 与允许联网之间。

## 需求清单

### ① AI 改写渐变整块高亮 + 取消

- **A1** 整块高亮：`buildHighlightRanges` 产出整块范围（每叶 `start:0, end:叶长`）；选区覆盖的所有块整块亮；跨块各块均整块；失同步/越界保守跳过保留。
- **A2** 渐变蓝：高亮背景 `linear-gradient(90deg, 左浅, 右深)`（如 `rgba(59,130,246,0.16) → rgba(37,99,235,0.45)`），明暗主题可见；保留圆角/outline。
- **A3** 取消胶囊：高亮最左端（首个高亮块左缘）悬浮渐变蓝胶囊「取消」，始终可见；点击 = 清高亮 + 重置改写（`clearRewrite()` 或等价）。胶囊 `pointer-events:auto`，高亮区本体 `pointer-events:none`。
- **A4** 生命周期：点「AI 改写」出现 → 保持至「取消」或「应用/确认」或新选区改写；应用/确认后清除。纯 CSS overlay 不入 contentEditable、不改块文本（文本输出不变式）。
- **A5** 范围：仅选区触发改写（selection scope）；document scope 无高亮。
- **A6** 更新 `highlight.ts` 相关单测断言（整块 vs 选中区间）。

### ② composer 草稿跨视图保存

- **B1** Bug：composer 输入 → ⚙ 设置 → 返回会话 → 输入丢失（view 切换 unmount composer）。
- **B2** 预期：草稿在面板内视图切换（会话↔设置↔主界面）间保留。
- **B3** 清空：切会话（loadConversation）/新建（newChat）/发送成功/关面板重开。
- **B4** 实现：草稿提升到 AIAgentPanel state，composer 受控；home/session 共享同一草稿；newChat/loadConversation 时重置。
- **B5** 兼容：发送分流/补全/停止行为不变。

### ③ 完全去除 ollama 支持

- **C1** 共享类型：`ChatBackend` 收敛（去掉 'ollama' 或直接移除，统一 remote）；`IAIConfig`/`AiHealth` 相应精简。
- **C2** 主进程：`llmClient.ts` 去掉 ollama 调用分支与 `probeOllama`；`ipc.ts` AI_HEALTH 改纯 remote 检查（或移除）；`agentLoop.ts` 去掉 ollama 降级分支；`rewrite.ts`/`consent.ts` 去掉 ollama 不需同意逻辑。
- **C3** embedding/KB：`embeddingClient.ts`/`kbIndexer.ts`/`kbSearch.ts` 去掉本地 ollama 向量路径；KB 向量化需远程 embedding 或降级仅 FTS5；`ModelForm` 中 embedding host/model 字段相应调整。
- **C4** UI：`ModelForm` 去掉后端选择 ollama 选项 + ollama 地址字段；后端固定「远程 API」；清理 i18n `ai.settings.backend.ollama`/`ollamaBaseUrl` 等键。
- **C5** 测试：更新 `llmClient/ipc/agentLoop/embeddingClient/kb*` 涉及 ollama 分支的测试（改为纯 remote 断言）。
- **C6** 明确后果：去除后「不填 key 也能用」失效，必须填远程 key（已与用户确认）。

### ④ 当前提供商状态 + 断开

- **D1** UI：`ModelForm` API key 与允许联网之间插入「当前提供商」状态行：显示当前后端（「已连接：DeepSeek API / 未配置」）+「断开连接」按钮。
- **D2** 断开：清除已存 API key（`setConfig({ apiKey: '' })`）+ 标记断开；断开后 AI 不可用，需重新填 key。
- **D3** 实时：面板初始化/进入设置时读 `getConfig` 显示；断开后状态即时更新。
- **D4** 无 key 提示：状态显示「未配置 API key，AI 不可用」，消除「没填 key 却能用的困惑」。

### ⑤ AI 模块字体整体放大一档

- **E1** 面板内消息正文 14→15、控件/标题 12→13 等整体放大一档；i18n 文案不变；明暗主题可读。

## 验收标准

- **①**：选中部分→「AI 改写」→ 覆盖块整段渐变蓝（左浅右深），跨块各块均整块；左端胶囊「取消」始终可见；点击后高亮消失且改写状态重置；应用/确认后高亮消失；高亮不写入文档文本（往返不变式）。
- **②**：composer 输入后切 ⚙ 设置再返回输入仍在；切会话/新建清空；发送后清空；关面板重开清空。
- **③**：UI 无 ollama 选项/字段；主进程无 ollama 分支；后端固定远程；不填 key 时 AI 明确提示不可用。
- **④**：设置中显示当前提供商状态；点断开清 key 后 AI 不可用、状态更新；重填 key 恢复。
- **⑤**：AI 面板字号整体放大一档，明暗主题正常。
- **门禁**：`tsc 0` + `vitest 全绿` + `lint 0` + `vite build` + `Playwright 全绿`（新增：整块高亮+取消、草稿跨视图、provider 状态+断开、无 ollama 回归用例）。

## 范围外 / 另开任务

- **可编辑表格块**：v2 内核新增 table 块类型（单元格编辑、增删行列）——**另开独立任务**，建议 slug `editor-table-block`。
- 文档整篇改写（document scope）高亮。
- 草稿持久化到磁盘 / 多会话草稿。
- ollama 保留回退（本任务完全去除）。
