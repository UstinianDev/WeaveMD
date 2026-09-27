---
name: doc-pipeline-b5-done
description: doc-pipeline B5 完成记录（commit 26816af）——embedding 接通三入口、向量回填、heading_path、表格分块的执行事实与坑
metadata:
  type: project
---

# doc-pipeline B5 完成（2026-09-26，commit `26816af`，分支 feat/doc-pipeline）

- **范围**：四-1 Embedding 接通 + 四-2 heading_path（D4 无 DDL）+ 三-2 表格分块同批。
- **门禁**：tsc 0 / vitest 146 文件 3416 passed（B4 基线 3370 + 46）/ lint 0 error（108 warning）/ vite build 0 / E2E 31f·1s·101p = 基线零新增。
- **下一任务**：B6（五-1 content 数组 + 五-2 落盘 + 五-3 死代码接活）——**L4，执行前需二次确认**。

**Why:** 计划 §2-B5 验收点是"漏一条入口即部分摆设"，三入口贯通 + 回填可观测是硬验收。
**How to apply:** B6/后续批次触碰 kb 链路时沿用以下事实：

## 关键架构事实（已验证）

- `kbIndexOpts(userId)` 定义在 `src/main/ai/ipc/kbHandlers.ts`（export），依赖 `resolveEmbedding`——后者在 `src/main/ai/knowledge/vectorBackfill.ts`（**单点**配置解析：`getAiConfig.kbEmbeddingProvider` → `ai_embedding_config.apiKeyEnc` → `decryptApiKey`，任一失败 null → `{}` 纯 FTS5）。ipc-handlers.ts 直接 import 两者（无循环依赖）。
- 回填触发点 = 各索引入口完成后 `scheduleVectorBackfill(userId)`（防抖 2s、批 20/间隔 300ms、状态内存态 `getVectorBackfillStatus`，**无 IPC/UI**——如需展示是新增需求）。
- 切换 embedding 模型失效策略是**双层**：检索侧 `vectorSearch` 参数化 `embedding_model = ?`（searchKB 读当前配置透传）+ 回填侧扫描 `embedding_model IS NOT ?` 渐进重算。
- `splitNote` 已重写为「结构单元扫描（GFM 表格判定：表头/分隔单元数相等+未转义管道计数）→ 贪心合并 → 原子输出」：表格独立 chunk、超长表按行切片重复表头（片间零 overlap）、标题统领合并、`NoteChunk.headingPath`（80 字符截断，空串由 DAO 归一 NULL）。
- headingPath **只入列不前置进 content**——上下文前缀取舍归 B8 四-4②。

## 坑

- 会话开始时 gitStatus 快照说在 feat/doc-pipeline，实际 checkout 在 **main**（与 feat 同点 7d812b3）；提交前必须 `git branch --show-current` 核实，本次已切回 feat/doc-pipeline 提交。
- `cacheMonitor getStats 10万次<50ms` 是负载 flaky 存量（B4 已记录）：全量偶发 1 failed，单跑即绿、收尾全量绿——非新增失败，勿改该测试。
- vitest FakeDb 直接传给 `Database.Database` 参数需 `as unknown as Database.Database` 断言；`vi.fn(() => ...)` 零参定义会让 `mock.calls[0][1]` 报 TS2493——mock 定义时写全参数签名。
- 覆盖率证据跑 B5 相关子集（cacheMonitor 插桩必超阈）；vitest coverage 在 tests fail 时不落报告。
