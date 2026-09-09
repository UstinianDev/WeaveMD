# Fix Web Search Loop — 需求文档

> 生成时间：2026-09-09
> 状态：已完成
> 档位：M（跨模块，需分析多个模块交互）

## 问题描述

当用户问涉及上网搜索的问题时，创作助手 Agent 调用 `web_search` 工具的结果都是 0 个，最终 Agent 输出 "⚠️ 请求失败：Detected same result 3 times in a row"。

**问题链路**：
```
搜索失败 → 降级响应 {results:[], status:'ok'} → hash 相同 → checkSameResult 检测到 3 次 → 死循环触发
```

**关键文件**：
- `src/main/ai/tools/webSearchHandler.ts`（第 7-15 行降级逻辑）
- `src/main/ai/tools/webSearch.ts`（配置解析与执行）
- `src/main/ai/searchClient.ts`（多引擎搜索客户端）
- `src/main/ai/agent/agentLoopGuard.ts`（死循环检测）
- `src/main/ai/agent/agentLoop.ts`（工具执行与结果处理）

---

## 需求清单

| # | 需求点 | 优先级 | 状态 |
|---|--------|--------|------|
| 1 | 修复搜索失败时降级策略：返回 `status:'ok'` + 空结果，导致 guard 误判为死循环 | P0 | 待实现 |
| 2 | 改进 agentLoopGuard：区分"无结果"（正常）vs"相同错误"（异常） | P0 | 待实现 |
| 3 | 改进 webSearchHandler 错误处理：失败时返回明确错误码 | P0 | 待实现 |
| 4 | 改进 LLM 提示词：搜索无结果时让 LLM 改换查询策略 | P1 | 待实现 |
| 5 | 添加日志/监控：记录搜索失败原因，便于排查 | P2 | 待实现 |

---

## 技术方案决策

### A1: 降级策略改进
- **决策**：双保险（改回 `status:'error'` + guard 改进）
- **理由**：`status:'ok'` + `results:[]` 会让 guard 误判为死循环

### A4: 配置缺失处理
- **决策**：区分处理（配置缺失时返回明确提示）
- **理由**：用户需要知道如何配置搜索服务

### B1: 错误返回格式
- **决策**：区分配置缺失/搜索失败两种 error code
- **格式**：
  ```typescript
  // 配置缺失
  { status: 'error', errorDesc: 'SEARCH_NOT_CONFIGURED', content: '...' }
  
  // 搜索失败
  { status: 'error', errorDesc: 'SEARCH_FAILED', content: '...' }
  ```

### B2: checkSameResult 改进
- **决策**：空结果不计入 sameResult，改用 checkConsecutiveFailure
- **理由**：空结果是正常场景（搜索无结果），不应触发死循环检测

### B3: LLM 提示词注入
- **决策**：在 webSearchHandler 返回结果中注入提示
- **格式**：返回结果中包含 `suggestion` 字段，提示 LLM 改换查询策略

### B4: 配置缺失处理位置
- **决策**：在 webSearchHandler 中集中处理
- **理由**：错误处理逻辑集中在一处，便于维护

---

## 边界场景

| # | 场景 | 预期行为 | 当前行为 |
|---|------|----------|----------|
| C1 | API Key 未配置 | 返回明确提示："请在设置中配置搜索 API Key" | 返回死循环错误 |
| C2 | API Key 无效/过期 | 返回明确提示："API Key 无效，请检查配置" | 返回死循环错误 |
| C3 | 网络超时 | 返回明确提示："搜索超时，请稍后重试" | 返回死循环错误 |
| C4 | 搜索有结果但 LLM 重复查询 | LLM 应改换查询策略 | 触发死循环 |
| C5 | 搜索无结果（正常） | LLM 应如实告知用户"未找到相关信息" | 触发死循环 |
| C6 | 多引擎搜索某引擎失败 | 应返回明确错误 | 可能返回空结果 |

---

## 验收标准

| # | 验收项 | 验收方式 |
|---|--------|----------|
| AC1 | API Key 未配置时，返回明确配置引导提示 | 手动测试：清空配置 → 调用 web_search → 检查返回内容 |
| AC2 | API Key 无效时，返回明确错误提示 | 手动测试：填入无效 Key → 调用 web_search → 检查返回内容 |
| AC3 | 网络超时时，返回明确超时提示 | 手动测试：断网 → 调用 web_search → 检查返回内容 |
| AC4 | 搜索无结果时，不触发死循环 | 手动测试：搜索不存在的内容 → 检查 Agent 是否正常结束 |
| AC5 | 搜索有结果但 LLM 重复查询时，提示 LLM 改换策略 | 手动测试：搜索常见内容 → 观察 LLM 行为 |
| AC6 | 多引擎搜索失败时，返回明确错误 | 手动测试：配置不同引擎 → 验证错误处理 |
| AC7 | 所有现有测试通过 | 运行 `npm run test` |
| AC8 | 类型检查通过 | 运行 `npm run typecheck` |

---

## 影响范围

| 模块 | 文件 | 变更类型 |
|------|------|----------|
| 工具层 | `src/main/ai/tools/webSearchHandler.ts` | 错误处理改进 |
| 工具层 | `src/main/ai/tools/webSearch.ts` | 错误码定义 |
| Agent 层 | `src/main/ai/agent/agentLoopGuard.ts` | 检测逻辑改进 |
| Agent 层 | `src/main/ai/agent/agentLoop.ts` | 错误处理适配 |
| 类型层 | `src/shared/ai.ts` | 错误码类型定义 |

---

## 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 改动涉及多个模块 | 中 | 分模块测试，确保每个模块独立工作 |
| guard 检测逻辑改动可能影响其他工具 | 中 | 添加单元测试覆盖边界场景 |
| LLM 提示词注入可能影响搜索结果格式 | 低 | 保持返回格式兼容 |

---

## 下一步

1. 进入阶段 2：Plan 智能体规划实施计划
2. 按计划分模块实现
3. 运行测试验证
4. 更新文档
