---
name: ai-prompt-prefix-stability
description: S7 Prompt prefix stability engineering — tool alphabetization, system prompt layering, dynamic context to system-reminder
metadata:
  type: reference
---

# S7 Prompt 前缀稳定性工程 — 关键实现模式

## 数据流：前缀缓存层级

```
[system] 静态 Agent 角色/规则（会话内不变）→ 缓存命中
[system] "=== 当前用户问题 ==="
[user]   <system-reminder>文件列表+文档上下文</system-reminder> + 用户消息
[system] "【重要】请只回答上面的用户问题..."
```

**Why:** 任何前缀变更使后续所有缓存失效。动态内容（文件列表/文档）原来在 system 消息首位，每次文件编辑导致全量缓存 miss。

**How to apply:** 新增/修改上下文内容时，判断是否动态（会话内可变）。动态 → `<system-reminder>` 注入 user message；静态 → system prompt。

## 涉及文件

- `src/main/ai/toolRegistry.ts` — `defineCoreTools()` 改为返回字母序副本 `[...CORE_TOOLS].sort((a,b) => a.function.name.localeCompare(...))`
- `src/main/ai/agent/agentPromptBuilder.ts` — `buildAgentSystemPrompt(needsClarification?: boolean)` 移除 `fileListSnapshot`/`localFileTreeSnapshot` 参数；新增 `buildSystemReminder(fileListSnapshot, localFileTreeSnapshot, documentContext)`
- `src/main/ai/agent/agentContext.ts` — 调用处改为 `buildAgentSystemPrompt(needsClarification)` + `buildSystemReminder(...)` 注入 user message
- `tests/main/ai/toolRegistry.test.ts` — 字母序断言更新
- `tests/main/ai/agentLoop.test.ts` — A1a 测试改为检查 user message 中的 `<system-reminder>` 块

## 测试覆盖

- toolRegistry: 24 工具字母序断言
- agentLoop: A1a 文档注入从 system 消息迁移到 user `<system-reminder>` 的回归测试
- concurrencyDefs: defineCoreTools 遍历兼容性（无顺序断言）

## 既有问题（非本次引入）

- `tests/main/ai/ipc.test.ts` 12/32 失败（pre-existing，原始代码同样失败）