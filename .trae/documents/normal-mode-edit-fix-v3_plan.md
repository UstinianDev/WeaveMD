# Normal Mode 编辑体验修复计划（第三轮）

## 问题概述

| 问题 | 现象 | 目标效果 |
|------|------|---------|
| 新增内容无法保存 | 新增段落输入内容后，切换到源码模式内容丢失 | 任何新增或修改都能在切换模式后保留 |
| Markdown 不自动渲染 | 输入 `# 标题` 后按 Enter，不自动转换为标题样式 | 输入 Markdown 语法后自动渲染为富文本 |

## 根因分析

### 问题 1：新增内容无法保存

**根因**：`beforeToggleSourceMode` 只更新 store（`setContent`），不更新 `blockTreeRef.current`。

**流程问题**：
```
1. 用户在新块中输入内容
2. 切换模式时 → beforeToggleSourceMode 触发
   → 从 DOM 读取内容
   → 更新 newBlocks
   → 序列化并 setContent(serialized)  ← 只更新 store
   → blockTreeRef.current 仍然是旧的（无新内容）
3. 组件卸载时 blur 事件触发
   → handleBlur → handleBlockContentChange
   → setBlockTree 使用陈旧的 blockTree 闭包
   → syncTreeToStore 可能用旧内容覆盖 store
```

**解决方案**：
在 `beforeToggleSourceMode` 中，当 `hasChanges` 为 true 时：
1. 立即更新 `blockTreeRef.current = newTree`
2. 调用 `setBlockTree(newTree)` 确保 React 状态同步

### 问题 2：Markdown 不自动渲染

**根因**：`detectMarkdownLine` 仅在 `handleBlur` 触发的 `handleBlockContentChange` 中调用，Enter 键处理（`handleBlockEnter`）中没有调用。

**流程问题**：
```
用户输入 "# 标题" → 按 Enter
→ handleBlockEnter(id) 被调用
→ 直接创建新块，不检查当前块内容
→ "# 标题" 保持为普通段落，不转换为标题
```

**解决方案**：
在 `handleBlockEnter` 中，在创建新块之前：
1. 从 DOM 读取当前块的内容
2. 调用 `detectMarkdownLine(content)` 检测 Markdown 语法
3. 如果检测到，先转换当前块类型（更新 sourceLines、type、headingLevel 等）
4. 然后再在已转换的块之后插入新块

## 修复方案

### 阶段 1：修复 beforeToggleSourceMode

修改文件：`src/render/components/Editor/EditorView.tsx`

```typescript
// 在 syncContentBeforeToggle 中：
if (hasChanges) {
  const newTree = { ...blockTreeRef.current, blocks: newBlocks };
  
  // 关键修复：同时更新 ref 和 state
  blockTreeRef.current = newTree;
  setBlockTree(newTree);
  
  const serialized = serializeBlockTree(newTree);
  isUpdatingFromExternalRef.current = true;
  setContent(serialized);
}
```

### 阶段 2：修复 handleBlockEnter

修改文件：`src/render/components/Editor/EditorView.tsx`

```typescript
const handleBlockEnter = useCallback(
  (id: BlockId) => {
    // 1. 从 DOM 读取当前块内容
    const container = document.querySelector('.editor-content-area');
    const blockEl = container?.querySelector(`[data-block-id="${id}"]`);
    
    if (blockEl) {
      const block = blockTreeRef.current.blocks[id];
      if (block) {
        const content = getBlockTextContent(block, blockEl);
        const detection = detectMarkdownLine(content);
        
        // 2. 如果检测到 Markdown 语法，先转换块类型
        if (detection && detection.type !== block.type) {
          setBlockTree((prev) => {
            const newBlock: BlockNode = {
              ...prev.blocks[id],
              type: detection.type,
              sourceLines: [content],
              headingLevel: detection.headingLevel,
              checked: detection.isChecked,
              orderedIndex: detection.orderedIndex,
              renderedHtml: null,
            };
            
            const next = { ...prev, blocks: { ...prev.blocks, [id]: newBlock } };
            blockTreeRef.current = next;
            
            // 3. 在转换后的块之后插入新块
            pushUndo(serializeBlockTree(prev));
            const newBlockId = generateBlockId(next);
            const emptyBlock = {
              id: newBlockId,
              type: 'paragraph' as const,
              sourceLines: [''],
              parentId: null,
              childrenIds: [],
              renderedHtml: null,
            };
            const finalTree = insertBlockAfter(next, id, emptyBlock);
            syncTreeToStore(finalTree);
            return finalTree;
          });
          return;
        }
      }
    }
    
    // 如果没有检测到 Markdown，保持原有逻辑
    // ...existing code...
  },
  [blockTree, pushUndo, syncTreeToStore, getBlockTextContent]
);
```

## 调试日志（临时）

为了验证修复效果，添加临时日志：

```typescript
// beforeToggleSourceMode 中
console.log('[DEBUG beforeToggle] blocks count:', blocks.length);
console.log('[DEBUG beforeToggle] hasChanges:', hasChanges);
console.log('[DEBUG beforeToggle] serialized:', serialized);

// handleBlockEnter 中
console.log('[DEBUG handleBlockEnter] block id:', id);
console.log('[DEBUG handleBlockEnter] content:', content);
console.log('[DEBUG handleBlockEnter] detection:', detection);
```

## 文件修改清单

| 文件 | 修改内容 | 风险等级 |
|------|---------|---------|
| `src/render/components/Editor/EditorView.tsx` | 1. `beforeToggleSourceMode` 添加 `setBlockTree` 和 ref 更新<br>2. `handleBlockEnter` 添加 Markdown 检测逻辑<br>3. 添加临时调试日志 | 中 |

## 验证步骤

### 自动化测试
1. `npm run typecheck` — 类型检查
2. `npm run lint` — ESLint 检查
3. `npm run test` — 运行测试

### 手动验证

**问题 1：新增内容保存**
1. 打开文档，确保 Normal Mode
2. 点击已有段落后按 Enter 新增段落
3. 在新段落中输入内容
4. 使用 Ctrl+` 切换到 Source Code Mode
5. 确认新增内容已保留

**问题 2：Markdown 自动渲染**
1. 在 Normal Mode 下新建空段落
2. 输入 `# 标题` → 按 Enter
3. 确认当前段落已转换为 H1 样式
4. 输入 `- 列表项` → 按 Enter
5. 确认当前段落已转换为列表

**清理**
- 移除所有 `console.log` 调试语句
