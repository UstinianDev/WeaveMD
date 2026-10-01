---
name: multi-intent-skipset-failclosed-done
description: 连通性 §6 fail-closed 补全已交付（03d60b3）；skip 判定语义裁定（tier≠none 与「30 工具零行为变化」冲突时的取舍）与 ab-test flaky
metadata:
  type: project
---

multi-intent 连通性报告 §6（confirmSkipSet 未登记工具绕过矩阵）已修，commit `03d60b3`（main 本地，未推送）。

**语义裁定（本轮自选，未被推翻前视为口径）**：任务文字「tier !== 'none' 即入 skip」与「不得改变现 30 个工具的任何行为 / 保持 inChain 现语义」冲突时，按后者实现——
skip = 已登记 `force` 恒入 ∪ 已登记 `batch` 链态入（inChain 现语义原样）∪ **未登记名恒入**（fail-closed）。
**Why**：全部 7 个 WRITE_TOOLS 都是延迟工具（不在 core-5），延迟重发轮本就经 `∪deferredNamesThisRound` 入 skip；若按字面让非链已登记 batch 也入 skip，会改写现 30 工具 skip 成员、违背任务加粗的零行为变化红线与 spec `agent-tool-runtime.md` §14.2「非链态 ≡ FORCE_CONFIRM_TOOLS」。
**How to apply**：后续若任务再次给出 skip/矩阵类公式，先检查是否触碰「现工具零行为变化」红线；单意图 batch + 未登记 = 拒绝（有无交互均拒），链态 = 归入 writeBatch 走链末汇总确认。

**测试坑**：`tests/benchmarks/ab-test.test.ts`（djb2 比 MD5 快）在全量 suite 并行负载下会 flaky 失败，隔离跑必绿——门禁误报时先隔离复跑该文件再判断，不要动代码（与 [[agent-memory-optimize-pitfalls]] 的既有 flaky 同类）。

相关：[[multi-intent-task11-done]]（矩阵本体与 RED 占位 stub 归因法）。
