# AI 模块重构 — 需求文档

> Task: `ai-module-refactor` | 日期：2026-08-21 | 级别：L

## 1. 目标

对 AI 模块的主进程层和渲染进程状态层进行结构重构，消除代码异味，**不改变任何现有功能**。

## 2. 范围

### 2.1 在范围内

| # | 目标 | 文件 | 当前行数 | 问题 |
|---|------|------|----------|------|
| ① | ipc.ts 按域拆分 | `src/main/ai/ipc.ts` | 771 | 27 个 IPC handler 混在一个文件，config/consent/chat/agent/KB/rewrite/model 全部耦合 |
| ② | agentStore.ts 拆分 | `src/render/stores/agentStore.ts` | 585 | 30+ 字段、chat/agent/KB/consent 四域合一；sendMessage/sendAgentMessage stream 逻辑重复 |
| ⑤ | llmClient.ts SSE 去重 | `src/main/ai/llmClient.ts` | 265 | 主循环和残余 buffer flush 两处含相同 SSE JSON 解析 + tool-call 累积代码 |
| ⑥ | db/kb.ts 死代码清理 | `src/main/db/kb.ts` | 276 | encodeFloat32Array/decodeFloat32Array 向量 BLOB 工具已无调用方（向量搜索已去除） |
| ⑦ | consent 逻辑统一 | `src/main/ai/consent.ts` + `src/render/stores/agentStore.ts` | 32+585 | 主进程 needsConsent 参数被忽略；渲染进程 needsConsent 有独立语义；两份逻辑可能漂移 |

### 2.2 不在范围内

- UI 组件（ModelForm、AIPanelComposer、AIAgentPanel 等）
- 渲染进程 rewrite 模块（blockEdit、selectionExport、highlight）
- 数据库 schema 变更
- IPC 通道常量变更（`src/shared/constants.ts`）
- 共享类型变更（`src/shared/ai.ts`）

## 3. 验收标准

1. **功能零回归**：所有现有测试（22 个 AI 测试文件、~270 用例）全部通过
2. **类型安全**：`tsc --noEmit` 零错误
3. **Lint 清洁**：ESLint 零 error
4. **构建成功**：`vite build` 通过
5. **E2E 通过**：`npx playwright test` AI 相关 spec 全绿（24 用例）
6. **行为不变**：IPC 通道名称、参数签名、返回值类型均不变；Zustand store 对外 API 不变
7. **代码质量**：拆分后单文件不超过 300 行；消除已识别的重复代码

## 4. 已对齐问题

- 测试覆盖充分（22 文件、~270 用例），可作为重构基线
- IPC 通道常量和共享类型不在范围内，避免接口变更风险
- UI 组件明确排除，降低渲染层回归风险
