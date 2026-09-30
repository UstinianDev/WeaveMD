---
name: agent-memory-optimize-2-c4-done
description: 第二批 C4 场景③「压缩触发后指代仍成立」E2E 已交付（纯新增 198 行、连跑 3 次绿、整文件 4 failed 与 B 类基线一致），未提交
metadata:
  type: project
---

C4（指代三场景 E2E 的场景③）2026-09-30 交付完成，**未 git add/commit**，全量五门禁归总指挥（Gate C）。

- 交付：`e2e/ai-agent-panel.spec.ts` 纯新增 198 行 / 0 删除（既有 37 条用例一行未改），用例 37→38。
- **两段式写法**（renderer-only E2E 无法执行主进程压缩）：Node 段在 playwright 进程内 import
  `src/main/ai/contextManager` + `agent/agentHelpers` 跑真实 `shouldCompress`/`buildCompressed`，
  靠注入 74 条大历史跨过 shipped 阈值（0.85×64000、KEEP_RECENT_ROUNDS=3 全程零改动）；
  渲染段用新 mock 选项 `seedConversation`（id/summary/messages）注入 + `window.__weaveMdAgentPayloads`
  记录 runAgent 上送口径。
- 断言落在：阈值自检（0.85/0.65/64000/3）、压缩产物形态、RECENT+会话标题=摘要、大历史窗口折叠、
  同 conversationId、工具参数 `查询: "..."` 原样、无反问正则、无 question-card、无 pageerror。
- 证据：RED（mock 无 seedConversation → `home-recent-item` element(s) not found）→ GREEN；连跑 3 次全绿；
  整文件 `4 failed / 34 passed`，4 条失败 = 既知 B 类选区改写（行号较基线统一 +53：1071/1218/1265/1693）。

**Why:** 场景③最容易被写成「调低阈值」或「断言 mock 自己的回复」，两者都被总指挥明令禁止。
**How to apply:** 后续要给 E2E 加主进程行为断言，复用这套两段式（见 [[weavemd-test-env-pitfalls]] 第 6 条）。
