---
name: doc-pipeline-b4-done
description: doc-pipeline B4（四-3 批量导入通道）完成事实：解析先行导入、D3 attachment_id、KB_DELETE docId、覆盖率/门禁口径与坑
metadata:
  type: project
---

# doc-pipeline B4 完成记录（2026-09-26）

- **范围**：四-3 批量导入通道 = `importDirAsKb` 解析先行（7 格式、pdf 不 utf-8 直读）+ 失败 `status='error'` 可见 + 附件入 KB（`parsed_attachments.id` 关联）+ **D3** `kb_documents.attachment_id` + `idx_kb_doc_user_attachment`。
- **下一任务**：B5（四-1 `kbIndexOpts()` 真实配置贯通 3 入口 + 四-2 heading_path；D4 无 DDL）。

## 关键架构事实

- 附件入 KB **复用 `kb:import:file`**（`KbImportFileRequest = {title,content} | {attachmentId}` 二选一），未新增 IPC 通道 → §1.3 三处同步规则不触发；B11 勾选 UI 直接调 `kb.importFile({userId, attachmentId})`。
- `KB_DELETE` 载荷扩 `{fileId?, docId?}`（fileId 优先）：导入/错误行 `file_id` 为 NULL，必须走 docId；`triggerKbDelete` 已改对象入参 `{fileId?, docId?}`。
- **附件唯一删除点 = `removeParsedAttachment`（db/attachments.ts）**，成功即调 `removeByAttachment` 清 KB（单向依赖 db/attachments → ai/knowledge/kbIndexer，无环）。未来附件删除 IPC 必须走此函数，否则清理旁路。
- `upsertKbDocument` 查找优先级 `attachmentId > fileId > 新建行`：附件行重试幂等收敛；纯导入行（两键皆空）每次新建（**既有**重复行语义，未改）。
- `recordImportFailure(userId, title, {sourceType?, attachmentId?, error?})` = 失败行落库单点（kbIndexer 导出）。

## 测试/门禁坑（复用价值）

- **v8 coverage 在 tests fail 时不落报告**（`coverage.reportOnFailure=false` 默认）→ 覆盖率运行必须全绿；而插桩会让 `cacheMonitor getStats 10万次<50ms` 必超阈（62~86ms）→ 覆盖率证据取「B4 相关子集运行」（全通过才出报告），全量覆盖率不可行（存量性能用例，勿改它）。
- vitest 对**未导出命名**（vite-node 宽松链接）不报 file 级错误：只在测试调用处 `not a function` 失败 → RED 表现为「仅新增用例失败、存量用例通过」。
- 真库迁移验证必须 `npx electron scripts/xxx-smoke.cjs`（better-sqlite3 ABI）；脚本 DDL 从 `db/index.ts` 源码正则抽取防漂移（见 [[doc-pipeline-b3-done]]）。
- mock kbHandlers 依赖时必须同时 mock：`@main/db/ai|kb|files|attachments` + `@main/ai/knowledge/kbIndexer`（含新增导出）+ `@main/ai/files/documentParser|parseLimiter`，漏一个 = import 面报错。

## 文档归属

- `docs/architecture/database.md` kb_documents/kb_chunks 字段表仍陈旧（source_path/chunk_count），按计划归 **B11 八-3②** 统一对齐；B4 只同步了 `knowledge.md`。
- B4 遗留：设置页单文件导入解析失败仍静默（无行内提示）；目录导入重复行语义未改。
