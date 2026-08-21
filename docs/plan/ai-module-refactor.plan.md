# AI 模块重构 — 实施计划

> Task: `ai-module-refactor` | 级别：L | 日期：2026-08-21

## 变更清单

### ① ipc.ts 按域拆分（771 行 → 6 文件）

**现状**：`src/main/ai/ipc.ts` 771 行，27 个 IPC handler + runChatFlow + 辅助函数全在一个文件。

**目标**：按业务域拆分为独立 handler 模块，主文件仅保留注册入口。

| 新文件 | 行数（估） | 内容 |
|--------|-----------|------|
| `src/main/ai/ipc/configConsentHandlers.ts` | ~100 | AI_GET/SET_CONFIG, AI_GET/SET_CONSENT, toIAIConfig, toIAIConsent |
| `src/main/ai/ipc/chatHandlers.ts` | ~140 | AI_CHAT, AI_CHAT_ABORT, runChatFlow, activeStreams 管理 |
| `src/main/ai/ipc/kbHandlers.ts` | ~180 | KB_LIST/IMPORT_FILE/IMPORT_DIR/REINDEX/DELETE/STATUS/GET_SETTINGS/SET_SETTINGS, importDirAsKb, reindexFromKbOrFile, kbIndexOpts |
| `src/main/ai/ipc/agentHandlers.ts` | ~100 | AGENT_RUN, AGENT_ABORT, AGENT_SKILLS_LIST |
| `src/main/ai/ipc/rewriteHandlers.ts` | ~50 | AI_REWRITE_PREVIEW |
| `src/main/ai/ipc/modelHandlers.ts` | ~30 | AI_LIST_MODELS |
| `src/main/ai/ipc/index.ts` | ~30 | registerAiIpcHandlers() 汇总入口，导入并调用各域注册函数 |
| `src/main/ai/ipc.ts` | 删除 | 替换为 ipc/ 目录 |

**共享依赖处理**：
- `activeStreams` Map → 移入 `chatHandlers.ts`（仅 chat 和 agent 使用，agent 通过参数传入）
- `toIAIConfig` / `toIAIConsent` → 移入 `configConsentHandlers.ts` 并 export，其他模块 import
- `sendStream` → 移入 `chatHandlers.ts`（仅 chat 使用）
- 各域注册函数签名：`registerXxxHandlers(deps?)`，无外部依赖的不传参

**IPC 测试文件**：`tests/main/ai/ipc.test.ts`（844 行）需同步更新 import 路径，但测试逻辑不变（仍测 `registerAiIpcHandlers` 入口）。

### ② agentStore.ts 提取 stream 逻辑（585 行 → ~450 行）

**现状**：`sendMessage`（~90 行）和 `sendAgentMessage`（~140 行）中 stream 订阅/退订/累积/结束逻辑几乎完全重复。

**目标**：提取共享 `createStreamManager` 工厂函数。

```ts
// src/render/stores/streamManager.ts（新文件，~80 行）
interface StreamManagerOptions {
  conversationId: string;
  onChunk: (delta: string) => void;
  onTool?: (evt: IAgentStreamToolEvent) => void;
  onDone: () => void;
  onError: () => void;
}
function createStreamManager(opts: StreamManagerOptions): {
  subscribe: () => void;
  unsubscribe: () => void;
}
```

- `sendMessage` 和 `sendAgentMessage` 各自提供回调，复用 streamManager
- agentStore 预估从 585 行降至 ~450 行
- 对外 API 不变（`useAgentStore` 导出、所有 action 签名不变）

### ⑤ llmClient.ts SSE 去重（265 行 → ~210 行）

**现状**：主循环（lines 143-196）和残余 buffer flush（lines 207-247）含相同 SSE JSON 解析 + tool-call 累积代码。

**目标**：提取 `processSseLines(lines, toolAcc)` 纯函数，两处复用。

```ts
interface SseProcessResult {
  chunks: StreamChunk[];
  hasFinishedToolCalls: boolean;
}
function processSseLines(
  lines: string[],
  toolAcc: Map<number, { name: string; arguments: string }>
): SseProcessResult
```

- 主循环和 buffer flush 均调用此函数
- `flushToolCalls` 已独立，保持不变
- 对外 API 不变（`streamChatCompletion` 签名、`StreamChunk` 类型）

### ⑥ db/kb.ts 死代码清理（276 行 → ~255 行）

**现状**：`encodeFloat32Array` / `decodeFloat32Array` 两个函数（lines 20-33）已无调用方（向量搜索已去除，仅 kbDao.test.ts 有 1 个测试用例）。

**目标**：
1. 删除 `encodeFloat32Array` / `decodeFloat32Array` 函数
2. 删除 `kb_chunks.vector` 列映射相关代码（`KbChunkRow.vector` 字段、`mapChunkRow` 中的 vector 映射、`InsertChunkInput.vector` 字段）
3. 更新 `kbDao.test.ts`：移除 `encodeFloat32Array` 测试用例

**注意**：DB schema 中 `kb_chunks.vector` 列保留（不改 schema），仅删除 DAO 层映射。

### ⑦ consent 逻辑统一

**现状**：
- 主进程 `consent.ts`：`needsConsent(_config, consent, _action)` → `!consent.allowNetwork`（忽略 config 和 action）
- 渲染进程 `agentStore.ts`：`needsConsent(config, consent, action)` → 有 null 检查 + agent 区分

**目标**：将 `needsConsent` 移入 `src/shared/ai.ts`（已有共享类型），统一签名：

```ts
export function needsConsent(consent: IAIConsent | null): boolean {
  return !consent?.allowNetwork;
}
```

- 主进程 `consent.ts` 删除 `needsConsent`，改为从 `@shared/ai` 导入
- 渲染进程 `agentStore.ts` 删除本地 `needsConsent`，改为从 `@shared/ai` 导入
- `needsKbSendConsent` 保留在主进程 `consent.ts`（仅 agentLoop 使用，无需共享）
- 渲染进程 `needsConsent` 的调用点需调整参数（去掉 config 和 action 参数）

## 执行顺序

1. **⑦ consent 统一**（最小改动，先统一共享基础）
2. **⑥ db/kb.ts 死代码清理**（独立删除，无依赖）
3. **⑤ llmClient.ts SSE 去重**（纯函数提取，独立模块）
4. **① ipc.ts 按域拆分**（最大改动，依赖 consent 已统一）
5. **② agentStore.ts 提取 stream 逻辑**（渲染侧，独立于主进程改动）

每步完成后运行 `npm run test` 确保全绿。

## 验收标准

| 检查项 | 命令 | 预期 |
|--------|------|------|
| 类型安全 | `npm run typecheck` | 0 error |
| 单元测试 | `npm run test` | 全部通过（~270 用例） |
| Lint | `npm run lint` | 0 error |
| 构建 | `npm run build` | 成功 |
| E2E | `npx playwright test` | AI spec 全绿（24 用例） |
| 行为不变 | 手动核对 | IPC 通道名、参数签名、store API 均不变 |
