# Normal Mode 编辑体验修复计划（第二轮）

## 问题概述

| 问题 | 现象 |
|------|------|
| 新增内容无法保存 | 新增段落输入内容后，切换到源码模式内容丢失 |
| 列表符号重复 | 每次切换模式后，无序列表 "•" 数量增加一个 |

## 根因分析

### 问题 1：新增内容无法保存

**根因**：`handleInput`（onInput 事件）在每次按键时触发 `setBlockTree`，导致 React 重新渲染，覆盖 DOM 并重置光标位置。

**流程**：
```
用户按键 → onInput 触发
→ handleBlockContentChange → setBlockTree
→ React 重新渲染
→ contentEditable DOM 被替换
→ 光标丢失
→ 用户无法继续输入
```

**解决方案**：
1. 移除 `handleInput` 回调和 `onInput` 属性
2. 使用 `handleBlur`（失焦时同步）+ `beforeToggleSourceMode`（切换模式前同步）

### 问题 2：列表符号重复

**根因**：`ListItemBlock` 的 DOM 结构包含列表标记元素，`blockEl.textContent` 读取了标记 + 内容。

**ListItemBlock DOM 结构**：
```html
<div data-block-id="xxx" class="unordered-list-item">
  <span class="list-bullet">•</span>  <!-- 列表标记 -->
  <span class="flex-1">内容文本</span>  <!-- 实际内容 -->
</div>
```

**问题流程**：
```
1. beforeToggleSourceMode 读取 blockEl.textContent
   → "•内容文本"（包含列表标记）

2. 构造 newSourceLines = ["- •内容文本"]
   → sourceLines 包含额外的 "•"

3. 下次渲染时显示 "• •内容文本"
   → 重复一个 "•"
```

**解决方案**：
1. 对于列表项，使用更精确的选择器读取内容区域
2. `ListItemBlock` 的内容在 `span.flex-1` 中

## 修复方案

### 阶段 1：移除 handleInput

修改文件：`src/render/components/Editor/EditorScrollContainer.tsx`

1. 移除 `handleInput` 回调函数
2. 移除 `onInput={handleInput}` 属性

### 阶段 2：修复 beforeToggleSourceMode

修改文件：`src/render/components/Editor/EditorView.tsx`

对于不同块类型，使用精确的选择器读取内容：

```typescript
const getBlockTextContent = (block: BlockNode, blockEl: HTMLElement): string => {
  // 列表项：只读取内容区域，排除列表标记
  if (block.type === 'unordered-list-item' || 
      block.type === 'ordered-list-item' || 
      block.type === 'task-list-item') {
    const contentEl = blockEl.querySelector('span.flex-1');
    return contentEl?.textContent?.trim() ?? '';
  }
  
  // 其他块：直接读取 textContent
  return blockEl.textContent?.trim() ?? '';
};
```

### 阶段 3：修复 handleBlockContentChange

修改文件：`src/render/components/Editor/EditorView.tsx`

同样使用精确选择器获取内容。

## 文件修改清单

| 文件 | 修改内容 | 风险等级 |
|------|---------|---------|
| `src/render/components/Editor/EditorScrollContainer.tsx` | 移除 handleInput 回调和 onInput 属性 | 低 |
| `src/render/components/Editor/EditorView.tsx` | 1. 添加 getBlockTextContent 辅助函数<br>2. 修改 beforeToggleSourceMode 使用精确选择器<br>3. 修改 handleBlockContentChange 使用精确选择器 | 中 |

## 验证步骤

1. `npm run typecheck` — 类型检查
2. `npm run lint` — ESLint 检查
3. `npm run test` — 运行测试
4. 手动验证：
   - Normal Mode 新增段落 → 输入内容 → 切换到 Source Code Mode → 内容保留
   - Normal Mode 修改已有内容 → 切换到 Source Code Mode → 内容保留
   - 切换模式多次 → 列表符号不重复

## 注意事项

- 移除 handleInput 后，用户必须失焦或切换模式时才会同步内容
- 如果用户希望实时同步，需要使用防抖（debounce）而不是 onInput
- 当前方案优先保证正确性和稳定性
