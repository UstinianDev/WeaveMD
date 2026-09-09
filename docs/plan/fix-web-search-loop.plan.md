# Fix Web Search Loop — 实施计划

> 生成时间：2026-09-09
> 状态：已完成
> 档位：M（跨模块，需分析多个模块交互）

## 根因分析

问题链路：
1. `webSearchHandler.ts`：搜索失败时返回 `{ status: 'ok' }` + `results: []`（降级策略）
2. `agentLoop.ts`：`checkSameResult(result.content)` 对相同 JSON 字符串生成相同 hash
3. LLM 收到 `status:'ok'` + 空结果，无 `suggestion` 指导，重复相同查询
4. 连续 3 次相同 hash → 触发死循环检测

**根因**：降级策略 `status:'ok'` 回避了 `checkConsecutiveFailure`，但落入了 `checkSameResult`。

---

## 变更清单

| # | 文件 | 变更类型 | 描述 |
|---|------|----------|------|
| 1 | `src/main/ai/tools/webSearchHandler.ts` | **核心修复** | 移除降级策略；返回 `status:'error'` + 结构化错误码；添加 `suggestion` 字段 |
| 2 | `src/main/ai/tools/webSearch.ts` | **次要** | 细化错误区分：配置缺失 vs 搜索失败 |
| 3 | `src/main/ai/agent/agentLoopGuard.ts` | **核心修复** | `checkSameResult` 跳过空结果/错误结果 |
| 4 | `src/main/ai/agent/agentLoop.ts` | **适配** | 调整 `handleToolResult` 正确传播 `errorDesc` |
| 5 | `src/shared/ai.ts` | **类型** | 添加 `SearchErrorCode` 类型定义 |

---

## 实施步骤

### Step 1: 类型层 — `src/shared/ai.ts`

添加错误码类型：
```typescript
export type SearchErrorCode =
  | 'SEARCH_NOT_CONFIGURED'
  | 'SEARCH_FAILED'
  | 'SEARCH_TIMEOUT'
  | 'SEARCH_API_KEY_INVALID';
```

### Step 2: 搜索执行 — `src/main/ai/tools/webSearch.ts`

- `WebSearchResponse` 接口添加 `errorDesc?: string` 字段
- `resolveSearchConfig` 返回 null 时：`errorDesc: 'SEARCH_NOT_CONFIGURED'`
- catch 块区分错误类型：
  - HTTP 401/403 → `SEARCH_API_KEY_INVALID`
  - timeout/AbortError → `SEARCH_TIMEOUT`
  - 其他 → `SEARCH_FAILED`

### Step 3: 处理层 — `src/main/ai/tools/webSearchHandler.ts`（核心修复）

替换降级逻辑：
- 失败时返回 `status:'error'` + `errorDesc` + 用户友好消息
- 成功但无结果时返回 `status:'ok'` + `suggestion` 字段

```typescript
// 失败路径
if (!searchResult.success) {
  return {
    content: JSON.stringify({ error: errorCode, message: userMessage, ... }),
    status: 'error',
    errorDesc: errorCode,
  };
}

// 成功但无结果
if (searchResult.results.length === 0) {
  payload.suggestion = '搜索未返回结果。请尝试：1) 简化关键词；2) 换用同义词；3) 拆分为多个子查询。';
}
```

### Step 4: Guard 层 — `src/main/ai/agent/agentLoopGuard.ts`

修改 `checkSameResult`：
- 跳过空内容/null
- 跳过 `{results:[]}` 且无 `error` 字段的 JSON（合法的"无结果"场景）
- 保留对错误结果的检测（有 `error` 字段的 JSON 仍计入）

```typescript
private isEmptySearchResult(str: string): boolean {
  try {
    const parsed = JSON.parse(str);
    if (parsed && Array.isArray(parsed.results) && parsed.results.length === 0 && !parsed.error) {
      return true;
    }
  } catch {}
  return false;
}
```

### Step 5: Agent Loop 适配 — `src/main/ai/agent/agentLoop.ts`

调整 `handleToolResult` 中 LLM 消息构建：
```typescript
// 当前：errorDesc 存在时只传 errorDesc
const toolResultForLlm = answeredJson
  ?? (result.errorDesc ? `[工具 ${tc.name} 失败] ${result.errorDesc}` : result.content);

// 改为：errorDesc 存在且 content 有值时，传完整 content（含 message）
const toolResultForLlm = answeredJson
  ?? (result.errorDesc
    ? (result.content ? result.content : `[工具 ${tc.name} 失败] ${result.errorDesc}`)
    : result.content);
```

### Step 6: 测试

- 运行 `npm run typecheck` 验证类型
- 运行 `npm run test` 验证现有测试
- 手动验证 AC1-AC6

---

## 验收标准映射

| AC | 标准 | 实现位置 |
|----|------|----------|
| AC1 | API Key 未配置 → 明确配置引导 | Step 2 + Step 3 |
| AC2 | API Key 无效 → 明确错误提示 | Step 2 + Step 3 |
| AC3 | 网络超时 → 明确超时提示 | Step 2 + Step 3 |
| AC4 | 搜索无结果 → 不触发死循环 | Step 3 + Step 4 |
| AC5 | LLM 重复查询 → 提示改换策略 | Step 3 (suggestion) |
| AC6 | 多引擎失败 → 明确错误 | Step 2 + Step 3 |
| AC7 | 现有测试通过 | Step 6 |
| AC8 | 类型检查通过 | Step 1 |

---

## 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| Guard 改动影响其他工具 | 中 | `isEmptySearchResult` 仅匹配 `{results:[]}` 结构，不匹配通用空内容 |
| `status:'error'` 触发 `checkConsecutiveFailure` 过于激进 | 低 | 同参数连续失败 2 次才触发，不同参数重置计数 |
| LLM 忽略 `suggestion` | 低 | `maxRounds` 提供硬性兜底 |
| 现有测试 mock 受影响 | 低 | mock 结构与实现隔离 |

---

## 实施顺序

```
Step 1 (类型) → Step 2 (webSearch) → Step 3 (webSearchHandler) → Step 5 (agentLoop)
                                    ↗
Step 4 (guard) ─────────────────────
```

Step 1-3 依赖链（工具层），Step 4 独立（guard 层），Step 5 依赖两者。
