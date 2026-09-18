# agent-md-kb-optimize — 需求文档

> 日期：2026-09-18 | 档位：L | 基于：优化方向文档 v1.0 + grill-me 对齐

## 一、目标

对 WeaveMD 三个核心架构层（Markdown 解析、知识库检索、Agent 上下文构建）进行品质加固。

## 二、需求清单

### P0-1：引入 CommonMark 0.31.2 + GFM 0.29-gfm 标准测试套件

- **目标**：验证解析器与规范一致性，**100% 通过**，含修复失败的解析逻辑
- **范围**：
  - 从 commonmark-spec 仓库获取 spec.txt 测试用例，转为 Vitest 格式
  - 从 github.github.com/gfm 获取 GFM 扩展测试用例
  - 块级解析边界情况 + 行内解析边界情况 + 表格/任务列表/删除线
  - 修复测试中发现的解析 bug（修改 markdownToState.ts / inlineLexer.ts）
  - 确保现有 66 个往返测试不受影响
- **风险**：L3（需修改生产解析代码）
- **验收**：CommonMark 测试 100% 通过 + GFM 测试 100% 通过 + 现有测试回归通过

### P0-2：统一正则来源

- **目标**：将分散正则纳入 markdownSyntax.ts 单一来源，消除语法定义漂移
- **范围**：
  - 迁移 `SETEXT_UNDERLINE_RE`、`BLOCKQUOTE_RE`、`TABLE_SEPARATOR_RE` 到 markdownSyntax.ts
  - 统一 `tableCodec.SEPARATOR_RE` 从 markdownSyntax 导入（` *` → ` {0,3}`）
  - 更新 markdownToState.ts、blockDetection.ts、tableCodec.ts 的导入路径
  - BLOCKQUOTE_RE 与 BQ_CONV_RE 保持独立（解析器 vs 转换器语义分工明确）
- **风险**：L2
- **验收**：markdownRoundTrip.test.ts 全部通过 + typecheck + lint + blockDetection 检测正常

### P1-3：检索管线可观测性增强

- **目标**：在检索管线各步骤添加耗时和候选数量统计
- **范围**：
  - 扩展 `IKbSearchDetailedResponse` 添加可选 `diagnostics` 字段
  - `searchKB()` 各阶段：FTS5/向量/标题/RRF/聚合/重排/缓存 — `performance.now()` 埋点
  - 记录各路径候选数量（原始→融合→过滤→最终）
  - 添加查询理解统计（意图分类命中率、指代消解触发率）
  - 添加研究循环统计（子查询数、缓存命中次数）
  - 补充 cacheMonitor 缺失的 2 层（kbPreload + promptCache）接入
- **风险**：L1
- **验收**：diagnostics 字段输出正确 + logger 可观测 + cacheMonitor 6/6 层覆盖

### P1-4：研究循环并行化

- **目标**：将 researchLoop 串行子查询改为并行，降低延迟
- **范围**：
  - 提取内联逻辑为独立函数（`executeSubQuery`）
  - 改用 `Promise.allSettled()` 并行执行，并发上限 3
  - 保持 `highQuality >= 3` 提前终止（结果收集后判断）
  - 实现串行 fallback（并行失败时降级）
  - 子查询级错误隔离
- **风险**：L3
- **验收**：并行执行正确 + 提前终止正常 + fallback 正常 + 延迟低于串行

### P1-5：消除流路径/兜底路径代码重复

- **目标**：提取 8 块重复公共逻辑，减少约 180 行重复代码
- **范围**：
  - 提取共享函数到 agentToolExecutor.ts（去重、构造、验证、拦截、合并、循环、交互）
  - 统一 tc 引用方式为浅拷贝
  - 统一 replacementState fallback（添加 `?? ctx.replacementState`）
  - 两条路径（processStreamingToolRound / executeToolRound）统一导入
- **风险**：L2
- **验收**：重复代码消除 + 两条路径行为一致 + 现有 Agent 测试通过

### P1-6：延迟工具重发优化

- **目标**：保留已执行工具结果，减少重复请求
- **范围**：
  - 方案 B：重发时保留已执行非延迟工具结果，仅重发 LLM 请求
  - 重发上限改为 3 次总调用（`<= 3` → `< 3`）
  - 添加延迟重发遥测日志
  - 覆盖 ask_question_card 与 FORCE_CONFIRM_TOOLS 场景
- **风险**：L3
- **验收**：非延迟工具结果不丢失 + 重发上限正确 + 遥测日志可追踪

## 三、执行顺序

P0-1 → P0-2 → 门禁验证 → P1-3 ∥ P1-4 ∥ P1-5 ∥ P1-6（并行）

## 四、不涉及范围

- ❌ Embedding 逻辑（不修改 embeddingClient.ts 的向量生成）
- ❌ Agent 会话文件上传/图片上传解析（独立任务，不在本轮）
- ❌ 解析器架构重构（保持双向转换+不可变块树）

## 五、已对齐问题

详见 `docs/plan/agent-md-kb-optimize.status.md` 需求对齐决策记录。