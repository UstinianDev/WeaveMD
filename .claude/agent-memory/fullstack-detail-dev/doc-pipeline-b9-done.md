---
name: doc-pipeline-b9-done
description: doc-pipeline B9 完成记录（0213b4e+67372f8）——currentFileRef 引用模式、mdImageResolver 越界拦截、FOLDER_READ 锁定；下一任务 B10/B11（L4 需二次确认）
metadata:
  type: project
---

# doc-pipeline B9 完成（2026-09-27，L2）

**Why:** B1~B9 中三（目录文件树）模块至此全部完成；下一任务 B10（七体积）/B11（八写控制）均为 L4，执行前需用户二次确认。
**How to apply:** 派发 B10/B11 时提醒 L4 确认门；B12（Docling PoC）在 B10 后收尾。

## 关键事实

- Commit：`0213b4e` feat（19 文件）+ `67372f8` docs（TDD 报告 + status）。
- **三-1 发送构造实测指位**：FileTreePanel 无发送通道（只 openFile，磁盘文件 id=路径）；真正的构造在 `agentStore.sendAgentMessage` 新增 `currentFileRef{name,path}` → `agentHandlers` extra → `agentTaskWorker.readTaskPayload` 白名单 → `AgentReqPayload` → `agentPromptBuilder.buildDocumentContext` 引用模式（文件名+路径+规模+大纲+前20行，正文交 readLocalFile）。无 ref（welcome:///DB 文档）保持旧整篇注入——存量 A1a 断言零修改。
- `currentDocument` 全文仍随 IPC 载荷（editBlocks contentHash / toolsForIntent 门控依赖）；"不整篇内联"只在 prompt 注入点——与 B3 占位符同口径（工具上下文 vs prompt）。
- **三-3 `src/main/ai/files/mdImageResolver.ts`**：基准=md 目录；workspaceRoot=含 md 的最长文件树根（`pickWorkspaceRoot`）；**越界判定先于存在性检查**；路径运算自实现（不依赖 path 模块——vitest browserify posix 语义会误拒盘符，B8 同因）；`buildMdImageContext` 复用 B6 `buildImageParts` 注入 agentContext 当前轮（上限 3=KEEP_RECENT_IMAGES），不调用 recognizeImageAttachments（附件专属，取舍 TDD §8.4）。
- FOLDER_READ `.md` 过滤：有意保留 + ipc-handlers 注释 + docs/08 写明 + ipcDialogs 真实目录锁定用例（首跑即绿是预期——行为未改）。

## 坑

- agentStore.test 跨 describe 的 `runAgent.mock.calls[0]` 会指到上一 describe 的调用——新 describe 必须自带 `beforeEach(vi.clearAllMocks)`。
- 引用模式首版标题大纲无单条上限 → 50k 单行标题把摘要撑到 51k 字符（RED 后修 `REF_OUTLINE_MAX_CHARS=120`）。
- UNC `//server/share` 首版被折成 `/server/share`——collapsePath 需先判 `//` 前缀。
- 全量 vitest 中 `cacheMonitor`(getStats<50ms)/`ab-test` 性能断言负载 flaky 属存量（单跑绿，B4/B5/B6 同款记录）；E2E 基线 31 failed 构成按 spec 比对（table7/feedback5/drag5/ai-agent-panel4/其余 2+1）。

## 门禁（B9 收口实测）

tsc 0 error / vitest 159 文件 3708 passed（基线 3664+44）/ lint 0 error（106 warning 持平）/ vite build 3 段 / E2E 31f·1s·101p 零新增；覆盖率 mdImageResolver 98.26%。

相关：[[doc-pipeline-b8-done]] [[doc-pipeline-b7-done]]
