# editor-table-refactor — 重构报告

## 前后对比

| 指标 | 重构前 | 重构后 |
|------|--------|--------|
| 文件数 | 1（TableBlock.tsx 386 行） | 3（tableHelpers 53 行 + useTableEvents 230 行 + TableBlock 154 行） |
| 最大文件行数 | 386 | 230 |
| 纯函数位置 | 组件内 | tableHelpers.ts（可独立测试） |
| 事件处理位置 | 组件内 | useTableEvents.ts（自定义 hook） |
| JSX 编排 | 混合逻辑 | TableBlock.tsx 纯渲染 |

## 应用的重构模式

1. **Extract Function → Extract Module**：纯函数提取到 `tableHelpers.ts`
2. **Extract Custom Hook**：事件处理 + refs/state 提取到 `useTableEvents.ts`
3. **Thin Orchestrator**：`TableBlock.tsx` 精简为纯 JSX 编排

## 每步测试结果

| 步骤 | 测试结果 |
|------|----------|
| 基线（重构前） | 40/40 通过 |
| 新建 tableHelpers.ts | — |
| 新建 useTableEvents.ts | — |
| 重写 TableBlock.tsx | 40/40 通过 |
| typecheck | 0 错误 |
| lint | 0 错误（10 warning 为既有） |
| E2E | 9/9 通过 |

## 不变项

- `onTableEdit(blockId, text, focus?)` 签名不变
- `data-cellkey` 格式 `"row:col"` 不变
- 手柄 `data-action` 值不变
- CSS 类名不变
- 无新增 `any` 类型
- `tableCodec.ts` 及内核集成点未修改
