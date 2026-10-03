# Agent Memory Index

> 2026-10-04 清理：只保留**可迁移**的坑、约定与纪律（跨任务复用）；
> 已交付任务的实现记录已删除（历史见 git）。

## 约定与纪律
- [文档拆分约定（阈值 400 / 分册零增行）](project-doc-split-convention.md) — 分册只放逐字正文、回链全在主文档；自检走 git show + diff 重建比对
- [docs 按模块入子文件夹](project-doc-module-folder-reorg.md) — testing/requirements/research 计数口径与旧路径 grep 排除区
- [共用记忆索引会被整文件覆盖](project-shared-memory-index-clobber.md) — 并行智能体写 MEMORY.md 前先合并 HEAD+工作区，缺失行按磁盘文件补回
- [devflow 并行子代理纪律](project_devflow_parallel_subagents.md) — 多子代理改同一工作树时，门禁报错须先归属到自己负责的文件
- [AI renderer 安全渲染](feedback_ai_renderer_security.md) — markdown 气泡必须纯文本渲染，禁止 dangerouslySetInnerHTML

## 测试与验证
- [全量套件 flaky 与覆盖率口径](project_fullsuite_flaky_perf_tests.md) — cacheMonitor / ab-test 耗时断言并行必红单跑必绿；覆盖率 run 有失败用例时不落报告，需 `--exclude` 单 glob
- [测试环境六个坑](weavemd-test-env-pitfalls.md) — better-sqlite3 原生模块、coverage.include 传参、coverage 报告需全绿等
- [E2E 基线既有失败](e2e-baseline-known-failures.md) — 31 failed 是前序任务已裁定的接受态，验收时对齐基线口径而非要求全绿
- [intentRouter 测试造例坑](project_intentrouter_test_input_pitfall.md) — 必须手工推演关键词子串命中（create 的单字「写」会被「缩写/扩写」误命中）

## 平台与数据
- [better-sqlite3 拒绝 ADD COLUMN IF NOT EXISTS](fts-server-better-sqlite3-add-column.md) — 幂等加列需运行期 PRAGMA 探测
- [FTS5 unicode61 中文分词坑](fts5-cjk-unicode61.md) — 连续中文被当成一个 token，Bare CJK match 不命中，需前缀查询或向量兜底

## 架构口径
- [AI 面板主进程层边界](ai-main-process-layer.md) — 模块边界 / 测试隔离模式 / 安全契约
- [Prompt 前缀稳定性](ai-prompt-prefix-stability.md) — 工具字母序、系统提示分层、动态上下文入 system-reminder
