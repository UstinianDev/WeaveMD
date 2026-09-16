---
name: s4-md5-xxhash-migration
description: S4 — MD5 → xxHash 迁移：hashUtil.ts 接口设计、替换文件清单、agentLoopGuard 不可动、fallback 模式
metadata:
  type: project
---

# S4 — MD5 → xxHash 迁移

实施日期：2026-09-16 | 状态：已完成

**Why:** 性能优化批次 1 的子任务，将 staleness detection 和渲染进程哈希从 MD5/djb2 统一为 xxHash64（WASM 实现），减少哈希计算开销。

**How to apply:** 后续新增 staleness detection 或渲染进程哈希应使用 `@shared/utils/hashUtil`，而非 `crypto.createHash('md5')` 或自写 djb2。

## 接口设计

### `src/shared/utils/hashUtil.ts`

```
xxHash64(input: string): Promise<string>   // WASM 懒加载，返回 16 位 hex
xxHash64Sync(input: string): string        // WASM 就绪 → h64ToString；否则 → djb2 fallback（永不抛异常）
```

- WASM 未就绪时 `xxHash64Sync` 降级为 8 位 djb2 hex（非密码学用途）
- 异步版本首次调用触发 WASM 加载；同步版本利用缓存 WASM API
- 模块级 `api` + `initPromise` 双重锁避免重复加载

## 替换文件清单（6+1 个）

| 文件 | 原调用 | 新调用 |
|------|--------|--------|
| `src/main/ai/tools/editBlocksHandler.ts:47` | `createHash('md5')` | `xxHash64Sync` |
| `src/main/ai/tools/previewFileRevision.ts:71` | `createHash('md5')` | `xxHash64Sync` |
| `src/main/ai/tools/previewPatchFilesHandler.ts:27` | `createHash('md5')` | `xxHash64Sync` |
| `src/render/stores/rewriteStore.ts` | `simpleHash` (djb2) | `xxHash64Sync`（export `simpleHash` 为兼容别名） |
| `src/render/components/AIAgent/cards/DiffSummaryCard.tsx:258` | `simpleHash` | `xxHash64Sync` |
| `src/shared/utils/hashUtil.ts` | 新建 | — |
| `tests/shared/hashUtil.test.ts` | 新建 | 11 个 TDD 用例 |

## 绝对不动

- `src/main/ai/agent/agentLoopGuard.ts` — 死循环检测 MD5 保留（数据量小，风险 > 收益）
- `src/main/ai/knowledge/knowledgeHelperCache.ts` — 缓存键 MD5 保留（不在 S4 范围）

## 向后兼容

`rewriteStore.ts` 保留 `export const simpleHash = xxHash64Sync;`，外部 import `{ simpleHash }` 不受影响（已标记 `@deprecated`）。

## 相关记忆

- [[renderer-batch5-closing]] — 渲染批次 5 中 rewriteStore 的原始 simpleHash 实现
- [[agent-perf-optimize-plan]] — 总体性能优化计划