# ph6-b1-foundation — 第 6 期批次 1：shared 地基

角色：fullstack-detail-dev | TDD strict | 分支 feat/ai-agent-ph3-ph4

## 范围（plan.md §1 组 A，必须先于 B/C）

- `src/shared/constants.ts`：`IPC_CHANNELS` 增 `KB_GET_SETTINGS:'kb:get-settings'` / `KB_SET_SETTINGS:'kb:set-settings'`（置 KB_STATUS 后）
- `src/shared/ai.ts`：增 `DEFAULT_KB_SETTINGS` 常量 + `normalizeKbSettings(partial?):IKbSettings`（合并默认兜底；IKbSettings 已存在于同文件 :208-221）
- `src/main/preload.ts`：`WeaveMDApi['kb']` 类型（:132-143）+ 实现（:297-304）各增 `getSettings(userId:string):Promise<IpcResponse<IKbSettings>>` / `setSettings(input:{userId:string;settings:IKbSettings}):Promise<IpcResponse<IKbSettings>>`
- `src/render/utils/weaveMDBridge.ts`：`createNoopWeaveMDApi()` kb 块（:652-659）补 `getSettings: async () => ({ success: false })` / `setSettings: async () => ({ success: false })`（强类型 WeaveMDApi，不补 typecheck 挂）
- `tests/setup.ts`：window.weaveMD mock kb 块（:71-78）补 `getSettings: vi.fn()` / `setSettings: vi.fn()`

## 铁律

- 本批只加契约/常量/默认值，不改业务行为；不新增 SQL/网络/外发
- 无 any；import 顺序遵守 CONVENTIONS

## 门禁

- `npm run typecheck` 0 error | `npm run test` 全绿（增量后 89 files+）
- 只返回结构化摘要：{完成项, 测试证据, 未完成项, 风险}
