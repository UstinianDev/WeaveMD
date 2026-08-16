# ph6-d-stretch — 第 6 期 stretch：editBlocks agent 工具

角色：fullstack-detail-dev | TDD strict | 分支 feat/ai-agent-ph3-ph4 | 依赖批次 1-4（KB 持久化已交付）

## 范围（plan.md §6 / §1 D + ph5 req Q2/Q5 边界）

- `src/shared/ai.ts`：`AgentRunPayload` / `AgentReqPayload` 增 `currentDocument?: string`（渲染侧 editorStore.content 快照，只读上下文）
- `src/main/ai/toolRegistry.ts`：
  - `defineCoreTools` 追加 `editBlocks`（OpenAI function schema：`{block_ops:{type:'array',items:{type:'object',properties:{block_id:{type:'string'},new_content:{type:'string'}},required:['block_id','new_content']}}, required:['block_ops']}`，description 注明「块级改写建议，仅产 proposal 不落盘」）
  - `ToolCtx` 增 `currentDocument?: string`
  - `executeTool` case 'editBlocks'：解析 block_ops（数组 + 每项 block_id/new_content 非空字符串，非法返回 error）；`ctx.currentDocument` 缺失 → `{status:'error', errorDesc:'editBlocks: 当前文档上下文未就绪'}`；合法 → 返回 `{status:'ok', content: JSON.stringify({applied:false, proposed:block_ops, documentSnapshotLength: ctx.currentDocument.length})}`（**只算不写，铁律一**）
  - **实现期决策**：主进程无块树内核（第 5 期 C2 已确认渲染侧 blockId 无法在主进程重建），故不做 block_id 存在性校验——仅结构校验 + 返回 proposal 文本。在代码注释注明此限制
- `src/main/ai/agentLoop.ts`：`AgentReqPayload` 增 `currentDocument?`；`toolsForIntent` 意图 `rewrite` 且 `currentDocument` 存在时提供 editBlocks（否则不提供，避免无上下文调用）；`toolCtx` 注入 `currentDocument: payload.currentDocument`
- `src/main/ai/ipc.ts`：AGENT_RUN 归一（AgentRunPayload → AgentReqPayload，ipc.ts:433-438）透传 `currentDocument: payload.currentDocument`
- `src/render/stores/agentStore.ts`：`sendAgentMessage` 载荷 `ai.runAgent` 增 `currentDocument: useEditorStore.getState().content` 快照（import editorStore；确认其 store 导出名与 content 字段）
- `tests/main/ai/toolRegistry.test.ts`：WRITE_NAMES 断言改造——`editBlocks` 移出「不含写工具」断言（`defineCoreTools` 现含 editBlocks）；新增用例：editBlocks 注册 + executeTool 仅产 proposal（`applied:false` 断言 + 未落盘断言，可 mock files/getFile 确认未被调用）+ 无 currentDocument 拒 + block_ops 非法参数拒
- 若 agentLoop.test.ts 有 toolsForIntent 断言，同步确认 rewrite 意图 + currentDocument 提供 editBlocks

## 铁律（不可违反）

- 铁律一：editBlocks 只产 proposal 不落盘——executeTool 无任何写盘/写库触发点；确认不 import 编辑器/块树内核；agentLoop 只把 currentDocument 作只读上下文
- 铁律二：不新增外发；editBlocks 不触发 consent 新语义
- SECURITY：无 dangerouslySetInnerHTML、无 any、无密钥
- **不做**渲染侧 proposal→预览→确认 应用闭环（第 5 期既有管线职责）；proposal 只作为 tool result 文本给 LLM

## 门禁

- `npm run typecheck` 0 error | 相关单测全绿 | `npm run lint` 0 error（8 warning 既有）
- 完成后主指挥会跑全量门禁（vitest 全量 + build + Playwright ai spec 14/14 回归）
- 只返回结构化摘要：{完成项, 测试证据, 未完成项, 风险}，禁止长篇汇报
