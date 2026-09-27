---
name: doc-pipeline-b6-done
description: B6（五-1/五-2/五-3 多模态图片，L4）完成记录：4 个 commit、门禁证据、下一任务 B7，以及 contextManager/llmClient 局部 mock 与性能用例 flaky 的复现坑
metadata:
  type: project
---

# doc-pipeline B6 完成（2026-09-26，L4 已获放行）

- **commit**：`3213052`（content 数组 + Q4 压缩 + 计价）→ `11aac08`（imageStorage 落盘 + 相对路径）→ `b0b0853`（vision 检测 + 注入 + 识别接活 + 事件净化）→ `e35ea78`（渲染层 lightbox + 文档）。
- **门禁实测**：tsc 0 error / vitest **152 文件 3500 passed 0 failed** / lint 0 error（106 warning）/ vite build exit 0 / E2E **31 failed·1 skipped·101 passed**（与基线 spec 构成逐条同名单，零新增失败）。证据：`docs/testing/doc-pipeline-b6.tdd.md`。
- **下一任务**：B7（二-3 PDF 版面 + 二-4 D 路线 + 二-6 页码落库）。B7 可直接复用 B6 的 `estimateImageTokens`/`imageCostUsd`（D 路线页面图片计价）与 `agentMedia` 注入链路。
- **剩余 L4 批次**：B10（打包体积）、B11（写控制/外发闸）——按计划仍需**执行前二次确认**。

**Why**：B6 改的是核心 LLM 链路全调用点，是 29 任务里回归面最大的一批；记下复现坑避免下批次重复踩。

**How to apply**：

1. **局部 `vi.mock` 跟不上新 import 会运行期炸**：`tests/main/ai/agentLoop.test.ts` 与 `tests/benchmarks/agent-perf-benchmark.test.ts` 手写 factory mock 了 `@main/ai/contextManager` 与 `@main/ai/llm/llmClient`。只要 `agentContext`/`agentLoop`/`agentMedia` 从这两个模块**新增具名导出引用**，mock 缺 key 就会 `No "X" export is defined on the ... mock`（B6 中 `KEEP_RECENT_IMAGES`/`countMessageImages` 各炸一次）。改这两个模块的导入后，必须同步补 mock key。
2. **性能断言负载 flaky（非本批次引入）**：`cacheMonitor > getStats 10万次 < 50ms` 与 `ab-test > djb2 faster than MD5` 在全量/覆盖率负载下间歇超阈，单跑必过；全量跑到绿即可作为门禁证据（B4/B5 同款已记录）。**覆盖率报告必须在测试全过时才落**（v8 fail 不出报告），取 B6 子集并 `--exclude '**/cacheMonitor.test.ts'`。
3. **B6 的取舍已写进 TDD §8**，后续批次引用即可，勿重复决策：不新增 IPC 通道（图片落盘在 `persistIncomingAttachments` 主进程内完成）、svg 拒绝（非栅格化）、gif 原样 + 首帧提示、bmp 走 nativeImage 栅格化、单图 10MB、识别同步执行且 vision 不支持时**不发请求**直接标失败、`resolveModelProtocol`（显式 `ai_config.protocol` 优先，缺省才按模型名回退，不改写既有 6 处分流语义）。
4. **下一消费点**：B9 三-3（md 相对路径图片）复用 `agentMedia.buildImageParts` + `imageStorage.resolveStoredPath`；B11 八-3 清死通道时注意 `IImagePayload` 仍未接线（B6 刻意不动）。
5. **测试字面量写 Windows 路径一律用前斜杠**（`'C:/pics/a.png'`）：经 Bash heredoc + JSON 传参会把 `\\` 吃掉，`'C:\pics\...'` 在 JS 里变成 `C:pics...`，`toImgSrc` 不转 media:// 导致断言失败（B6 中招 2 次）。

相关：[[doc-pipeline-b5-done]]、[[doc-pipeline-b4-done]]（覆盖率口径同源）。
