# Debug 计划：目录导航滚动位置 + 高亮不匹配 + 底部空白不足

## Session ID: `outline-nav-highlight`

## 问题描述

非源码模式下：
1. 点击目录标题后，该标题前的内容未被完全覆盖（标题没滚到视口顶部）
2. 目录高亮与所选标题不匹配
3. 底部空白区域不足，最后几个标题无法滚到检测线

## 代码现状分析

### scrollToBlock (EditorScrollContainer.tsx L118)
```typescript
const offset = blockRect.top - containerRect.top + container.scrollTop - 24;
```
滚动后标题位于 `containerRect.top + 24`（视口顶部下方 24px）。

### detectActiveHeading (EditorScrollContainer.tsx L171)
```typescript
const detectLine = containerRect.top + 5;
```
检测线在 `containerRect.top + 5`。

### 关键矛盾
标题滚到 `containerRect.top + 24`，检测线在 `containerRect.top + 5`。
由于 `24 > 5`，标题的 `rect.top` > `detectLine`，**不满足** `rect.top <= detectLine` 条件。
→ detectActiveHeading 找到的是**前一个**标题，导致高亮错位。

### 底部 padding (L305)
```tsx
style={{ padding: '40px 0 100vh 0' }}
```
当前 100vh，用户反馈仍不足。

## 可证伪假设

### H1: offset -24 导致标题位于检测线下方
- **观察点**：scrollToBlock 后，目标标题的 `rect.top` vs `detectLine`
- **预期**：`rect.top` ≈ `containerRect.top + 24` > `detectLine` (`containerRect.top + 5`)
- **证伪条件**：如果 `rect.top <= detectLine`，假设不成立

### H2: detectActiveHeading 的 600ms 延迟回调覆盖了 scrollToBlock 的即时高亮
- **观察点**：scrollToBlock 先设 `onActiveHeadingChange(targetIdx)`，600ms 后 detectActiveHeading 覆盖
- **预期**：如果 H1 成立，600ms 后检测到前一个标题，覆盖正确的高亮
- **证伪条件**：如果 600ms 后高亮仍正确，假设不成立

### H3: 底部 100vh padding 对长文档不足
- **观察点**：Test.md 最后一个标题滚动到视口顶部时，scrollTop vs maxScrollTop
- **预期**：maxScrollTop 不足以让最后几个标题到达视口顶部
- **证伪条件**：如果最后标题能到达视口顶部，假设不成立

### H4: scrollToBlock 中的 onActiveHeadingChange 使用 headingBlocks.findIndex 计算 index，与 detectActiveHeading 的 headingCount 计数方式不一致
- **观察点**：两种方式对同一标题计算的 index 是否相同
- **预期**：如果一致则无问题；如果不一致则高亮错位
- **证伪条件**：如果两种方式结果一致，假设不成立

## Debug 工作流程

### 步骤 1: 初始化 Debug 环境
- 创建 `debug-outline-nav-highlight.md`
- 启动 Debug Server（端口自动探测）
- 创建 `.dbg/outline-nav-highlight.env`

### 步骤 2: 埋点（仅添加日志，不改业务逻辑）
在 `EditorScrollContainer.tsx` 中添加 instrumentation：

**埋点 1 — scrollToBlock 执行时**：
- 目标 blockId、headingIndex
- containerRect.top、blockRect.top
- 计算的 offset
- 滚动后预期位置

**埋点 2 — detectActiveHeading 执行时**：
- detectLine 值
- 每个标题的 rect.top vs detectLine
- 最终 activeHeadingIndex

**埋点 3 — 底部滚动检测**：
- scrollTop、scrollHeight、clientHeight
- maxScrollTop
- 最后一个标题的 rect.top

### 步骤 3: 用户复现
- 用户启动 dev server，打开 Test.md
- 点击目录中不同位置的标题
- 滚动到底部
- 收集日志

### 步骤 4: 分析日志
- 确认/拒绝 H1-H4
- 确定 root cause

### 步骤 5: 最小修复
基于证据实施修复（预计）：
- **修复 H1**：将 offset 从 `-24` 改为 `+4`（标题滚到检测线上方）
- **修复 H3**：将底部 padding 从 `100vh` 改为 `150vh` 或更大

### 步骤 6: 再验证
- 用户再次复现，确认修复
- 对比 pre-fix vs post-fix 日志

### 步骤 7: 清理
- 移除所有 instrumentation 代码
- 终止 Debug Server
- 删除 debug 文件和 env 文件

## 修改文件
- `src/render/components/Editor/EditorScrollContainer.tsx` — 埋点 + 修复
