# HR 块后自动空行保护 — 实施计划

## 需求

当输入 `---` 渲染为居中实线后，应当在其后面自动创建一个空行，并且该空行受到保护，只有实线被删除，该空行点击 Backspace 才能被删除。

## 任务分级

- **分类**：功能开发
- **影响面**：编辑器内核 + 控制器
- **定档**：S（单模块，≤30 分钟）
- **裁剪**：跳过拷问、技术调研、规划、并行执行、TDD 完整循环

## 变更清单

### 1. `src/render/editor/controllers/convertCtrl.ts`

**修改 `convertParagraphToBlock` 函数**（第 185-189 行）：

- 当 `---` 被转换为 `thematic-break` 时，自动在其后创建一个空行
- 使用 `ensureTrailingParagraph` 函数确保有尾随空行
- 返回焦点到新创建的空行（而不是 hr 块）

```typescript
case 'thematic-break': {
  const hr = makeThematicBreak(tree);
  tree = replaceBlock(tree, blockId, hr);
  blockId = hr.id;
  tree = ensureTrailingParagraph(tree, blockId);
  // 焦点移到尾随空行（hr 不可编辑）
  const nextLeaf = getNextLeaf(tree, blockId);
  if (nextLeaf) {
    blockId = nextLeaf.id;
  }
  break;
}
```

### 2. `src/render/editor/controllers/backspaceCtrl.ts`

**修改 `handleBackspaceAtStart` 函数**：

1. **移除第 44-48 行的特殊处理**（空段落前是 hr → 退格删除 hr）
2. **添加保护**：当空段落前是 `thematic-break` 时，Backspace 不做任何事

修改后的逻辑：

```typescript
// 分隔线：前驱是 hr 且当前段落为空 → 删除该分隔线（光标留段落开头）
// 移除此逻辑，改为在 mergeParagraph 中统一保护
// if (block.type === 'paragraph') {
//   const prevLeaf = getPrevLeaf(instance.tree, block.id);
//   if (prevLeaf?.type === 'thematic-break' && (block.text ?? '').trim() === '') {
//     return removeThematicBreakToPrev(instance, prevLeaf, block);
//   }
//   return mergeParagraph(instance, block);
// }
```

**修改 `mergeParagraph` 函数**（第 63 行）：

- 确保 `thematic-break` 在保护列表中（已存在）
- 当前段落为空且前驱是 hr 时，返回 null（不删除、不合并）

```typescript
// 前块是代码块/图片块/分隔线：段落受 Backspace 保护
if (prevLeaf.type === 'code-block' || prevLeaf.type === 'image-block' || prevLeaf.type === 'thematic-break') {
  return null;
}
```

### 3. 测试更新

**更新 `tests/editor/controllers/thematicBreakDelete.test.ts`**：

- 修改测试用例以反映新行为
- 添加新测试：空段落前是 hr → Backspace 不删除（保护）
- 添加新测试：hr 转换后自动创建空行

## 验收标准

1. 输入 `---` 后自动转换为 `thematic-break`，并在其后自动创建一个空行
2. 空行受保护：Backspace 不删除空行（无论空行是否为空）
3. 用户可以直接删除 `thematic-break` 块（通过选中删除或其他方式）
4. `thematic-break` 被删除后，空行不再受保护，可以被 Backspace 删除
5. 现有测试全部通过

## 风险

- **低风险**：修改仅涉及编辑器控制器，不影响其他模块
- **向后兼容**：现有文档中的 `thematic-break` 行为不变（仅新增自动空行）
