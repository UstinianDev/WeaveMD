# editor-table-refactor — 需求文档

> 重构编辑主区表格代码，**不可改变现有功能**。

## 1. 目标

将 `TableBlock.tsx`（386 行单组件）拆分为职责清晰的模块，提升可读性与可测试性。

## 2. 范围

| 文件 | 行数 | 动作 |
|------|------|------|
| `TableBlock.tsx` | 386 | 拆分（主重构目标） |
| `tableCodec.ts` | 127 | **不动**（已是纯函数，结构良好） |
| 内核集成点（blockTree/types/markdownToState/stateToMarkdown/syntaxType/selection/index） | 薄接口 | **不动** |
| CSS（globals.css） | ~80 行表格样式 | **不动** |
| 测试文件（3 个） | 1053 行 | **不删不改**，重构后必须全部通过 |

## 3. 已对齐问题

### 3.1 TableBlock.tsx 代码气味

1. **大类**：386 行单组件，混合纯函数、DOM 操作、事件处理、JSX 渲染
2. **组件内纯函数**：`applyCellText`、`byIndex`、`TEXT_INPUT_TYPES` 无组件依赖，应提取
3. **事件处理集中**：`handleCellInput`/`handleNativeBeforeInput`/`handleCellKeyDown`/`cellEvents` 依赖多个 ref，可抽取为自定义 hook
4. **JSX 重复**：header cell（+列手柄）与 body cell（+行手柄）结构相似，手柄逻辑内联在 JSX 中
5. **类型内联**：`CellPos`、`TableCellEl` 定义在组件文件内

### 3.2 不动的部分

- `tableCodec.ts`：纯函数、互逆不变量、独立正则，结构已最优
- 内核集成点：`makeTable`、`parseTable`、`serializeBlock` 等均为薄接口
- 所有测试：不删不改，重构后必须全部通过（40 个测试 + E2E）
- 外部 API：`onTableEdit(blockId, text, focus?)` 签名不变

## 4. 验收标准

1. **行为不变**：现有 40 个单测 + E2E 全部通过
2. **拆分合理**：`TableBlock.tsx` 主文件 ≤ 120 行（仅 JSX 编排）
3. **类型安全**：无新增 `any`
4. **测试可达**：提取的纯函数/工具可独立测试（现有测试已覆盖）
5. **无功能回退**：转义、导航、增删行列、IME、撤销均正常
