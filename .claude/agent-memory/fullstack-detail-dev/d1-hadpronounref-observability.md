---
name: d1-hadpronounref-observability
description: agent-memory-optimize-3 D1（指代触发率接入 diagnostics）交付状态与两个非显而易见的坑：content 形状条件分支、agentTaskWorker 闭包丢弃 opts
metadata:
  type: project
---

D1（二.3 `hadPronounRef` 指代触发率接入 diagnostics）已于 2026-09-30 在本仓实现完毕（未提交），改动面只有 6 个文件：`kbSearch.ts` / `toolTypes.ts` / `searchKBHandler.ts` + 两个同名 test + `docs/modules/11-AI代理面板-Agent.md`。

**Why:** 这是第三批 Gate D 的 S 档任务，落点是既有 sink（`ai_messages.content` / `agent_run_events.payload_json`），不建表。

**How to apply:** 后续若有人要动 searchKB 的工具返回体或继续接 `researchLoop` 字段，先看下面两个坑：

1. **`searchKB` 成功分支的 content 原本是裸 JSON 数组**（`toolRegistry.test.ts` 里有 `parsed[0].fileName` 断言依赖它）。D1 采用「条件挂载」：`res.diagnostics` 存在才包成 `{results, diagnostics}`，不存在时保持裸数组 —— 因此**零既有断言改动**。若将来要改成恒定对象形状，必须同步改 `tests/main/ai/toolRegistry.test.ts:149`（计划 §2 把这条错登记成了 `searchKBHandler.test.ts`）。
2. **`agentTaskWorker.ts` 的 `searchKb` 闭包会重建 opts，丢掉未显式列出的字段** → `opts.hadPronounRef` 到不了 `kbSearch`，kbSearch 层恒记 `false`。D1 用 `searchKBHandler.withPronounFlag` 按本次 `resolved` 归一，保证 sink 数值正确；但 `console.debug` 里的值仍不准。要修就在该闭包加一行 `hadPronounRef: opts?.hadPronounRef`（该文件归 D2 所有权，并行期勿动）。
3. `IKbDiagnostics.researchLoop` 字段至今**仍仅声明未赋值**（`researchLoop()` 在 `knowledgeContext.ts`，不产出 `IKbDiagnostics`）——文档里不能写「已接线」。
