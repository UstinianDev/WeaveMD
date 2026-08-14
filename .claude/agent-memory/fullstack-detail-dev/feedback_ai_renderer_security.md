---
name: feedback-ai-renderer-security
description: AI renderer 的 markdown 气泡必须以纯文本安全渲染，禁止 dangerouslySetInnerHTML；并行 M1 类型耦合变化
metadata:
  type: feedback
---

在 AI 面板渲染侧（agentStore.ts + components/AIAgent/*），assistant 消息以**纯文本**（whitespace-pre-wrap）渲染，不要用 `dangerouslySetInnerHTML`，也不要引入 rehype-react 等 React 渲染器（项目未装该依赖，且编辑主区自身虽用了 dangerouslySetInnerHTML，但 AI 渲染遵守 CONVENTIONS/SECURITY 的硬性规则）。

**Why:** SECURITY.md 明确「禁止 dangerouslySetInnerHTML —— 使用 unified/remark 安全渲染」。现有 `renderMarkdownToHtml` 会 `allowDangerousHtml: true`，直接 innerHTML 注入会重新引入 XSS。项目没有 `rehype-react`/`react-markdown` 依赖，无法低成本做 React 安全渲染。为守安全底线，Chat 占位阶段改用纯文本；富文本/代码高亮延到第 4 期引入安全 React 渲染器。

**How to apply:** 新增任何 AI 消息渲染时，先确认无 dangerouslySetInnerHTML；若需 markdown 富文本，先加 rehype-react 依赖并用统一管线转 React 元素，不要用 HTML-string innerHTML。

另：**并行智能体 M1 已把 `ai` 加进 `WeaveMDApi`（src/main/preload.ts:79）并实现了 shared/ai.ts**。它改了 `WeaveMDApi` 类型导致 `src/render/utils/weaveMDBridge.ts` 的 `createNoopWeaveMDApi` 必须补 `ai` noop 才能过 typecheck（我已补）。同时 `window.weaveMD.ai` 现在有真实类型，store/组件测试里对 `onStream` 的 mock（`mockImplementation`）会被 TS 收窄为 never——用 `(window.weaveMD.ai.onStream as unknown as { mockImplementation: (fn:(...a:unknown[])=>unknown)=>void }).mockImplementation((cb: unknown)=>{...})` 加显式 `unknown`/cast 规避。相关 [[feedback-dependent-on-parallel-ai-m1]]。
