---
name: doc-pipeline-b11-done
description: doc-pipeline B11 完成记录——外发过滤三层结构、D5b 计划缺口、勾选授权链与三个环境坑；下一任务 B12
metadata:
  type: project
---

# B11 完成（2026-09-27，commits 32878a4 feat + b1ed1f1 docs）

**Why:** L4 安全语义批次（allowSend 不放宽是最高红线），已获用户二次放行；交付 Q1「入 KB + 过滤」与 Q2 勾选持久化。
**How to apply:** B12（Docling PoC）为最后一任务（须先过七-3 体积门禁）；后续任何动 searchKB/consent 的批次先读下述结构。

## 架构要点（B11 落地的安全语义三层）

1. **数据层**：`kb_documents.consent_granted`（D5b，计划 §3 未单列但 §2 变更清单要求——计划文内部缺口，按变更清单落地并在 TDD §6 记录）；`upsertKbDocument` 的 `consentGranted` **undefined=不改既有授权**（漏传不撤销），显式 true/false 才写列。
2. **过滤层**：`kbSearch.filterKbEgressResults(res, allowSend, grantedDocIds)` 纯函数——唯一接线点是 `agentTaskWorker.buildAgentDeps` 的 searchKb 闭包（**preloader 会用 deps.searchKb 覆盖 ctx.toolCtx.searchKb，所以过滤必须包在 deps 层**，不能包 agentContext 的 toolCtx）。查询异常 → 空集合 fail-closed。
3. **注入层**：`kbEgressAuthorized = !needsKbSendConsent` 计算一字未动；`toolsForIntent` 第 7 参 `kbAttachmentEgressGranted`（agentContext try/catch fail-closed 查 `hasGrantedAttachmentDocs`）。

## 关键事实

- **`useKnowledgeBase` 硬编码 false**（Module 10 废弃开关，B 类不得恢复）→ searchKB 注入矩阵生产 UI 不可达；本批交付的是主进程语义层契约。渲染层 `agentStore:581` 的 `useKnowledgeBase && !allowSend` 拦截同样不可达。
- **附件入 KB 唯一触发 = 勾选**：`uploadToKb` payload（AGENT_RUN/AI_CHAT）→ `importAttachmentsAsKb`（仅 file+done，fire-and-forget）。工具侧对附件写入零引用 = manual 确认语义天然满足（八-2 核查结论入 ai-agent.md）。
- **sqlite-vec 核查结论（B10 遗留）**：降级路径可用不修——`kbSearchFts.vectorSearch` prepare 抛错静默降级、回填 Float32 BLOB 不依赖扩展；打包形态 vec 未映射只影响向量候选（走 FTS5）。
- AI_CHAT 渲染层无调用方（Chat 模式已删），但 handler 仍被 ipc.test 覆盖。

## 环境坑（复用价值）

- **aiDao/kbDao 的 FakeDb run()**：`run` 分派里 sql 是闭包变量（prepare(sql) 捕获），不能从 args 取——曾误改导致全部 run 断言损坏，须回滚。
- **vi.mock 整模块替换缺导出会静默 undefined**（不报 import 错，调用时才崩）：ipc.test 的 kbSearchMock/db kbMock 必须补新导出（filterKbEgressResults / getGrantedAttachmentDocIds）。
- **playwright 命令接 `| tail -N` 会丢真实 rc**（管道 rc 属 tail）且截断汇总——E2E 必须完整落盘 `> log 2>&1; echo RC=$?` 才能拿 31 failed 汇总。
- heredoc `cat >>` 在本机 bash 对含反引号/复杂引号内容易炸，改用 Edit 工具或纯文本 heredoc。

## 门禁与状态

tsc 0 error / vitest 161 文件 **3781**（+51，0 删除）/ lint 0 error / vite build 0 / E2E **31 failed·1 skipped·101 passed**（数量与基线精确一致、失败清单零条触及 B11 面 = 零新增）。TDD：`docs/testing/doc-pipeline-b11.tdd.md`。

相关：[[doc-pipeline-b10-done]] [[doc-pipeline-b5-done]]（vectorBackfill 降级注释出处）
