---
name: ai-redesign-m3-ui
description: 三视图重构的组件布局、handleSendAgent 归宿、i18n tab 键冲突、SettingsModal ai 测试迁移、vitest setup 缺 listModels
metadata:
  type: project
---

AI 面板三视图重构（M3）实现关键落点：

- **视图归属**：`view` 状态放 `AIAgentPanel` 内部 `useState<View>`（home/session/settings），无需 store。home 用 `AIPanelHome`，session 用 `AIPanelSession`，settings 用 `AIPanelSettings`。
- **handleSendAgent 归宿**：分流逻辑（选区改写/SLASH_SKILL/@文档/@知识库/@描述/整篇写/纯 agent）只存在于共享 `AIPanelComposer`，**不再在 AgentTab 内重复**。AgentTab 精瘦为纯消息流 body（RewritePreviewCard/ToolCallTrace/IntentCard/AIMessageBubble/流式/previewWrite）。
- **模式下拉现在在 composer**（不是面板头部）：`ai-mode-select` testid 仍保留，home/session 视图 composer 均渲染 → E2E `switchMode(page,'agent')` 仍可用，但旧 E2E 里「头部模式下拉 + 会话 pill 列表/KB 控件内联在 body」的断言全失效，需按新结构改写。
- **i18n tab 键冲突**：模块文档写 `ai.settings.model/skills/mcp`，但 `ai.settings.model` 已被「模型 ID」字段占用 → 改用 `ai.settings.tab.model/skills/mcp` 当设置 tab 标签，避免覆盖既有关键。
- **测试基建**：`tests/setup.ts` 的 `window.weaveMD.ai` mock 需含 `listModels`（M3 已补）。组件测试要在 beforeEach 自己 cover `ai.listModels`/`ai.listSkills`，否则静默空/undefined。
- **SettingsModal ai Tab 移除**：原 `tests/render/components/Settings/SettingsModal.ai.test.tsx` 随 Tab 删除；其断言迁往 `tests/render/components/AIAgent/settings/ModelForm.test.tsx`（load config/consent + save remote 不落 key）。
- **chat 空会话 toolCalls 也可显示**：AgentTab 的工具轨迹块需在 `messages.length===0` 时仍渲染（移出空态分支）。

进度: [[ai-redesign-m2-stores]]。待办: Playwright E2E 三视图改写（orchestrator 阶段 6~8）。
