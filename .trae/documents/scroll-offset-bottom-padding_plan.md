# 目录导航滚动定位 + 底部空白修复计划

## 问题分析

### 问题一：点击目录标题后，视口顶部不显示该标题

**根因**：`scrollToBlock` 中使用 `-24` 偏移量
```typescript
const offset = blockRect.top - containerRect.top + container.scrollTop - 24;
```
这会将目标标题滚到视口顶部**上方 24px** 处，导致：
- 标题紧贴或略微超出视口顶部边缘
- 后续的 `detectActiveHeading` 检测时，该标题可能未通过 `detectLine`（视口顶部 + 5px）
- 目录高亮跳错位

**修复**：将 `-24` 改为 `+4`，让标题紧贴视口顶部下方

### 问题二：底部空白区域仍不足

**根因**：底部 padding 为 `50vh`（半个视口高度），对于较长文档，最后几个标题无法滚到视口顶部

**修复**：将 `50vh` 改为 `100vh`（一整个视口高度）

## 修改文件

#### `EditorScrollContainer.tsx`

1. **调整滚动偏移量**（第 117 行）
   ```typescript
   // 修改前
   const offset = blockRect.top - containerRect.top + container.scrollTop - 24;
   
   // 修改后
   const offset = blockRect.top - containerRect.top + container.scrollTop + 4;
   ```

2. **增加底部 padding**（第 305 行）
   ```tsx
   // 修改前
   style={{ padding: '40px 0 50vh 0' }}
   
   // 修改后
   style={{ padding: '40px 0 100vh 0' }}
   ```

## 验证
1. `npm run typecheck`
2. `npm run lint`
3. 使用 Test.md 手动测试：
   - 点击第一个标题 → 该标题紧贴视口顶部
   - 点击中间标题 → 该标题紧贴视口顶部
   - 点击最后几个标题 → 该标题可到达视口顶部，目录高亮正确