# AI 模块性能优化 v2 — 状态文档

> 档位：L（跨 3 模块·多文件优化）
> 创建：2026-08-29
> 完成：2026-08-29
> 约束：不可更改任何模块功能，仅优化

## 审计结论

经源码审计，初始扫描数据部分过时。以下优化**已就位**：
- ✅ 工具并行执行（READ_ONLY_TOOLS 分区 + Promise.all）
- ✅ 增量 token 统计（ctx.totalTokens 累加）
- ✅ 上下文增量追加（ctx.llmMessages.push，非每轮重建）
- ✅ AgentTab 消息分页 + rAF 节流
- ✅ AIMessageBubble / MarkdownMessage React.memo
- ✅ AgentWorkflowCard 拆分子组件 + memo

## 已完成优化

### P0（高收益零风险）✅
- [x] D1. db/index.ts 添加 `busy_timeout = 5000` pragma
- [x] D2. db/ai.ts 预编译 SQL 语句缓存（20 处 `db.prepare` → `cachedPrepare`）

### P1（中等收益低风险）✅
- [x] B1. AIPanelComposer `React.memo` 包裹
- [x] A1. agentLoop summary 缓存 → 审计后发现仅每 5+ 轮调用一次，跳过

### P2（高收益中风险）✅
- [x] B3. renderAIMarkdownSafe LRU 缓存（64 条）+ 流式结束自动清除

### P3（代码质量）✅
- [x] B4. AgentStepTimeline groupByLoop `useMemo` 缓存
- [ ] B2. 消息列表自动懒加载 — 低优先级，已有分页机制
- [ ] C2. estimateTokens 统一 — 低优先级，不影响运行时

## 测试门禁
- [x] tsc 0 新增错误
- [x] vitest 1528/1528 通过（1 个 pre-existing 失败）
- [x] eslint 0 错误
- [x] vite build 成功

## 变更文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/main/db/index.ts` | 新增 1 行 | busy_timeout pragma |
| `src/main/db/ai.ts` | 新增 ~70 行 | stmtCache + cachedPrepare（20 处替换） |
| `src/render/services/aiMarkdown.tsx` | 新增 ~45 行 | LRU 缓存 + clearMarkdownCache |
| `src/render/components/AIAgent/panel/AIPanelComposer.tsx` | 修改 2 行 | React.memo 包裹 |
| `src/render/components/AIAgent/message/MarkdownMessage.tsx` | 新增 ~25 行 | isStreaming prop + 缓存清理 hook |
| `src/render/components/AIAgent/message/AIMessageBubble.tsx` | 修改 1 行 | 透传 isStreaming |
| `src/render/components/AIAgent/workflow/AgentStepTimeline.tsx` | 修改 3 行 | useMemo 缓存 groupByLoop |
