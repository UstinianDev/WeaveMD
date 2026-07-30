# Normal Mode 目录高亮检测策略调整计划

## 问题分析

### 用户期望行为
1. 编辑主区最顶部对应标题 "一、..." → 目录高亮 "一、..."
2. 下滑编辑主区，"一、..." 被覆盖，最顶部变成 "1.1 ..." → 目录高亮 "1.1 ..."
3. 以此类推，**视口顶部显示的标题即当前高亮标题**

### 当前问题
使用视口 1/4 检测线（25% 位置）+ 40px 辅助线的双阈值策略不够直观，导致：
- 顶部时可能无法正确匹配第一个标题
- 滚动过程中高亮跳变不符合直觉

## 修复方案

### 核心思路：采用"最后一个位于视口顶部附近的标题"策略

将检测逻辑简化为：
- **isAtTop 特殊处理**（scrollTop <= 1）：强制返回第一个标题
- **一般情况**：找到 DOM 顺序中**最后一个**满足 `rect.top <= containerRect.top + 5` 的 heading 块
  - 即视口顶部边缘（加 5px 容差）之上的最后一个标题
  - 这正是用户在视口顶部看到的标题

### 修改文件

#### `EditorScrollContainer.tsx` — 重写 `detectActiveHeading`

```typescript
const detectActiveHeading = useCallback(() => {
  const container = scrollContainerRef.current;
  if (!container || !onActiveHeadingChange) return;

  const containerRect = container.getBoundingClientRect();

  // Special case: at the very top of document
  const isAtTop = container.scrollTop <= 1;
  if (isAtTop) {
    // ... 保持现有 isAtTop 逻辑
    return;
  }

  // Detection line: viewport top + small tolerance
  const detectLine = containerRect.top + 5;

  // Find all heading blocks, track LAST one above detection line
  const headingEls = container.querySelectorAll('[data-block-id]');
  let activeHeadingIndex: number | null = null;
  let headingCount = 0;
  let lastHeadingIndex: number | null = null;

  headingEls.forEach((el) => {
    // ... 过滤 heading 类型
    lastHeadingIndex = headingCount;

    const rect = el.getBoundingClientRect();
    if (rect.top <= detectLine) {
      activeHeadingIndex = headingCount;
    }

    headingCount += 1;
  });

  // Fallback: if nothing above detectLine, use first heading
  if (activeHeadingIndex === null && lastHeadingIndex !== null) {
    activeHeadingIndex = 0;
  }

  onActiveHeadingChange(activeHeadingIndex);
}, [blockTree, onActiveHeadingChange]);
```

## 验证
1. `npm run typecheck`
2. `npm run lint`
3. 手动测试：
   - 顶部 → 高亮第一个标题
   - 滚动时 → 高亮视口顶部的标题
   - 底部 → 高亮最后一个标题