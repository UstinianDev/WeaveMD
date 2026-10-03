# ai-core-perf — 性能优化需求

> 创建：2026-10-03 | 工具：/devflow-perf | 档位：**L** | 状态：需求对齐完成
> 配套：[bottleneck](../../plan/ai-core-perf.bottleneck.md) · [plan](../../plan/ai-core-perf.plan.md) ·
> [status](../../plan/ai-core-perf.status.md) · [connectivity](../../plan/ai-core-perf.connectivity.md) ·
> [delivery](../../plan/ai-core-perf.delivery.md)

## 一、背景与范围

目标模块：**AI 代理**（多意图识别与执行、自动记忆、任务队列、内置工具）+ **文档解析处理**。

扫描 13 项瓶颈（P0×4 / P1×5 / P2×4），全部落在 `src/main/ai/agent/`、`src/main/ai/tools/`、
`src/main/ai/files/`、`src/main/ai/toolRegistry.ts`、`src/main/db/agentMemory.ts`、
`src/main/db/agentTaskDao.ts`、`src/main/ai/utils/tokenEstimator.ts`。

## 二、硬性约束（铁律）

| # | 约束 | 说明 |
|---|------|------|
| 1 | **细分功能严格不可改变** | 仅作性能优化；不合并/删除/新增任何功能点 |
| 2 | **行为不变：相同输入 → 相同输出** | 返回值、顺序、计数口径、错误语义逐字不变 |
| 3 | 执行速度 > 可读性 > 质量 | 但可读性不得降到无法维护（注释须写明优化依据） |
| 4 | 必须输出修改前后执行速度数据对比 | 见 delivery §1 |

## 三、需求清单

| # | 需求 | 验收标准 |
|---|------|---------|
| N1 | 降低 `runMemoryPolicy` 单次调用成本（每次 `memory_write` 同步触发，跑在 Electron 主进程） | 全列扫描次数与读取字节量下降，且 `{evicted, merged}` 计数口径不变 |
| N2 | 降低 `findSimilarMergeGroups` 的重复计算 | trigram Set 不在两两比较中反复重建；输出集合不变 |
| N3 | 消除 `toolsForIntent` 的每轮重建 | 单次耗时下降一个数量级以上；返回的工具内容与顺序不变 |
| N4 | 消除 `BranchInteractionGate` 的忙轮询 | 交互等待期间不再周期性唤醒事件循环；栅栏三态语义不变 |
| N5 | 降低 `analyzePdfLayout` 行聚类的算法常数 | 同规模版面耗时显著下降；`PdfLayoutResult` 全字段逐字一致 |
| N6 | 消除 `searchDocument` 零命中时的全文重扫 | 零命中调用不再付标题扫描成本；命中结果不变 |
| N7 | 接线已实现但未启用的 token 估算缓存 | 反复求和的耗时下降；估算数值逐字不变 |
| N8 | 收敛按意图分类的缓存键开销 | 分类耗时下降；缓存命中行为不变 |
| N9 | 消除「为判断有没有 pending 而物化整个会话任务列表」 | 改为存在性查询；判定结果不变 |

## 四、已对齐的决策（记录，避免实现期反复）

| # | 决策 | 裁定 |
|---|------|------|
| Q1 | **范围** | 用户选定 **P0 + P1 + P2 全部 13 项**（含零风险的 P2 四项） |
| Q2 | **外部技术调研** | 用户同意**跳过**。理由：13 项全部是本地算法复杂度 / 缓存装配 / 轮询改事件驱动的改动，不涉及任何外部库选型或 API 契约决策，调研无法产出决策输入。若范围扩大到「解析卸载 Worker / DAO 异步化」等架构级改动再补 |
| Q3 | **SQL 层测量口径** | `better-sqlite3` 为 Electron ABI 构建，vitest（纯 Node）下 `ERR_DLOPEN_FAILED`，真实库不可加载。SQL 层只给「语句形态 + 读取字节模型」，**如实标注为模型值而非实测 I/O** |
| Q4 | **放弃项的判定依据** | 凡实测收益为单位数毫秒或零收益者一律放弃并记录理由（DOC-2 / QUE-1 / MEM-1 批量关闭 / DOC-4 二分截断） |
| Q5 | **测试夹具更新的边界** | 允许因**查询形态变更**更新 fake 的 SQL 匹配器（把新形状逐字写进正则，保持「形状再变即变红」）；**不得**放宽夹具的校验强度，**不得**改动任何断言 |

## 五、明确不在本轮（范围外）

- 解析计算卸载 Web Worker（架构级：涉 worker_threads 生命周期与打包路径）
- `better-sqlite3` 异步化（改动面覆盖 20+ 模块）
- `pdfLayout.detectTable` 内部复杂度（缺大样例基准数据）
- `src/main/ai/skills/skillDistiller.ts` 的同款 pending 判定写法（白名单外）

## 六、验收判定

1. 速度有提升 → 有数据证明（墙钟 + 结构指标）
2. 行为未变化 → `npm run test` 全绿（exit 0）
3. 白名单内修改 → 越界项逐条申报
4. 门禁全过 → tsc 无错误 + eslint 0 error + vitest 全绿 + build 通过
