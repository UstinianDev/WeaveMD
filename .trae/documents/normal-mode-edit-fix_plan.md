# Normal Mode 编辑体验修复计划

## 问题概述

| 问题 | 现象 |
|------|------|
| 内容同步 | Normal Mode 编辑后切换到 Source Code Mode，修改内容丢失 |
| Markdown 自动渲染 | Normal Mode 下输入 markdown 语法不会自动渲染为富文本 |

## 根因分析

### 问题 1：内容同步

**当前数据流：**
```
用户编辑 → DOM contentEditable
→ handleBlur 触发（失焦时）
→ onBlockContentChange
→ setBlockTree 更新 blockTree
```

**问题：**
- 切换模式时，焦点可能还在编辑区域内
- `handleBlur` 不会触发
- blockTree 中的内容是旧的
- 导致切换到 Source Code Mode 后内容丢失

### 问题 2：Markdown 自动渲染

**当前实现：**
- `ParagraphBlock` 使用 `dangerouslySetInnerHTML` 渲染 `block.renderedHtml`
- 块内容被渲染为静态 HTML
- 编辑通过 `contentEditable` 在 DOM 层面进行
- 没有实时 markdown 解析

**用户期望（Typora/Marktext 风格）：**
- 输入 `# 标题` → 立即渲染为 H1 标题
- 输入 `- 列表项` → 立即渲染为列表
- 回车后自动创建新块

## 修复方案

### 阶段 1：修复内容同步问题

修改文件：`src/render/components/Editor/EditorView.tsx`

在 `beforeToggleSourceMode` 回调中，主动从 DOM 读取所有块的最新内容：

```typescript
const syncContentBeforeToggle = () => {
  if (!isSourceCodeMode) {
    // 主动从 DOM 读取最新内容
    const container = document.querySelector('.editor-content-area');
    if (container) {
      const blocks = getAllBlocksInOrder(blockTreeRef.current);
      const newBlockTree = { ...blockTreeRef.current, blocks: { ...blockTreeRef.current.blocks } };
      
      for (const block of blocks) {
        const blockEl = container.querySelector(`[data-block-id="${block.id}"]`);
        if (blockEl) {
          const newContent = blockEl.textContent?.trim() ?? '';
          const oldContent = block.sourceLines.join(block.type === 'heading' ? '\n' : ' ');
          
          if (newContent !== oldContent) {
            // 更新 block 的 sourceLines
            newBlockTree.blocks[block.id] = {
              ...block,
              sourceLines: [newContent],
              renderedHtml: null, // 强制重新渲染
            };
          }
        }
      }
      
      // 序列化并写入 store
      const serialized = serializeBlockTree(newBlockTree);
      isUpdatingFromExternalRef.current = true;
      setContent(serialized);
    }
  }
};
```

### 阶段 2：实现实时 Markdown 渲染

修改文件：
- `src/render/components/Editor/EditorScrollContainer.tsx`
- `src/render/components/Editor/blocks/ParagraphBlock.tsx`
- `src/render/services/lineMarkdown.ts`
- `src/render/services/blockTree.ts`

#### 2.1 添加实时输入事件处理

在 `EditorScrollContainer.tsx` 中添加 `handleInput` 事件处理：

```typescript
const handleInput = useCallback(
  (e: React.FormEvent<HTMLDivElement>) => {
    const blockId = getBlockIdFromEventTarget(e.target);
    if (!blockId) return;
    
    const blockEl = document.querySelector(`[data-block-id="${blockId}"]`);
    if (blockEl) {
      const newContent = blockEl.textContent ?? '';
      onBlockContentChange(blockId, newContent);
    }
  },
  [onBlockContentChange]
);
```

#### 2.2 扩展 lineMarkdown 服务

添加实时检测 markdown 语法的函数：

```typescript
export interface MarkdownLineDetection {
  type: BlockType;
  headingLevel?: number;
  isTaskList?: boolean;
  isChecked?: boolean;
  orderedIndex?: number;
}

export function detectMarkdownLine(line: string): MarkdownLineDetection | null {
  // 检测 heading: # 标题
  const headingMatch = line.match(/^(#{1,6})[ \t]+(.*)/);
  if (headingMatch) {
    return { type: 'heading', headingLevel: headingMatch[1].length };
  }
  
  // 检测 unordered list: - 或 * 列表项
  const ulMatch = line.match(/^[-*+][ \t]+(.*)/);
  if (ulMatch) {
    // 检测 task list: - [x] 或 - [ ]
    const taskMatch = line.match(/^[-*+][ \t]+\[([ xX])\][ \t]+(.*)/);
    if (taskMatch) {
      return { type: 'task-list-item', isTaskList: true, isChecked: taskMatch[1].toLowerCase() === 'x' };
    }
    return { type: 'unordered-list-item' };
  }
  
  // 检测 ordered list: 1. 列表项
  const olMatch = line.match(/^(\d+)\.[ \t]+(.*)/);
  if (olMatch) {
    return { type: 'ordered-list-item', orderedIndex: parseInt(olMatch[1]) };
  }
  
  // 检测 blockquote: > 引用
  const bqMatch = line.match(/^>[ \t]+(.*)/);
  if (bqMatch) {
    return { type: 'blockquote' };
  }
  
  return null;
}
```

#### 2.3 在 onBlockContentChange 中实现块类型自动转换

修改 `EditorView.tsx` 中的 `handleBlockContentChange`：

```typescript
const handleBlockContentChange = useCallback(
  (blockId: BlockId, newContent: string) => {
    setBlockTree((prev) => {
      const block = prev.blocks[blockId];
      if (!block) return prev;
      
      // 检测是否需要转换块类型
      const detection = detectMarkdownLine(newContent);
      
      if (detection && detection.type !== block.type) {
        // 块类型发生变化，创建新块
        const newBlock: BlockNode = {
          ...block,
          type: detection.type,
          sourceLines: [newContent],
          headingLevel: detection.headingLevel,
          checked: detection.isChecked,
          orderedIndex: detection.orderedIndex,
          renderedHtml: null, // 强制重新渲染
        };
        
        const next = { ...prev, blocks: { ...prev.blocks, [blockId]: newBlock } };
        syncTreeToStore(next);
        return next;
      }
      
      // 内容更新但类型不变
      const updatedBlock = {
        ...block,
        sourceLines: [newContent],
        renderedHtml: null, // 强制重新渲染
      };
      
      const next = { ...prev, blocks: { ...prev.blocks, [blockId]: updatedBlock } };
      syncTreeToStore(next);
      return next;
    });
  },
  [syncTreeToStore]
);
```

## 文件修改清单

| 文件 | 修改内容 | 风险等级 |
|------|---------|---------|
| `src/render/components/Editor/EditorView.tsx` | 修复 beforeToggleSourceMode 回调，添加实时输入处理 | 中 |
| `src/render/components/Editor/EditorScrollContainer.tsx` | 添加 handleInput 事件处理 | 中 |
| `src/render/services/lineMarkdown.ts` | 添加 detectMarkdownLine 函数 | 低 |
| `src/render/services/blockTree.ts` | 可能需要添加新的块转换函数 | 低 |

## 验证步骤

1. `npm run typecheck` — 类型检查
2. `npm run lint` — ESLint 检查
3. `npm run test` — 运行测试
4. 手动验证：
   - Normal Mode 编辑内容 → 切换到 Source Code Mode → 内容保留
   - Normal Mode 输入 `# 标题` → 立即渲染为 H1
   - Normal Mode 输入 `- 列表项` → 立即渲染为列表
   - Normal Mode 输入 `> 引用` → 立即渲染为引用

## 注意事项

- 实现实时 markdown 渲染是一个复杂的功能，需要仔细测试
- 块类型转换可能会影响用户体验，需要提供撤销/重做支持
- 需要考虑 IME 输入法的兼容性
- 需要考虑跨块选择和编辑的场景
