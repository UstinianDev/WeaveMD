# ai-redesign-m1-infra — 基础设施：新增 ai.listModels IPC（主进程）

角色：fullstack-detail-dev | TDD standard | 分支 feat/ai-agent-ph3-ph4 | 需求 R17/R18/R19

## 范围（独立可跑，先行）

- `src/shared/constants.ts`：`IPC_CHANNELS` 增 `AI_LIST_MODELS: 'ai:list-models'`
- `src/main/ai/modelList.ts`（**新**）：`listModelsForUser(userId): Promise<string[]>` + 顶层导出纯函数 `normalizeModels(backend, json)`
  - ollama：`GET {ollamaBaseUrl}/api/tags` → `{models:[{name}]}` → name 数组（或对齐 `probeOllama` 用 OpenAI 兼容 `/v1/models` → `{data:[{id}]}`，二者取一，注意与 llmClient 现有调用一致）
  - remote：`GET {remoteBaseUrl}/models`（`Authorization: Bearer <decryptApiKey>`）→ `{data:[{id}]}` → id 数组
  - key 从 `getAiConfig(userId).apiKeyEnc` → `decryptApiKey` 解密，**绝不落渲染**；无 key → `[]`
  - `AbortSignal.timeout(8000)`；失败/非 200/半包 → `[]`（不抛不阻断）
- `src/main/ai/ipc.ts`：注册 `ipcMain.handle(AI_LIST_MODELS, ...)` 委托 `listModelsForUser`；失败 `{success:false, message}` 不阻断
- `src/main/preload.ts`：`WeaveMDApi['ai']` 增 `listModels: (userId) => Promise<IpcResponse<string[]>>` + 实现 `ipcRenderer.invoke(AI_LIST_MODELS, userId)`
- `src/render/utils/weaveMDBridge.ts`：mock bridge `ai` 域增 `listModels: async () => ({ success: true, data: ['qwen3.5:0.8b','deepseek-chat'] })`（浏览器/E2E 兜底）
- 测试：`tests/main/ai/modelList.test.ts`（**新**）：ollama/remote 解析、无 key→[]、fetch 抛错/非200→[]、normalizeModels 半包/错 shape→[]；mock global fetch

## 关键实现点

- 读 `src/main/db/ai.ts` 的 `getAiConfig`、`src/main/ai/secureConfig.ts` 的 `decryptApiKey`；仿 `llmClient.ts` 的 `probeOllama`（global fetch + AbortSignal.timeout 模式）
- preload 类型与 weaveMDBridge 实现必须同步，否则 tsc 报错
- SECURITY：key 只存主进程内存，不进响应体；SQL 无关

## 门禁

- `npm run typecheck` 0 error | `npx vitest run tests/main/ai/modelList.test.ts` 全绿 | `npm run lint` 0 error（本模块文件）
- 只返回结构化摘要：{完成项, 测试证据, 未完成项, 风险}
