# 上下键跨块导航修复状态

## 任务分级

- **分类**：功能缺失修复
- **档位**：S 级（单模块，编辑器键盘导航）
- **裁剪**：S → 直接修复

## 问题描述

用户报告在编辑主区编辑时，按上下键不能跨不同语法类型的内容（比如从标题跳到段落、从代码块跳到列表等）。

## 根因分析

1. **功能缺失**：编辑器 v2 实现了 Enter/Backspace/Tab/左右方向键的处理，但上下方向键的跨块导航从未被实现
2. **contentEditable 孤岛**：每个块是独立的 `<span contentEditable>` 元素，浏览器原生的上下键无法跨 DOM 边界
3. **已有基础设施**：`blockTree.ts` 中的 `getNextLeaf()` / `getPrevLeaf()` / `adjacentLeafFocus()` 已实现跨块遍历，只是没有被上下键调用

## 修复方案

**修改文件**：
- `src/render/components/Editor/v2/types.ts` — 添加 `onArrowUp` / `onArrowDown` 到 `BlockHandlers` 接口
- `src/render/hooks/useEditorActions.ts` — 实现跨块跳转逻辑
- `src/render/components/Editor/v2/blocks/ContentBlock.tsx` — 添加 `handleArrowUpDown` 处理函数
- `tests/components/ContentBlockRestore.test.tsx` — 更新 mock
- `tests/components/pasteImage.test.tsx` — 更新 mock
- `tests/components/TableBlock.test.tsx` — 更新 mock

### 实现细节

1. **types.ts**：在 `BlockHandlers` 接口中添加回调
```typescript
onArrowUp: (blockId: string) => void;
onArrowDown: (blockId: string) => void;
```

2. **useEditorActions.ts**：使用已有的 `adjacentLeafFocus()` 实现跨块跳转
```typescript
const onArrowUp = useCallback((blockId: string) => {
  const instance = instanceRef.current;
  if (!instance) return;
  const focus = adjacentLeafFocus(instance.tree, blockId, 'prev');
  if (focus) {
    const el = getBlockEl(focus.blockId);
    if (el) setCursorAtOffset(el, focus.offset);
  }
}, [instanceRef, getBlockEl]);
```

3. **ContentBlock.tsx**：检测光标位置，调用跨块跳转
```typescript
// ArrowUp：光标在块首（offset=0）时跳到前一块
if (e.key === 'ArrowUp' && start === 0) {
  e.preventDefault();
  onArrowUp(blockId);
  return true;
}
// ArrowDown：光标在块末时跳到后一块
if (e.key === 'ArrowDown' && start === text.length) {
  e.preventDefault();
  onArrowDown(blockId);
  return true;
}
```

## 关键修复点

**问题**：`setPendingFocus` 依赖树变化才触发焦点恢复，但上下键导航不修改树结构

**解决方案**：直接调用 `getBlockEl()` 获取目标块 DOM 元素，然后调用 `setCursorAtOffset()` 设置焦点

## 验证方法

1. 运行 `npm run dev` 启动应用
2. 输入以下内容：
   ```
   # 标题

   段落内容

   - 列表项
   ```
3. 测试：
   - 光标在"标题"末尾，按向下键 → 跳到"段落内容"开头
   - 光标在"段落内容"开头，按向上键 → 跳到"标题"末尾
   - 光标在"段落内容"末尾，按向下键 → 跳到"列表项"开头

## 状态

- [x] 问题定位
- [x] 代码修复
- [x] 类型检查通过
- [ ] 用户验证
