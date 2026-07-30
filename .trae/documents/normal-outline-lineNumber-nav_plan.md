# Normal Mode 目录导航 off-by-one 修复计划

## 问题分析

### 问题一：点击一级标题却跳到二级标题（off-by-one）
**根因推测**：OutlinePanel 的 headingIndex（来自 `extractOutline` 深度优先遍历）与 EditorView 的 headingBlocks 索引（来自 `getAllBlocksInOrder` + filter）不一致。两个系统可能产生不同的 heading 列表顺序或数量。

### 问题二：底部 padding 不足
最后几个标题无法滚动到检测线位置，导致目录高亮不准确。

## 修复方案

### 核心思路：改用 lineNumber 导航（不再依赖索引映射）

OutlinePanel 的每个标题已包含 `lineNumber`（来自 `extractOutline`）。如果改用 lineNumber 作为导航标识，就完全消除了索引映射问题。

### 修改文件

#### 1. `blockTreeBuilder.ts` — 添加 `startLine` 到 BlockNode
- 构建块树时记录每个块的起始行号
- 修改 `createBlockNode` 接受额外的 `startLine` 参数
- BlockNode 接口添加可选 `startLine?: number` 字段

#### 2. `OutlinePanel.tsx` — 传递 lineNumber 到导航回调
- 修改 `onNavigateToHeading` 类型为 `(lineNumber: number, headingIndex: number) => void`
- 点击时传递 `item.lineNumber`

#### 3. `EditorView.tsx` — 使用 lineNumber 查找块
- 添加 `findBlockByLineNumber` 辅助函数
- 导航时用 lineNumber 精确找到目标块

#### 4. `EditorScrollContainer.tsx` — 增加底部 padding
- 从 300px 增加到 400px

## 验证步骤
1. `npm run typecheck`
2. `npm run lint`
3. 手动测试：
   - 点击 H1 → 正确跳到 H1
   - 点击 H2 → 正确跳到 H2
   - 滚动到底部 → 最后一个标题正确高亮