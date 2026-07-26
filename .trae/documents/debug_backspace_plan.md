# Debug Plan: Backspace Cannot Delete Paragraph

## Repo Research Conclusion

**问题根因分析**：

1. **ParagraphBlock 没有处理 Backspace 事件**：当前实现只处理了 Enter 键和失焦事件，没有处理 Backspace 删除段落的逻辑。

2. **缺少删除块的回调接口**：组件之间没有传递删除块的回调，无法将删除请求传递到 EditorView。

3. **需要处理边界情况**：
   - 空段落按 Backspace 应该删除该段落
   - 删除后光标应该移动到上一个段落
   - 最后一个段落应该保留（至少保留一个空段落）

## Files to Modify

| 文件 | 修改内容 |
|------|----------|
| `src/render/components/Editor/blocks/ParagraphBlock.tsx` | 添加 Backspace 事件处理，删除空段落 |
| `src/render/components/Editor/blocks/HeadingBlock.tsx` | 添加 Backspace 事件处理，删除空标题 |
| `src/render/components/Editor/BlockRenderer.tsx` | 添加 onBlockDelete 回调接口 |
| `src/render/components/Editor/EditorScrollContainer.tsx` | 添加 onBlockDelete 属性 |
| `src/render/components/Editor/EditorView.tsx` | 添加 handleBlockDelete 函数 |
| `src/render/services/blockTree.ts` | 确认 removeBlock 函数可用 |

## Debug Steps

### Step 1: 插桩 - 添加调试日志

在以下位置添加日志：
- ParagraphBlock 的 onKeyDown 事件触发时记录（Backspace 键）
- EditorView 的 handleBlockDelete 调用时记录
- blockTree 的 removeBlock 函数调用时记录

### Step 2: 复现问题

1. 启动应用
2. 创建新文件
3. 在非源码模式下输入内容并按 Enter 创建多个段落
4. 尝试用 Backspace 删除空段落
5. 收集日志

### Step 3: 分析证据

根据日志分析：
- Backspace 事件是否被正确捕获
- 是否有删除块的逻辑
- removeBlock 函数是否正常工作

### Step 4: 修复

1. 修改 ParagraphBlock 添加 Backspace 处理逻辑
2. 修改 HeadingBlock 添加 Backspace 处理逻辑
3. 在 BlockRenderer、EditorScrollContainer、EditorView 中添加删除回调链路
4. 在 EditorView 中实现 handleBlockDelete 函数

### Step 5: 验证

1. 测试空段落按 Backspace 可以删除
2. 测试删除后光标位置正确
3. 测试至少保留一个段落
4. 测试所有现有功能保持正常

## Potential Dependencies

- blockTree.ts 的 removeBlock 函数
- blockTree.ts 的 getPrevSiblingId 函数（用于确定删除后光标位置）
- editorStore 的 updateContent 函数

## Risk Handling

- 删除段落可能影响文档结构
- 需要确保至少保留一个段落
- 需要确保删除后光标正确定位

## Success Criteria

- 空段落按 Backspace 可以删除
- 删除后光标移动到上一个段落
- 至少保留一个段落
- 所有现有测试通过
- 类型检查通过
