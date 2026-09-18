# agent-md-kb-optimize — 实施计划

> 日期：2026-09-18 | 档位：L | 来源：需求文档 + 代码探查 + grill-me 对齐

## 1. 变更清单

### 1.1 新增文件

| 文件 | 用途 |
|------|------|
| `tests/editor/kernel/fixtures/commonmark-0.31.2.spec.json` | CommonMark 0.31.2 测试用例（从 spec.txt 解析） |
| `tests/editor/kernel/fixtures/gfm-extensions.json` | GFM 扩展测试用例 |
| `tests/editor/kernel/commonmarkSpec.test.ts` | CommonMark 批量动态测试 |
| `tests/editor/kernel/gfmSpec.test.ts` | GFM 扩展批量动态测试 |
| `tests/editor/kernel/scripts/parseSpecTxt.ts` | spec.txt → JSON 转换脚本 |

### 1.2 修改文件

| 文件 | 关联任务 | 变更级别 | 说明 |
|------|---------|---------|------|
| `src/render/editor/kernel/markdownSyntax.ts` | P0-2 | 小 | 新增 3 个正则导出 |
| `src/render/editor/kernel/markdownToState.ts` | P0-1, P0-2 | 中 | 修复解析 bug + 导入统一正则 |
| `src/render/editor/kernel/inlineLexer.ts` | P0-1 | 中 | 修复行内解析 bug |
| `src/render/editor/kernel/tableCodec.ts` | P0-2 | 小 | 导入 TABLE_SEPARATOR_RE |
| `src/shared/ai/kb.ts` | P1-3 | 中 | 新增 IKbSearchDiagnostics 接口 |
| `src/main/ai/knowledge/kbSearch.ts` | P1-3 | 大 | 全管线 performance.now() 埋点 |
| `src/main/ai/llm/llmClient.ts` | P1-3 | 小 | 接入 promptCache 缓存监控 |
| `src/main/ai/knowledge/knowledgeContext.ts` | P1-4 | 中 | 提取 executeSubQuery + Promise.allSettled 并行化 |
| `src/main/ai/agent/agentToolExecutor.ts` | P1-5 | 大 | 提取 8 个共享函数为公共导出 |
| `src/main/ai/agent/agentLoop.ts` | P1-5, P1-6 | 大 | 删除重复代码 + 保留已执行结果 + 重发上限 3 次 |

### 1.3 不涉及文件

- `embeddingClient.ts` — Embedding 逻辑不动
- `stateToMarkdown.ts` — 序列化器不动
- Agent 会话文件上传/图片上传 — 独立任务，不在本轮

---

## 2. 核心接口变更

### IKbSearchDiagnostics（新增）

```typescript
export interface IKbSearchDiagnostics {
  timings: { fts5Ms, vectorMs, titleMs, rrfMs, weightingMs, aggregationMs, rerankMs, totalMs };
  counts: { fts5Candidates, vectorCandidates, titleCandidates, mergedCandidates, afterWeighting, afterAggregation, finalResults };
  queryUnderstanding?: { intentType, isFallthrough, hadPronounRef };
  researchLoop?: { subQueryCount, cacheHits, totalResults };
  cacheSnapshot?: { searchResultHit, rerankHit };
}
```

### IKbSearchDetailedResponse 扩展

新增可选字段 `diagnostics?: IKbSearchDiagnostics`

---

## 3. 执行顺序依赖图

```
阶段 0: 准备
  └── 下载 spec.txt + 编写测试 fixture

阶段 1: P0 串行
  ├── P0-1: 引入测试 → 运行 → 修复失败 → 迭代 → 100% 通过
  └── P0-2: 正则统一 → 门禁验证

阶段 2: 门禁
  └── 全量测试 + typecheck + lint

阶段 3: P1 并行（4 个任务同时执行）
  ├── P1-3: 可观测性（L1）
  ├── P1-4: 并行化（L3）
  ├── P1-5: 代码去重（L2）
  └── P1-6: 工具重发（L3）

阶段 4: 最终验证
  └── 全量测试 + typecheck + lint + Agent 集成冒烟
```

---

## 4. 风险与回滚

| 任务 | 风险 | 回滚方案 |
|------|------|---------|
| P0-1 | 解析修复可能破坏现有往返测试 | 每个修复独立 commit，可单独 revert |
| P0-2 | TABLE_SEPARATOR_RE ` *` → ` {0,3}` 可能影响 tableCodec | tableCodec 可回退到本地副本 |
| P1-3 | 几乎无风险（纯增量、可选字段） | 删除 diagnostics + 埋点代码即可 |
| P1-4 | seenChunkIds 竞态 | 串行 fallback 自动降级 |
| P1-5 | 提取函数可能遗漏边缘情况 | git revert 提取 commit |
| P1-6 | 保留结果可能导致重复工具调用 | 合并时去重逻辑防重复 |

---

## 5. 预估变更量

| 子任务 | 新增行 | 删除行 | 净变化 |
|--------|--------|--------|--------|
| P0-1 | ~350 | ~10 | +340 |
| P0-2 | ~15 | ~10 | +5 |
| P1-3 | ~120 | ~5 | +115 |
| P1-4 | ~80 | ~30 | +50 |
| P1-5 | ~100 | ~180 | -80 |
| P1-6 | ~50 | ~20 | +30 |
| **合计** | **~715** | **~255** | **+460** |

---

## 6. 验收标准汇总

1. CommonMark 0.31.2 测试 100% 通过 + GFM 扩展测试 100% 通过
2. markdownRoundTrip.test.ts (66) + tableCodec.test.ts + inlineLexer.test.ts 全部通过
3. diagnostics 字段输出正确 + cacheMonitor 6/6 层覆盖
4. 并行化延迟低于串行 + 提前终止正常 + fallback 降级正常
5. 重复代码消除 + 两条路径行为一致
6. 非延迟工具结果不丢失 + 重发上限 3 次 + 遥测日志可追踪
7. typecheck + lint 零错误
8. 全量 vitest 通过