---
name: ai-redesign-m2-stores
description: AI 面板重设计 M2 模块 store 改动点（首条 title/R16 dismiss/面板加宽）+ 两处易踩坑
metadata:
  type: project
---

AI 面板重设计（R16/R20/R21 + 面板加宽）M2 模块已交付。关键改动落点与易踩坑：

- **R20 首条消息写 summary**：`agentStore.sendMessage` 与 `sendAgentMessage` 建会话成功分支后追加
  `trimmed.slice(0,50)` 写 `updateConversationSummary`，再 `loadConversations(activeMode)`。
- **uiStore `aiPanelWidth` 默认 480**：l`oadSettings` 兜底用 `aiPanelWidth || 480`——注意
  `loadSettings` 只在 localStorage 有 `weavemd_ui` 且含该字段时才覆盖；测试须先写入旧格式
  localStorage 再断言兜底，不能只 clear。
- **`sendMessage`/`sendAgentMessage` 不会自动把 `activeMode` 放进作用域**：两函数顶部
  destructure `get()` 时不含它。追加 `activeMode` 引用前必须在 destructure 里补
  `activeMode`，否则 `ReferenceError: activeMode is not defined`。

**Why:** M1/M2 并行 split，M2 只动渲染侧 store/组件；`activeMode` 未解构是本模块实现时真实踩到的运行时错误。
**How to apply:** 改这两个 store 建会话分支时，destructure 行必须同步补 `activeMode`。

测试位置分叉（vitest include 全星覆盖）：`agentStore/rewriteStore` 测试在 `tests/render/stores/`，
`uiStore` 测试在 `tests/stores/`——模块定义写 `tests/stores/*`，实际按文件分散两目录。
关注 [[ph5-batch4-d-preview-store]] 的 rewriteStore 错误码约定。
