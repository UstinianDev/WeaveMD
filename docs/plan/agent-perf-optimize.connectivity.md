# Phase 1 Connectivity Validation Report

> Generated: 2026-09-16 | Scope: agent-perf-optimize Phase 1 (StreamingToolExecutor + concurrencyDefs + searchCache + xxHash migration)

---

## Summary

Phase 1 introduces 5 cross-module call chains. Four are structurally sound with minor concerns; **Chain 1 has a critical data-flow gap** where `StreamingToolExecutor.waitForAll()` bypasses force_confirm checks. The streaming path will execute `deleteFile`/`deleteLocalFile` without user confirmation -- a security regression relative to the fallback `executeToolRound` path.

---

## Chain 1: agentLoop -> StreamingToolExecutor -> agentToolExecutor

### Status: BROKEN

**Critical flaw**: `waitForAll()` executes ALL queued tools (including `FORCE_CONFIRM_TOOLS`) but `processStreamingToolRound` expects unexecuted tools to remain in the queue for its force_confirm loop.

| Interface | Caller | Callee | Verdict |
|-----------|--------|--------|---------|
| constructor | `new StreamingToolExecutor(ctx, round)` | `constructor(ctx: AgentContext, round: number)` | PASS |
| onToolCall | `executor.onToolCall(tc)` with `{index, name, arguments}` | `onToolCall(tc: StreamingToolCall)` same shape | PASS |
| waitForAll | `executor.waitForAll()` | returns `Promise<ToolExecResult[]>` | PASS |
| executeOneTool | `executeOneTool(tool.tc, this.round, this.ctx)` | `executeOneTool(tc: {index,name,arguments}, round, ctx)` | PASS |
| **force_confirm path** | `processStreamingToolRound` L460-537 | `executor.waitForAll()` L146-152 | **BROKEN** |

**Root cause**:

In `StreamingToolExecutor.waitForAll()` (L144-L152), the queued tools are all executed:
```typescript
const queued = this.tools.filter((t) => t.status === 'queued');
for (const tool of queued) {
  if (this.aborted) continue;
  await this.executeTracked(tool);   // <-- executes deleteFile WITHOUT confirmation
}
```

Then in `processStreamingToolRound` (L456):
```typescript
const needExecution = dedupedToolCalls.filter((tc) => !executedIndices.has(tc.index));
// needExecution is ALWAYS empty -- all tools already executed
```

The force_confirm loop at L476-533 (which handles `deleteFile`/`deleteLocalFile` confirmation dialogs) and the ask_question_card pre-validation at L463-473 are unreachable dead code.

**Impact**: `deleteFile` and `deleteLocalFile` will execute immediately without the user consent dialog when `STREAMING_TOOL_EXEC_ENABLED=true` (current default). This is a security regression.

**Fix (3 options)**:

*Option A (Recommended - minimal, targeted)*: Skip `FORCE_CONFIRM_TOOLS` in `waitForAll()`. Pass a skip-set:
```typescript
// StreamingToolExecutor.ts
async waitForAll(skipToolNames?: Set<string>): Promise<ToolExecResult[]> {
  // ...
  const queued = this.tools.filter((t) => 
    t.status === 'queued' && !skipToolNames?.has(t.tc.name)
  );
  // ...
}
```
In `processStreamingToolRound`:
```typescript
const executorResults = await executor.waitForAll(FORCE_CONFIRM_TOOLS);
// force_confirm tools remain in 'queued', picked up by needExecution
```

*Option B*: Move force_confirm interceptor into `StreamingToolExecutor` via a callback parameter in the constructor:
```typescript
constructor(ctx, round, preExecHook?: (tc: StreamingToolCall) => Promise<boolean>)
```

*Option C*: In `processStreamingToolRound`, extract force_confirm tool indices from the accumulator BEFORE calling `waitForAll()`, and revert their status back to 'queued' after `waitForAll()` returns.

**Also verify** (post-fix):
- `getCompletedResults()` Generator is tested but unused in production path -- not a bug, but verify it's intentionally unused.
- The `abortAll()` path in `waitForAll` skips remaining queued tools (L147-149). After the fix, verify that aborted force_confirm tools produce `{ cancelled: true }` results (currently they produce nothing).

---

## Chain 2: agentToolExecutor -> concurrencyDefs (partition logic)

### Status: PASS

| Interface | Caller | Callee | Verdict |
|-----------|--------|--------|---------|
| isToolConcurrencySafe | `isToolConcurrencySafe(tc.name, safeParseArgs(tc.arguments))` L257 | `isToolConcurrencySafe(name: string, args: Record<string, unknown>): boolean` | PASS |
| safeParseArgs | `safeParseArgs(tc.arguments: string)` L257 | `safeParseArgs(args: string): Record<string, unknown>` | PASS |
| re-export | `export { isToolConcurrencySafe } from './concurrencyDefs'` L11 | Used by `executeToolRound` L257 | PASS |

**Detail**: The partition at `agentToolExecutor.ts` L253-262 replaces `READ_ONLY_TOOLS.has(tc.name)` with `isToolConcurrencySafe(tc.name, safeParseArgs(tc.arguments))`. The old `READ_ONLY_TOOLS` Set is preserved in `agentToolSelector.ts` (line 18) as a re-export -- no existing caller is broken. The tests in `concurrencyDefs.test.ts` cover all 24 tools + unknown tools, verifying both TOP10=true and write=false.

**Risk (low)**: `safeParseArgs` returns `{}` on JSON parse failure. For unknown tools this correctly triggers fail-closed (return false). For TOP10 tools (all `defaultSafe: true`, no `checkArgs`), parse failure still returns true -- this is correct because TOP10 tools are stateless reads that don't depend on args for safety.

---

## Chain 3: kbSearch -> searchCache -> kbIndexer (searchMode + chunk-level invalidation)

### Status: PASS

| Interface | Caller | Callee | Verdict |
|-----------|--------|--------|---------|
| getSearchCacheKey | `getSearchCacheKey(userId, query, opts)` kbSearch L443 | `getSearchCacheKey(userId, query, opts: SearchCacheKeyOpts)` | PASS |
| setCachedSearchResult | `setCachedSearchResult(cacheKey, response)` kbSearch L664 | `setCachedSearchResult(key, response: IKbSearchDetailedResponse)` | PASS |
| invalidateKbSearchCache (chunk) | `invalidateKbSearchCache({ type: 'chunk', chunkId })` kbIndexer L218 | `invalidateKbSearchCache(scope: InvalidateScope)` | PASS |
| invalidateKbSearchCache (user) | `invalidateKbSearchCache(userId)` kbIndexer L220 | Backward compat: `invalidateKbSearchCache(scope: string)` clears all | PASS |
| re-export path | `kbSearch.ts` L36: `export { invalidateKbSearchCache } from './searchCache'` | `kbIndexer.ts` L18: `import { invalidateKbSearchCache } from './kbSearch'` | PASS |

**Detail**: The `searchMode` field is included in cache keys at `searchCache.ts` L123. Calling code in `kbSearch.ts` L443 passes `opts` which includes `searchMode` (default `'hybrid'`). The chunk-level invalidation uses the `chunkIdToCacheKeys` index registered in `setCachedSearchResult` (L203-215), which iterates `response.results` and `response.best`.

**Suggestion**: `SearchCacheKeyOpts` (searchCache.ts L104) and `KbSearchOptions` (kbSearch.ts) are two separate interfaces. If `KbSearchOptions` adds a new field that should distinguish cache entries, the cache key won't reflect it unless `SearchCacheKeyOpts` is manually updated. Consider making `SearchCacheKeyOpts` extend a subset of `KbSearchOptions` or have `kbSearch.ts` import the type from `searchCache.ts`.

---

## Chain 4: editBlocksHandler / previewFileRevision / previewPatchFilesHandler -> hashUtil (MD5 -> xxHash)

### Status: PASS

| Interface | Caller | Callee | Verdict |
|-----------|--------|--------|---------|
| editBlocksHandler | `xxHash64Sync(ctx.currentDocument)` L47 | `xxHash64Sync(input: string): string` | PASS |
| previewFileRevision | `xxHash64Sync(oldContent)` L71 | `xxHash64Sync(input: string): string` | PASS |
| previewPatchFilesHandler | `xxHash64Sync(p.oldContent)` L27 | `xxHash64Sync(input: string): string` | PASS |
| rewriteStore | `xxHash64Sync(currentContent)` L265/290/326 | `xxHash64Sync(input: string): string` | PASS |
| DiffSummaryCard | `xxHash64Sync(currentContent)` L259 | `xxHash64Sync(input: string): string` | PASS |
| backward compat alias | `export const simpleHash = xxHash64Sync` rewriteStore L26 | N/A | PASS |

**Detail**: All 5 call sites pass `string` values. The `djb2` fallback is self-contained (no external deps). The WASM lazy-init pattern is thread-safe: `ensureInit()` uses a module-level `initPromise` to deduplicate concurrent loads.

**Pre-existing concern (not introduced by Phase 1)**: `editBlocksHandler.ts` L47 accesses `ctx.currentDocument` without null check; L53 accesses `ctx.currentDocument.length`. If `currentDocument` is undefined, both lines would throw. This pattern predates the hash migration (L53's `documentSnapshotLength` field existed before). Not a Phase 1 regression, but worth noting.

**TypeScript strictness**: `hashUtil.ts` has no `any` types, uses proper import types from `xxhash-wasm`, and the fallback `djb2Hash` returns a typed `string`. PASS.

---

## Chain 5: agentLoop streaming path -> processStreamingToolRound (behavior preservation)

### Status: AT RISK (depends on Chain 1 fix)

| Interface | Caller | Callee | Verdict |
|-----------|--------|--------|---------|
| processStreamingToolRound | `agentLoop.ts` L296-298 | `processStreamingToolRound(ctx, executor, accumulatedToolCalls, assistantContent, round, deps)` | PASS |
| ask_question_card dedup | L416-432 | Same logic as `executeToolRound` L216-234 | PASS |
| handleToolResult call | L547 | `handleToolResult(entry, ctx, round, thinkingText, deps, toolTurn, executionSegments)` | PASS |
| ask_question_card wait | L552-574 | Uses `deps.waitForInteraction()` | PASS (but unreachable for executor-executed tools) |
| force_confirm | L476-533 | Uses `FORCE_CONFIRM_TOOLS.has(tc.name)` + `deps.onInteractionRequired` | PASS (interface correct, logic unreachable per Chain 1 bug) |

**Detail**: The `processStreamingToolRound` function correctly replicates the behavior of `executeToolRound`:
- ask_question_card deduplication (identical filter logic)
- inert `tool_calls` assistant message with `role: 'assistant'`, `content: ''`, `tool_calls: [...]`
- Dead loop detection via `handleToolResult` (which calls `ctx.detector.checkSameResult` and `checkConsecutiveFailure`)
- Interaction pause using `deps.waitForInteraction` (L552-574)

**Post-Chain-1-fix verification**: After fixing the `waitForAll` force_confirm bypass, verify:
1. `needExecution` correctly captures force_confirm tools (non-empty).
2. The `FORCE_CONFIRM_TOOLS.has(tc.name)` guard at L476 correctly gates the confirmation dialog.
3. Cancelled deletions produce `{ cancelled: true }` results that `handleToolResult` surfaces as error events.
4. The `deadLoopBreak: true` return from `handleToolResult` at L548 correctly breaks the agent loop.

---

## Architecture Alignment

- CONVENTIONS: All new files follow camelCase/PascalCase naming. Import ordering in `StreamingToolExecutor.ts` follows the prescribed order. PASS.
- SECURITY: No hardcoded secrets. The `xxHash64Sync` is non-cryptographic -- appropriate for staleness detection. PASS for hash usage. FAIL for the confirm-bypass in Chain 1.
- TypeScript: No `any` types found in new code. `hashUtil.ts`, `concurrencyDefs.ts`, `StreamingToolExecutor.ts` all use specific types. PASS.
- State management: No new stores introduced. Existing `rewriteStore` only has import change. PASS.
- IPC: No new IPC channels. Existing flow unchanged. PASS.
- Error handling: `StreamingToolExecutor.executeTracked` has a `.catch` handler (L216-229). `agentLoop.ts` wraps checkpoint writes in try/catch. PASS.

---

## Integration Points Check

| From | To | Assessment |
|------|----|------------|
| `agentLoop` (L189, L296) | `StreamingToolExecutor` | Constructor + waitForAll OK. Force_confirm gap. |
| `StreamingToolExecutor` (L202) | `agentToolExecutor.executeOneTool` | Signature match confirmed. |
| `StreamingToolExecutor` (L20) | `concurrencyDefs` | Both imports correct. |
| `agentToolExecutor` (L10, L257) | `concurrencyDefs` | Partition correctly uses `isToolConcurrencySafe`. |
| `agentToolSelector` (L11) | `concurrencyDefs` | Re-export confirmed. |
| `kbSearch` (L21-23, L443, L662-664) | `searchCache` | All 3 exports used. `searchMode` in cache key. |
| `kbIndexer` (L18, L218, L220) | `kbSearch` (re-exports `searchCache`) | Import chain intact. |
| `editBlocksHandler` (L1, L47) | `hashUtil` | Import + call match. |
| `previewFileRevision` (L71) | `hashUtil` | Import + call match. |
| `previewPatchFilesHandler` (L27) | `hashUtil` | Import + call match. |
| `rewriteStore` (L18, L26, L265, L290, L326) | `hashUtil` | Import + alias + 3 call sites match. |
| `DiffSummaryCard` (L18, L259) | `hashUtil` | Import + call match. |

---

## Test Alignment

| Test | Coverage | Status |
|------|----------|--------|
| `streamingToolExecutor.test.ts` (14 tests) | State machine, concurrency, ordering, abort, errors | PASS. Covers all major paths. |
| `concurrencyDefs.test.ts` (8 tests) | All 24 tools, TOP10, fail-closed, unknown tools | PASS. |
| `searchCache.test.ts` | Added (git status shows new file) | To verify. |
| `hashUtil.test.ts` | Added (git status shows new file) | To verify. |
| `tests/main/ai/ipc.test.ts` | Modified (git status) | To verify. |

**Gap**: The force_confirm bypass in `waitForAll()` is NOT covered by existing tests. The streaming test file mocks `executeOneTool` but never tests the `processStreamingToolRound` integration. Add a test that verifies `FORCE_CONFIRM_TOOLS` are NOT executed by `waitForAll()`.

---

## Requirements Traceability

| Requirement | Implemented In | Status | Notes |
|-------------|---------------|--------|-------|
| S1: 流式推测执行工具 | `StreamingToolExecutor.ts` | WARN | Core logic correct; force_confirm path broken |
| S2: per-invocation 并发安全 | `concurrencyDefs.ts` + `agentToolExecutor.ts` L253-262 | PASS | |
| S3: 缓存分级失效 | `searchCache.ts` L127-185 | PASS | chunk/user/all scopes |
| S4: MD5 -> xxHash 迁移 | `hashUtil.ts` + 5 call sites | PASS | |
| ask_question_card 去重保留 | `processStreamingToolRound` L416-432 | PASS | |
| force_confirm 拦截保留 | `processStreamingToolRound` L476-533 | BROKEN | Unreachable due to waitForAll pre-execution |
| dead loop 检测保留 | `handleToolResult` via `processStreamingToolRound` L547 | PASS | |
| checkpoint 增量写入 | `agentLoop.ts` L311-331 | PASS | |