# Debug Plan: 目录点击导航失效 + 动态高亮

## 问题现象

点击目录的 n 级标题，编辑主区内容未跟随移动，且无动态高亮。

## 根因分析（假设）

### 假设 1（CRITICAL）：Block ID 不匹配

`generateBlockId()` 使用模块级 `_idCounter`（全局递增）+ 随机后缀：

```ts
// blockTree.ts L21
let _idCounter = 0;
// L111-121
export function generateBlockId(tree: BlockTree): BlockId {
  _idCounter += 1;
  let id: BlockId;
  do {
    const suffix = Math.random().toString(36).slice(2, 6);
    id = `${_idCounter}_${suffix}`;
  } while (tree.blocks[id] !== undefined);
  return id;
}
```

`MainPage` 和 `EditorView` 各自独立调用 `buildBlockTree(content)`，生成**不同的 Block ID**：
- [MainPage.tsx#L60](file:///d:/software/WeaveMD/src/render/pages/MainPage.tsx#L60): `buildBlockTree(content)` → ID 如 `"5_abc1"`
- [EditorView.tsx#L112](file:///d:/software/WeaveMD/src/render/components/Editor/EditorView.tsx#L112): `buildBlockTree(initialContent)` → ID 如 `"7_xyz9"`

DOM 中的 `data-block-id` 来自 EditorView 的 blockTree，而 `handleNavigateToLine` 用 MainPage 的 blockTree 查找 blockId，导致 `document.querySelector('[data-block-id="..."]')` **找不到元素**，`scrollToBlock` 静默失败。

### 假设 2（SECONDARY）：行号偏移

`buildBlockTree` **跳过空行**：

```ts
// blockTreeBuilder.ts L398-401
if (isBlankLine(line)) {
  index += 1;
  continue;
}
```

但 `extractOutline` 使用 remark-parse，返回**包含空行的真实行号**。`findBlockByLineNumber` 用 `sourceLines.length` 累加，不计空行，导致行号映射偏移。

### 假设 3（FEATURE GAP）：无动态高亮

当前 OutlinePanel 无滚动监听，无法高亮当前可见标题。

## 修复方案

### 核心思路：消除 MainPage 独立 blockTree，改用 heading 索引导航

不再通过行号映射 blockId，而是通过**标题序号**直接匹配：
- `extractOutline` 返回的标题按文档顺序排列
- `getAllBlocksInOrder` 中的 heading block 也按文档顺序排列
- 第 N 个标题项 ↔ 第 N 个 heading block

### 步骤 1：EditorView 暴露 navigateToHeading 接口

**文件**: [EditorView.tsx](file:///d:/software/WeaveMD/src/render/components/Editor/EditorView.tsx)

- 将 `onScrollToBlockReady` 改为 `onNavigateReady`，暴露 `navigateToHeading(headingIndex: number)` 函数
- 内部逻辑：遍历 `getAllBlocksInOrder(blockTree)`，过滤 `type === 'heading'` 的 block，取第 `headingIndex` 个，调用 `scrollContainerRef.current.scrollToBlock(blockId)`
- 这样使用 EditorView **自己的** blockTree，Block ID 必然匹配 DOM

### 步骤 2：OutlinePanel 改用 headingIndex 导航

**文件**: [OutlinePanel.tsx](file:///d:/software/WeaveMD/src/render/components/Editor/OutlinePanel.tsx)

- `onNavigateToLine` → `onNavigateToHeading(headingIndex: number)`
- 渲染 outline 时给每个标题项分配一个全局序号（depth-first 遍历的递增索引）
- 点击时传递序号

### 步骤 3：MainPage 移除独立 blockTree，改用 navigateToHeading

**文件**: [MainPage.tsx](file:///d:/software/WeaveMD/src/render/pages/MainPage.tsx)

- 删除 `blockTree` state、`buildBlockTree` import、`findBlockByLineNumber` import、content sync useEffect
- `handleNavigateToLine` → `handleNavigateToHeading(headingIndex)`，直接调用 `navigateToHeadingRef.current(headingIndex)`

### 步骤 4：实现动态高亮

**文件**: [EditorScrollContainer.tsx](file:///d:/software/WeaveMD/src/render/components/Editor/EditorScrollContainer.tsx)

- 添加 `onActiveHeadingChange?(headingIndex: number | null)` prop
- 添加 scroll 事件监听（throttle 100ms）
- 滚动时遍历所有 heading block DOM 元素，找到最后一个 `getBoundingClientRect().top <= containerTop + 40` 的 heading
- 计算其 headingIndex，回调通知

**文件**: [EditorView.tsx](file:///d:/software/WeaveMD/src/render/components/Editor/EditorView.tsx)

- 添加 `onActiveHeadingChange` prop，透传给 EditorScrollContainer
- 同时通过 `onNavigateReady` 暴露的回调中包含 active heading 更新

**文件**: [MainPage.tsx](file:///d:/software/WeaveMD/src/render/pages/MainPage.tsx)

- 添加 `activeHeadingIndex` state
- 传递给 OutlinePanel

**文件**: [OutlinePanel.tsx](file:///d:/software/WeaveMD/src/render/components/Editor/OutlinePanel.tsx)

- 添加 `activeHeadingIndex` prop
- 匹配的标题项添加高亮样式（`bg-bg-tertiary text-accent border-l-accent`）
- 展开父级节点（如果折叠）

### 步骤 5：清理

- 删除 `findBlockByLineNumber` 函数（不再使用）
- 删除 MainPage 中 `buildBlockTree` 相关代码
- 移除不再使用的 imports

## 涉及文件

| 文件 | 改动类型 |
|------|----------|
| `src/render/components/Editor/EditorScrollContainer.tsx` | 添加 scroll 监听 + active heading 检测 |
| `src/render/components/Editor/EditorView.tsx` | 改接口为 navigateToHeading + 透传 active heading |
| `src/render/components/Editor/OutlinePanel.tsx` | 改用 headingIndex + 高亮当前标题 |
| `src/render/pages/MainPage.tsx` | 移除独立 blockTree + 连接 navigate/highlight |
| `src/render/services/blockTree.ts` | 删除 `findBlockByLineNumber` |

## 验证

1. `npm run typecheck` — 类型检查通过
2. `npm run test` — 现有测试通过
3. `npm run lint` — ESLint 通过
4. 手动验证：打开含多级标题的文档，点击目录标题 → 编辑区平滑滚动到对应位置
5. 手动验证：滚动编辑区 → 目录中对应标题高亮
