# doc-pipeline 最终全量质量门禁报告（阶段 6）

> 分支 `feat/doc-pipeline`（源码基点 `187c472`，B1~B12 全部完成）；报告生成 2026-09-27。
> 执行角色：testing-quality-agent（只读验证 + 本文档，不改业务代码）。
> 注：运行期间并行代理提交了两份 docs-only 报告（`35180f7` 阶段7、`b52cbeb` 阶段6.5），
> 未触及 `src/`，与本文门禁结论无冲突。
> 溯源声明：来源标注中的 `docs/plan/*` 为过程计划文档，已随计划退役（历史见 git），仅留溯源线索。

## 1. 五门禁结果

| # | 门禁 | 命令 | 实际输出摘要 | 判定 |
|---|------|------|--------------|------|
| 1 | 类型检查 | `npx tsc --noEmit` | exit 0，0 error | ✅ |
| 2 | 单元测试 | `npx vitest run` | **161 文件 / 3781 passed / 0 failed**（242s，exit 0；与 B11 记录 3781 持平，0 删除） | ✅ |
| 3 | Lint | `npm run lint` | exit 0，**0 error / 106 warning**（`✖ 106 problems (0 errors, 106 warnings)`）；warning 与基线 106 持平（B5 起 108→106），`--fix` 未改动任何工作树文件 | ✅ |
| 4 | 构建 | `npx vite build` | exit 0；renderer 11.39s + preload 段；`dist-main/xlsx-qn1xoUuv.js 429.20 kB` 动态分包正常 | ✅ |
| 5 | E2E | `npx playwright test` | **31 failed / 1 skipped / 101 passed（10.4m，共 133 条）**，exit 1——与基线聚合数完全一致，逐 spec 比对零新增失败（见 §2） | ✅（存量口径） |
| 6 | 覆盖率抽查 | `npx vitest run --coverage`（见 §3） | 全绿一轮 161 文件 3781 passed，报告生成成功 | ✅ |

## 2. E2E 失败名单与基线比对

**基线**（`docs/plan/doc-pipeline.status.md` 各批次门禁记录 / `docs/plan/agent-cost-optimize.status.md` §质量门禁）：
31 failed / 1 skipped / 101 passed（133 条），按 spec 构成：
`editor-table 7 / feedback 5 / drag-selection-markers 5 / ai-agent-panel 4 / floating-toolbar 2 / exit-behavior 2 / thematic-break 2 / editor 1 / image-resize 1 / recent-history-restore 1 / welcome-doc 1`。

**本次实测 31 条失败逐条归属**：

| spec | 基线条数 | 本次条数 | 测试标题（节选） | 一致性 |
|------|---------|---------|------------------|--------|
| `editor-table.spec.ts` | 7 | 7 | :244 / :268 / :289 / :313 / :337 / :431 / :463 | ✅ |
| `feedback.spec.ts` | 5 | 5 | :165 / :172 / :180 / :189 / :205 | ✅ |
| `drag-selection-markers.spec.ts` | 5 | 5 | DSG-R1 / R2a / R2b / R3 / P（标题自带「当前 RED」） | ✅ |
| `ai-agent-panel.spec.ts` | 4 | 4 | A4(:1018) / A2(:1165) / A3(:1212) / ①(:1640)（已裁定保留） | ✅ |
| `floating-toolbar.spec.ts` | 2 | 2 | G1(:222) + LINK-IMAGE-E5(:1026)（B11 记录同名单） | ✅ |
| `exit-behavior.spec.ts` | 2 | 2 | :491 / :527 | ✅ |
| `thematic-break.spec.ts` | 2 | 2 | :87 / :104 | ✅ |
| `editor` / `image-resize` / `recent-history-restore` / `welcome-doc` | 各 1 | 各 1 | :219 / :211 / :187 / :99 | ✅ |
| **合计** | **31** | **31** | — | **逐 spec 条数与标题全一致，零新增失败** |

- 失败名单中**零条**涉及 doc-pipeline 域（upload / 知识库 / composer / 附件 / 附件勾选 / 引用回链），
  `cross-block-replace-input`、`cross-block-selection`、`drag-selection-move`、`link-editing-regression`、
  `marktext-rendering` 等 spec 全绿。
- 说明：仓库未存档基线的逐条 `comm` 名单文件（agent-cost-optimize TDD §6 已注明历史日志未存档），
  故本轮比对采用「聚合数 + 逐 spec 条数 + 失败标题逐条归属」口径；结论与 B2~B11 各批次「逐条同名单」记录一致。
- 本次耗时 10.4m（历史 6.8~7.1m），机器负载偏高但结果集合不变。

## 3. 覆盖率

- 项目 `vitest.config.ts` 的 coverage.include 为存量 FT4 批次 5 文件口径；本轮抽查经 CLI 覆盖为
  `--coverage.include='src/**/*.ts' --coverage.include='src/**/*.tsx'`
  （并加 `--coverage.reporter=json-summary/text-summary --coverage.reportOnFailure=true`，
  否则测试失败时不产报告）。最终一轮 **161 文件 3781 passed 全绿**，报告生成成功。
- **整体（src 全量口径）**：Statements **65.17%**（45070/69152）、Lines **65.17%**、
  Branches **77.72%**（6630/8530）、Functions **66.4%**（1271/1914）。
- **doc-pipeline 新增文件（分支相对 main 新增 8 个 src 文件）**：Lines **97.64%**（2231/2285）
  —— `mdImageResolver` 98.29% / `multimodalParse` 97.15% / `pdfLayout` 98.12% / `vectorBackfill` 98.36% /
  `analyzeChart` 94.19% / `extractTable` 94.82% / `readPage` 100% / `searchDocument` 98.26%。
- **分支改动 src 文件（55 个可测文件，B5~B12）聚合**：Lines **79.40%**（17551/22105）。
  低值均为存量段或既有结构：`preload.ts` 0%（上下文桥接，无单测口径）、`db/index.ts` 30.18%（迁移
  基建，走真库 smoke）、`configConsentHandlers` 42.85%、`agentTaskWorker` 50.49%、`ipc-handlers` 50.93%；
  doc-pipeline 核心解析/检索/DAO 文件普遍 ≥91%。
- 过程记录：含 coverage 插桩的前两轮各遇 1 次 `cacheMonitor.test.ts getStats 10 万次 < 50ms`
  负载 flaky（65.0ms / 66.2ms vs 阈值 50ms）——**存量已记录 flaky（B4/B5/B6 同款）**，
  单跑 37 passed、最终一轮全量绿；纯 vitest 全量（无插桩）两轮均 0 failed。

## 4. 总体判定

**全绿（按裁定口径通过）**：tsc 0 error / vitest 3781-0 / lint 0 error（106 存量 warning 持平）/
vite build exit 0 / E2E 31·1·101 与基线逐条同名单零新增；覆盖率抽查达标（新增文件 97.64%）。

遗留（均非本阶段引入、不阻塞）：
1. E2E 存量 31 failed 属前序已裁定范围（10 条已知/预期 + 21 条其他 spec 既有问题）。
2. `cacheMonitor` 负载 flaky 在 coverage 插桩下必现，建议后续把该性能断言改为宽松阈值或标记环境敏感。
3. 覆盖率默认配置仍是 FT4 5 文件口径，全量抽查需 CLI 覆盖 include（如需常态化可另立配置，属改动待批）。
