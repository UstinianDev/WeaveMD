# AI 模块重构报告

> Task: `ai-module-refactor` | 日期：2026-08-21 | 级别：L

## 重构摘要

对 AI 模块主进程层和渲染进程状态层进行了 5 项结构重构，不改变任何现有功能。

## 变更清单

### ⑦ consent 逻辑统一

| 文件 | 变更 |
|------|------|
| `src/shared/ai.ts` | 新增 `needsConsent(consent)` 统一函数 |
| `src/main/ai/consent.ts` | 删除本地 `needsConsent`，re-export from `@shared/ai` |
| `src/render/stores/agentStore.ts` | 删除本地 `needsConsent`，import from `@shared/ai` + re-export |
| `src/render/stores/rewriteStore.ts` | 调用简化 `needsConsent(consent)`，移除无用 `config` 解构 |
| `src/main/ai/ipc.ts` | 调用简化 `needsConsent(consent)` |
| `src/main/ai/agentLoop.ts` | 调用简化 `needsConsent(consent)` |
| `tests/main/ai/consent.test.ts` | 更新为统一签名测试 |
| `tests/render/stores/agentStore.test.ts` | 更新为统一签名测试 |

### ⑥ db/kb.ts 死代码清理

| 文件 | 变更 |
|------|------|
| `src/main/db/kb.ts` | 删除 `encodeFloat32Array`/`decodeFloat32Array`；移除 `vector` 字段映射 |
| `src/main/ai/kbIndexer.ts` | 移除 `insertChunk` 调用中的 `vector: null` |
| `tests/main/db/kbDao.test.ts` | 移除 `encodeFloat32Array` 导入和测试 |
| `tests/main/db/utilsFloat.test.ts` | **删除**（废弃测试文件） |

### ⑤ llmClient.ts SSE 去重

| 文件 | 变更 |
|------|------|
| `src/main/ai/llmClient.ts` | 提取 `processSseLines()` + `SseJsonShape` 类型；主循环和残余 buffer flush 复用 |

### ① ipc.ts 按域拆分

| 文件 | 行数 | 内容 |
|------|------|------|
| `src/main/ai/ipc.ts` | 6 | 薄 re-export（保持导入路径兼容） |
| `src/main/ai/ipc/shared.ts` | 52 | 共享工具（toIAIConfig/toIAIConsent/activeStreams/sendStream/默认值） |
| `src/main/ai/ipc/configConsentHandlers.ts` | 93 | AI 配置 + 知情同意（4 个 handler） |
| `src/main/ai/ipc/chatHandlers.ts` | 186 | 对话 CRUD + 流式聊天 + abort（8 个 handler + runChatFlow） |
| `src/main/ai/ipc/kbHandlers.ts` | 185 | 知识库导入/检索/设置（8 个 handler + 辅助函数） |
| `src/main/ai/ipc/agentHandlers.ts` | 100 | Agent 运行/中断/技能列表（3 个 handler） |
| `src/main/ai/ipc/rewriteHandlers.ts` | 43 | 改写预览（1 个 handler） |
| `src/main/ai/ipc/modelHandlers.ts` | 27 | 模型列表（1 个 handler） |
| `src/main/ai/ipc/index.ts` | 23 | 注册入口（汇总 6 个域模块） |

### ② agentStore.ts 提取 stream 逻辑

| 文件 | 变更 |
|------|------|
| `src/render/stores/agentStore.ts` | 提取 `createStreamManager()` 工厂函数；`sendMessage`/`sendAgentMessage` 复用 stream 订阅/退订/累积/结束逻辑 |

## 前后对比

| 指标 | 重构前 | 重构后 |
|------|--------|--------|
| `ipc.ts` 行数 | 771 | 6（re-export）+ 609（拆分到 7 个模块） |
| `agentStore.ts` 行数 | 585 | ~500（提取 streamManager） |
| `llmClient.ts` 行数 | 265 | ~230（SSE 去重） |
| `db/kb.ts` 行数 | 276 | ~240（死代码清理） |
| 共享 consent 函数 | 2 份（语义不同） | 1 份（`@shared/ai`） |
| 测试文件数 | 114 | 113（删除 utilsFloat.test.ts） |
| 测试用例数 | 1499 | 1489（移除 10 个废弃用例） |

## 门禁结果

| 检查项 | 命令 | 结果 |
|--------|------|------|
| 类型安全 | `tsc --noEmit` | ✅ 0 error |
| 单元测试 | `vitest run` | ✅ 113 files / 1489 tests passed |
| Lint | `eslint` | ✅ 0 error（13 warnings 为既有） |
| 构建 | `vite build` | ✅ renderer + main + preload 成功 |

## 应用的重构模式

- **Extract Function**：`processSseLines`（llmClient）、`createStreamManager`（agentStore）
- **Move to Shared Module**：`needsConsent`（consent → shared/ai）
- **Split Large Module**：ipc.ts → 6 个域 handler + shared + index
- **Dead Code Removal**：float32 BLOB 工具、vector 字段映射
- **Re-export Pattern**：ipc.ts 薄 re-export 保持导入路径兼容
