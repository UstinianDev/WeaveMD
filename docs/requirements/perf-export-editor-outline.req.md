# 需求对齐 — perf-export-editor-outline（/devflow-perf Phase 1）

> 2026-09-13 grilling 结论。铁律（用户重申）：**严格不可改变模块功能的任何行为**。

## 决策记录

| # | 决策 | 结论 |
|---|------|------|
| Q1 | 范围档位 | **B 档**：低风险速赢组先行；microbench 数据决定 E4（序列化引用缓存）/O3（脏标记接线）是否解锁；E5/X3 本轮不做 |
| Q2 | 速赢组清单 | 9 项全保（O1/O2/O4/E1/E2/E3/X1/X2/X4）；X4 若实测收益 <5ms 降级为顺手做、不为它跑基准 |
| Q3 | 验收量化 | 单项被改函数 bench 前后 **≥20%**；击键合成路径 **≥30%**；达不到 20% 标注"收益不显著"但不回滚（回归仍须全绿）；测法见下 |
| Q4 | 基线门禁 | **确认**：中风险项（若解锁）实施前先写改动前行为快照测试，基线绿才动刀 |
| Q5 | 文档同步 | Phase 7 修正 CLAUDE.md 两处失实表述（cloneTree 精准化范围 / outline 脏标记接线状态），按最终落地事实措辞 |
| Q6 | 测量资产 | `scripts/perf/` 放工具脚本与合成 fixture 生成器；bench 用例 `tests/**/*.bench.ts`；随速度对比表提交入库作证据 |
| Q7 | 执行方式 | 子代理通道本会话不可用（403），E4/O3 基线测试与实施由总指挥直接串行；每项独占一次"补测试→动刀→回归→记录"循环，每步一个 git 提交回滚点 |

## 测量方法（Q3 细化）

- **固定样本**：合成大文档 = 1000 块（5 个 200 行代码块、100 个标题、列表/引用嵌套混合）；导出样本 = 10 张本地小图笔记
- **编辑/目录区**：`vitest bench`（纯函数级：stateToMarkdown 全树序列化、outline fullBuild）+ Playwright e2e 实测（滚动检测 DOM 测量次数/帧耗时，真实 Chromium；jsdom rect 全零不具代表性）
- **导出区**：vitest bench（node fs 可用）实测 `inlineMediaImages` wall time
- **对比协议**：改动前在 main 基线跑一轮存 JSON → 每项改完在同机重跑 → 同表对比

## 验收标准（Gate）

1. 每项改动：`npm run test` exit 0（失败即 `git checkout` 回滚该项）
2. 全量门禁：tsc + vitest + eslint(0 error) + vite build + Playwright E2E 全绿
3. 行为不变证据：markdownRoundTrip 往返测试绿 + X1/X2/O1 新基线测试绿 + E2 新旧实现等价断言测试
4. 速度对比表（必交付，引用 bench 输出）
5. 白名单外零文件变更

## 明确不做（本轮）

- E5 结构操作精准克隆、X3 IPC 契约瘦身 → 另立项
- 滚动 rAF 合帧、导出 debounce、offscreen 窗口复用、目录虚拟列表 → 违反行为零变化铁律
- 不降低导出图片精度/分辨率/压缩率
