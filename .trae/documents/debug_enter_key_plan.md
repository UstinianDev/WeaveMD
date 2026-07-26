# Debug Plan: Enter Key Cannot Create Paragraph

## Repo Research Conclusion

**问题根因分析**：

1. **EmptyBlock 不可编辑**：新建文件时，`blocks.length === 0`，EditorScrollContainer 渲染 EmptyBlock，但 EmptyBlock 没有 `contentEditable` 属性，用户无法开始编辑。

2. **Enter 事件被阻止**：ParagraphBlock 的 `handleKeyDown` 中，`Enter` 键被 `preventDefault()` 阻止，只更新当前块内容，没有创建新段落的逻辑。

3. **缺乏新块创建逻辑**：当前实现只支持修改现有块的内容，不支持通过回车创建新段落。

## Files to Modify

| 文件 | 修改内容 |
|------|----------|
| `src/render/components/Editor/blocks/EmptyBlock.tsx` | 添加 contentEditable，允许用户在空白文档中开始编辑 |
| `src/render/components/Editor/blocks/ParagraphBlock.tsx` | 修改 Enter 处理逻辑，创建新段落 |
| `src/render/components/Editor/blocks/HeadingBlock.tsx` | 修改 Enter 处理逻辑，创建新段落 |
| `src/render/components/Editor/EditorView.tsx` | 添加创建新块的处理函数 |
| `src/render/services/blockTree.ts` | 确认 insertBlockAfter 函数可用 |

## Debug Steps

### Step 1: 插桩 - 添加调试日志

在以下位置添加日志：
- EmptyBlock 渲染时记录是否有 contentEditable
- ParagraphBlock/HeadingBlock 的 onBlur 和 onKeyDown 事件触发时记录
- EditorView 的 handleBlockContentChange 调用时记录

### Step 2: 复现问题

1. 启动应用
2. 创建新文件
3. 在非源码模式下点击空白区域
4. 尝试输入内容和按回车
5. 收集日志

### Step 3: 分析证据

根据日志分析：
- EmptyBlock 是否渲染
- 用户点击是否触发编辑
- Enter 事件是否被正确处理
- 是否有创建新块的逻辑

### Step 4: 修复

1. 修改 EmptyBlock 添加 contentEditable
2. 修改 ParagraphBlock/HeadingBlock 的 Enter 处理，创建新段落
3. 在 EditorView 添加 handleBlockInsert 函数

### Step 5: 验证

1. 测试新建文件后可以开始编辑
2. 测试回车可以创建新段落
3. 测试所有现有功能保持正常

## Potential Dependencies

- blockTree.ts 的 insertBlockAfter 函数
- editorStore 的 updateContent 函数
- serializeBlockTree 函数

## Risk Handling

- 修改 Enter 处理可能影响现有编辑行为
- 需要确保新块创建后正确序列化到 store
- 需要确保光标定位到新块

## Success Criteria

- 新建文件后可以直接输入内容
- 按 Enter 键可以创建新段落
- 所有现有测试通过
- 类型检查通过
