# 目录动态高亮与导航修复计划

## 问题分析

### 问题一：非源码模式下滚动到底部时目录高亮不正确

**假设**：滚动到编辑器底部时，最后一个标题（如"3.2"）的位置仍高于 threshold（`containerRect.top + 40`），导致 `activeHeadingIndex` 停留在前一个标题（"3.1"）。

**验证思路**：
1. 在 `detectActiveHeading` 中检查是否滚动到底部（`scrollTop + clientHeight >= scrollHeight - 5`）
2. 如果已到底部，应该选中最后一个可见的标题

### 问题二：非源码模式下点击目录标题后：
- a) 目录高亮未切换（点击"3.2"仍显示"3.1"）
- b) 编辑区未做临时高亮动画

**假设a**：点击目录标题时触发了 `scrollToBlock` 进行平滑滚动，滚动时 `handleScroll` 异步执行，但平滑滚动的 100ms 节流时间与导航时序冲突，或 `detectActiveHeading` 在平滑滚动中途检测到的是旧位置的标题。

**假设b**：当前 `scrollToBlock` 没有实现临时高亮动画。

### 问题三：源码模式下拉滚动时目录未选中对应标题

**假设**：`onDidScrollChange` 触发后 `updateActiveHeading` 只使用**光标位置**判断标题，但**滚动时光标不会自动跟随移动**。因此即使滚动到了新标题区域，光标仍在原位置，导致高亮未更新。需要改为：滚动时优先使用**可见区域第一行**，仅光标主动移动时才使用光标位置。

---

## 修改计划

### 文件 1: `EditorScrollContainer.tsx`

#### 修改 1.1: 滚动到底部时选中最后一个标题
```
detectActiveHeading 函数：
- 新增 isAtBottom 检查 (scrollTop + clientHeight >= scrollHeight - 5px)
- 如果 isAtBottom：
  - 从后向前遍历标题，找到第一个（即最后一个）存在的 heading（无论它在哪个位置）
  - 将 activeHeadingIndex 设为该标题的索引
```

#### 修改 1.2: scrollToBlock 后主动设置 active heading
```
scrollToBlock 方法中：
- 滚动完成后（平滑滚动约 300-500ms）主动调用 detectActiveHeading
  或直接根据目标 blockId 计算出的 headingIndex 调用 onActiveHeadingChange
```

#### 修改 1.3: 添加编辑区临时高亮动画（导航高亮效果）
```
scrollToBlock 方法中：
- 找到目标 blockEl
- 添加临时高亮 class (bg-accent/10 + transition-colors)
- 1-2 秒后移除该 class
- 在 globals.css 中定义 .editor-block-highlight 动画样式
```

#### 修改 1.4: 增加编辑区底部空白
```
容器 style:
- 将底部 padding 从 40px 增大，例如改为 padding: '40px 0 200px 0'
- 使最后一个块能滚动到视口中上部，方便被 threshold 检测到
```

### 文件 2: `SourceCodeEditor.tsx`

#### 修改 2.1: 区分滚动事件与光标事件
```
updateActiveHeading 函数改造：
- 滚动事件 (onDidScrollChange): 使用可见区域第一行 (getVisibleRanges()[0].startLineNumber)
- 光标事件 (onDidChangeCursorPosition): 使用 cursor 位置
- 新增参数 isScroll: boolean 来区分来源
```

### 文件 3: `globals.css`

#### 修改 3.1: 添加编辑区块高亮动画
```
.editor-block-highlight {
  animation: editor-block-flash 1.5s ease-out;
}
@keyframes editor-block-flash {
  0%   { background-color: rgba(124, 58, 237, 0.25); }
  50%  { background-color: rgba(124, 58, 237, 0.1); }
  100% { background-color: transparent; }
}
```

---

## 验证步骤
1. `npm run typecheck`
2. `npm run lint`
3. 手动测试：
   - Normal Mode: 滚动到底部，检查目录是否高亮最后一个标题
   - Normal Mode: 点击目录任意标题，检查目录是否立即切换高亮 + 编辑区块是否高亮动画
   - Source Code Mode: 滚动编辑区，检查目录是否跟随可见区域第一行标题变化高亮
   - Source Code Mode: 移动光标，检查目录是否跟随光标位置标题变化高亮

## 风险评估
- 风险等级：低
- 仅修改高亮检测逻辑和新增纯视觉动画，不改变核心数据流
- 回滚：git revert 文件变更