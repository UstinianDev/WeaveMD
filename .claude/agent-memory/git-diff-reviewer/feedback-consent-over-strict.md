---
name: consent-over-strict-remote
description: agent remote 后端 needsConsent 要求 allowSend 过严——纯工具/聊天也被当作 KB 外发
metadata:
  type: feedback
---

主进程 `consent.ts` `needsConsent('agent')` 对 remote 后端无条件要求 `allowSend`，无论本轮是否真做 KB 检索。计划 §4.9 原文语义为"allowNetwork 用于联网外发；allowSend **仅用于 KB 检索外发**；ollama 本地 agent 不要求 allowSend"。

**Why:** 设计意图是分层授权（联网 vs 笔记外发），但实现把两者捆绑：用户只授权联网、做纯 agent 任务（不碰知识库）也被要求 allowSend，导致误拦截。方向安全但过度收紧。

**How to apply:** 判断这类"服务端过度收紧"的改动需先确认是安全默认（可接受）还是违背计划语义（需标注）。搭配 [[consent-doublesource-divergence]] 看——主端过严与渲染端过松并存，属同一 consent 语义未对齐问题。
