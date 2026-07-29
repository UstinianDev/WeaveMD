# Debug Plan: 目录点击导航失效修复（第二轮）

## 根因分析

### 假设 1（CRITICAL）：`themesLoading` 导致 `onNavigateReady` 永不调用

**调用链时序问题**：

1. EditorView 初始挂载时 `themesLoading = true` → 返回加载动画，`EditorScrollContainer` **未渲染**
2. `scrollContainerRef.current = null`
3. `useEffect([isSourceCodeMode, onNavigateReady])` 运行 → 条件 `!isSourceCodeMode && scrollContainerRef.current` 为 **false** → `onNavigateReady` 永不调用
4. Monaco 主题加载完成 → `setThemesLoading(false)` → `EditorScrollContainer` 渲染 → `scrollContainerRef.current` 被赋值
5. **但 `useEffect` 不再重新运行**（依赖未变），`navigateToHeadingRef.current` 永远为 `null`

**证据**：[EditorView.tsx#L1080-L1093](file:///d:/software/WeaveMD/src/render/components/Editor/EditorView.tsx#L1080) — `themesLoading` 为 true 时提前 return，`EditorScrollContainer` 不渲染

### 假设 2（SECONDARY）：标题级别过滤不匹配

- `extractOutline` 只提取 H1-H3（[markdown.ts#L61](file:///d:/software/WeaveMD/src/render/services/markdown.ts#L61): `n.depth >= 1 && n.depth <= 3`）
- `navigateToHeading` 中 `headingBlocks` 过滤所有 heading（H1-H6），未限制级别
- 文档含 H4-H6 时索引错位

### 假设 3（SECONDARY）：动态高亮 headingCount 也有级别问题

`detectActiveHeading` 中 `headingCount` 统计所有 heading（H1-H6），但 outline 只有 H1-H3，高亮索引不匹配。

## 修复方案

### 步骤 1：修复 `useEffect` 依赖，确保 `onNavigateReady` 在容器就绪后调用

**文件**: [EditorView.tsx](file:///d:/software/WeaveMD/src/render/components/Editor/EditorView.tsx)

在 `useEffect` 依赖数组中添加 `themesLoading`：

```ts
useEffect(() => {
  if (!isSourceCodeMode && !themesLoading && scrollContainerRef.current) {
    onNavigateReady?.((headingIndex: number) => {
      const allBlocks = getAllBlocksInOrder(blockTreeRef.current);
      const headingBlocks = allBlocks.filter(
        (b) => b.type === 'heading' && (b.headingLevel ?? 6) <= 3
      );
      const target = headingBlocks[headingIndex];
      if (target) {
        scrollContainerRef.current?.scrollToBlock(target.id);
      }
    });
  }
}, [isSourceCodeMode, onNavigateReady, themesLoading]);
```

### 步骤 2：修复标题级别过滤，H1-H3 与 outline 一致

**文件**: [EditorView.tsx](file:///d:/software/WeaveMD/src/render/components/Editor/EditorView.tsx)

在 `navigateToHeading` 闭包中，`headingBlocks` 过滤增加 `headingLevel <= 3` 条件（已在步骤 1 代码中包含）。

### 步骤 3：修复 `detectActiveHeading` 级别过滤

**文件**: [EditorScrollContainer.tsx](file:///d:/software/WeaveMD/src/render/components/Editor/EditorScrollContainer.tsx)

在 `detectActiveHeading` 中，heading 计数也过滤 `headingLevel <= 3`：

```ts
if (!block || block.type !== 'heading' || (block.headingLevel ?? 6) > 3) return;
```

### 步骤 4：添加临时调试日志

在以下位置添加 `console.log`：
- `handleNavigateToHeading`（MainPage）— 确认点击事件触发
- `navigateToHeading` 闭包（EditorView）— 确认函数被调用、headingIndex、target blockId
- `scrollToBlock`（EditorScrollContainer）— 确认滚动执行、offset 值

### 步骤 5：验证后清理调试日志

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/render/components/Editor/EditorView.tsx` | 添加 `themesLoading` 依赖 + H1-H3 过滤 + 调试日志 |
| `src/render/components/Editor/EditorScrollContainer.tsx` | H1-H3 过滤 + 调试日志 |
| `src/render/pages/MainPage.tsx` | 调试日志 |

## 验证

1. `npm run typecheck` — 类型检查通过
2. `npm run lint` — ESLint 通过
3. `npm run test` — 现有测试通过
4. 手动验证：打开含多级标题的文档，点击目录标题 → 编辑区滚动 + 目录高亮
5. 清理调试日志后重新验证
