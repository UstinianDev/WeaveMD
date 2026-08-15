---
name: consent-doublesource-divergence
description: agent 模式知情同意 needsConsent 主/渲染双源定义不一致（allowSend）——本次核对发现的实质缺陷
metadata:
  type: feedback
---

Agent 模式的知情同意判定在主进程 `src/main/ai/consent.ts` 与渲染侧 `src/render/stores/agentStore.ts` 存在**语义不一致**：

- 主进程 `needsConsent(config, consent, 'agent')`：remote 后端**同时**要求 `allowNetwork` 且 `allowSend`。
- 渲染侧同签名函数：remote 仅要求 `allowNetwork`；`allowSend` 只在该 store 的 `sendAgentMessage` 里当 `useKnowledgeBase===true` 时单独 check。

计划 `ai-agent-panel-ph3-ph4.plan.md` §4.9 明确要求"渲染侧 `agentStore.needsConsent` 同步升级定义（与主进程一致，双源真值）"。二者不一致即违反该要求。

**Why:** 影响实际行为——remote 非 KB 的 agent 纯任务（`useKnowledgeBase=false`）且用户仅授权 `allowNetwork` 未授权 `allowSend` 时，客户端放行、服务端抛 `consent_required`，渲染 try/catch 吞掉并 `finishStream(false)`，用户输入气泡静默消失、无同意弹窗。服务端拦截仍生效（安全方向不变），但属 UX 缺陷。

**How to apply:** 后续核对任何涉及 AI consent 的 diff，优先比对主进程 `consent.ts` 与渲染 `agentStore.needsConsent` 是否逐条一致；这是该项目明确标出的"双源真值"防漂移点。见 [[consent-over-strict-remote]] 关联的过度收紧问题。
