# Normal Mode 底部标题高亮修复计划

## 问题分析

### 现象
滑动到 "四" 标题时，目录却跳到了最底端的 "123" 标题。

### 根因
`detectActiveHeading` 函数的两个问题：

1. **threshold 检测线太靠上**：使用 `containerRect.top + 40` 作为检测线，当标题在视口中间位置时未被检测为 active
2. **isAtBottom 逻辑太激进**：`scrollTop + clientHeight >= scrollHeight - 5` 条件太宽松，一旦接近底部就强制跳到最后一个 heading

## 修复方案

### 文件：`EditorScrollContainer.tsx`

#### 重写 `detectActiveHeading` 检测逻辑

采用三层检测策略：
1. **主检测点**：视口中心（`containerRect.top + clientHeight / 2`）— 最合理的当前阅读位置
2. **辅助检测点**：视口顶部下方少量偏移（`containerRect.top + 40`）— 处理标题刚进入视口的情况
3. **底部兜底**：仅在真正滚到最底部时才选最后一个 heading（条件更严格：`scrollTop + clientHeight >= scrollHeight - 2`）

#### 新增底部 padding
将底部 padding 从 240px 增加到 300px，使最后几个标题能滚动到视口中心位置。

## 验证步骤
1. `npm run typecheck`
2. `npm run lint`
3. 手动测试：
   - 滚动到 "四" 标题，确认目录高亮 "四"（不是 "123"）
   - 滚动到底部，确认目录高亮最后一个标题
   - 中间滚动过程中，高亮平滑跟随