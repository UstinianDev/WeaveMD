# 任务状态 — perf-export-editor-outline

> /devflow-perf ｜ 目标：导出功能、编辑主区、目录区 ｜ 铁律：严格不改变任何模块行为

## 分级

- 类型：优化类（不走 Bug 短路径）
- 影响面：3 模块（导出/编辑主区/目录区）；编辑器与目录区共享 serializeBlock 数据流
- 定档：**M**（半天目标；若纳入中风险候选组 E4/O3/E5/X3 则升 L 重估）
- 流程：跳过拷问? 否（M 级走 grill-me）；强制外部调研? 否（M 级按需）

## Phase 进度

| Phase | 状态 | 产出 |
|-------|------|------|
| 0 分级+扫描 | ✅ 完成 | bottleneck.md（E1-E5 / O1-O5 / X1-X6，Top 排序） |
| 1 grill-me | ⏳ 进行中 | requirements/perf-export-editor-outline.req.md |
| 2 Plan | 待办 | plan/perf-export-editor-outline.plan.md（白名单） |
| 3-4 逐项优化 | 待办 | 每项回归测试 exit code 记录 |
| 5/5.5/6/7/8 | 待办 | review + connectivity + 全量门禁 + 合规 + 速度对比表 |

## 扫描要点摘要

- **Top3**：O1 滚动 O(N) DOM 测量；E1+E2 击键全树序列化正则逐行编译+join/split 双分配；X1 导出图片串行 IO
- **速赢组（低风险）**：O2 面板布尔选择器、E3 空文档早退、X2 md 跳过图内联、O4 activeIndex bail-out、E4候选
- **中风险候选（需基线测试解锁）**：E4 序列化引用缓存、O3 脏标记接线、E5 结构操作精准克隆、X3 IPC 契约瘦身
- **不立项**：X6 窗口复用（时序行为变化）、O5 虚拟列表（行为面大）
- **扫描事故**：编辑主区子代理连续 403（Free quota exhausted），改由总指挥直扫，质量不受影响（证据均带 file:line）

## 文档-实现不一致（待 Phase 7 同步）

1. CLAUDE.md "cloneTree 精准化" → 实际仅文本编辑路径精准，结构性操作仍全量 cloneTree（blockTree.ts:302）
2. CLAUDE.md "outline 脏标记" → 数据结构就绪但生产路径传 null 未启用（EditorV2.tsx:76）

## 剩余风险

- 性能基线尚未建立（Phase 4 第一步：microbench 脚本测 E1/E2/E4、O1、X1 改动前后）
- outline 增量分支、imageInline 并发、滚动检测算法 → 现无测试覆盖，纳入白名单前必须补基线
