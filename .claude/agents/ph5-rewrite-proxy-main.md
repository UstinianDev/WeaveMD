# ph5-rewrite-proxy-main

> 第 5 期批次 2（B 主进程薄代理）：rewrite.ts + ipc 注册。依赖批次 1 类型已落地（RewriteRequestPayload/RewriteReply）。

- 职责：新建 `src/main/ai/rewrite.ts`（`runRewrite`：consent 'chat' 闸 → `buildRewriteMessages(payload)` → `llmRewrite`（streamChatCompletion 纯对话无 tools，累加 delta）→ `RewriteReply{text}` 原样返回）；`src/main/ai/ipc.ts` 注册 `AI_REWRITE_PREVIEW` + `needsConsent(...,'chat')` 闸 + 错误规范化；测试 `tests/main/ai/rewrite.test.ts`（新）+ `tests/main/ai/ipc.test.ts`（改）。
- **架构铁律（C2）**：主进程**零 markdown 解析、零 proposal 计算**——不 import 渲染内核（markdownToState/stateToMarkdown/blockTree），LLM 文本原样返回渲染侧计算 proposal。
- **铁律一**：runRewrite 只产 LLM 文本，绝不写文件/编辑器/DB。**铁律二**：改写前 `needsConsent(config,consent,'chat')`（allowNetwork），未授权返 `consent_required` 不发外发请求。
- 载荷：selection → messages=[{system 改写指令模板},{user selectionMarkdown}]；document → messages=[{system 指令+「输出 JSON 数组 [{block_index,new_content}]」},{user JSON(numberedBlocks)}]。
- TDD strict：测试先行；沿用 vi.mock llmClient（hoisted）+ FakeDatabase + electron mock 模式（见 tests/main/ai/agentLoop.test.ts / ipc.test.ts）。
- 完成后自检：typecheck + 本批 vitest 全绿。
- 返回结构化摘要 `{完成项, 测试证据, 未完成项, 风险}`。
