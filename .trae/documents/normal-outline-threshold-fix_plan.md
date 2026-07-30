# Normal Mode 目录高亮与 OutlinePanel 索引一致性修复计划

## 问题分析

### 问题一：滚动到文档顶部，目录高亮停在 "1.1" 而非文档大标题（文档第一个 H1）
### 问题二：滚动到 "四、..." 时，目录高亮跳到 "# 3"（错误的 H1）而非停在 "四"

### 核心根因：索引不一致

OutlinePanel 的 headingIndex 来自 `extractOutline(content)`（基于源 Markdown 解析 H1-H3），而 EditorScrollContainer 用 blockTree 过滤 heading，两个数据源可能不完全匹配。

**但更直接的问题在于阈值计算**：
- `viewportCenter = containerRect.top + container.clientHeight / 2`
- 如果 container 的 clientHeight 太大（占据全屏），center 可能在较低位置，导致第一个 H1 刚进入视口时还没超过 center，此时 "1.1" 已超过 center，造成错误高亮
- 同时 isAtBottom 过于敏感（scrollHeight - 2），可能未完全到底就触发了 lastHeadingIndex

## 修复方案

### 修复思路

**1. 统一数据源**：用 OutlinePanel 相同的 `extractOutline` 逻辑，基于 content + blockTree 映射构建 heading 列表，保证索引一致

**2. 调整阈值计算**：
- 主检测线改为视口 **上部 1/3**（非 1/2 中心）：`containerRect.top + container.clientHeight * 0.25`
- 顶部检测线保留 40px
- isAtBottom 改为更严格：`scrollTop + clientHeight >= scrollHeight`（必须完全到底）
- 新增 **isAtTop** 检测：`scrollTop <= 1` 时，直接返回第一个 heading index（0）

### 文件修改

#### 文件 1：`EditorScrollContainer.tsx`

1. 修改 `detectActiveHeading`：
   - 引入 isAtTop 判断 → scrollTop <= 1 时 active=0
   - 主检测线从 1/2 调整到 1/4 (0.25)
   - isAtBottom 条件改为 `>= scrollHeight`

## 验证步骤
1. `npm run typecheck`
2. `npm run lint`
3. 手动测试：
   - 顶部：目录高亮第一个大标题
   - 向下滚动到"四"位置：目录高亮"四"
   - 完全到底：目录高亮最后一个标题
   - 中间：平稳跟随