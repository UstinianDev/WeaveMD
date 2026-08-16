---
name: ph7-consent-reply-path
description: 第7期 A1c previewDocumentFromReply 本地写路径无需 consent，与 AGENT_RUN 的网络闸分离
metadata:
  type: feedback
---

第 7 期 A1c 新增的 `previewDocumentFromReply`（Agent 回复 → 预览写入文档）**不调用** `needsConsent`，这是合规的，原因：该路径只做本地 transform（当前 content + 已生成的 reply 文本 → proposal），不发起任何网络调用；网络/LLM 调用发生在前置的 `AGENT_RUN`（自身已有 consent 'chat' 闸）。

**Why:** 铁律二（联网/笔记外发必知情同意）闸的是「网络/外发」，而不是「本地预览」。reply 文本生成时网络调用已发生并已过闸，复用之再弹同意页会造成重复打扰。

**How to apply:** 第 7 期之后的改写路径评审中，判断「是否需要 consent 闸」应看该路径是否触发网络/LLM 调用——纯本地 proposal 构造（selectionContext 记录、previewDocumentFromReply、proposeFullDocumentRewrite 等）不需要；调用 `rewritePreview` IPC（runSelectionRewrite/startDocumentRewrite/runFullDocumentRewrite）都需要 `needsConsent(config,consent,'chat')`。见 [[feedback-consent-doublesource]]。
