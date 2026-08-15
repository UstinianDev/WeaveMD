# ph5-shared-foundation

> 第 5 期批次 1：shared 类型/常量/preload 契约（地基，必须先于批次 2/3）。

- 职责：`src/shared/ai.ts` 增 `EditBlockOp/SelectionRef/RewriteScope/RewriteRequestPayload/RewriteProposal`（见 docs/plan/ai-agent-panel-ph5.plan.md §2）；`src/shared/constants.ts` 增 `AI_REWRITE_PREVIEW`；`src/main/preload.ts` 增 `ai.rewritePreview(payload)`。
- SelectionRef 必须用文档序叶子下标 + 块内 offset（`startLeafIndex/startOffset/endLeafIndex/endOffset`），blockId 仅作渲染侧 UX 可选字段。
- 铁律：不改动既有类型语义；沿用 `IpcResponse<T>` 信封；不提交密钥。
- 测试：本批次仅类型/常量/契约，无需新增逻辑测试；typecheck 必须 0 error（作为批内自检）。
- 完成返回结构化摘要 `{完成项, 测试证据, 未完成项, 风险}`。
