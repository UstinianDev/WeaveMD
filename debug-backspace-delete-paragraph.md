# Debug Session: backspace-delete-paragraph

## Status: [FIXED]

### Problem Description

- **Symptom**: 在非源码模式下，无法用 Backspace 删除段落。如果因为过度回车导致段落过多，无法删除这些多余的段落。
- **Expected**: 在空段落中按 Backspace 应该删除该段落，并将光标移动到上一个段落。
- **Actual**: Backspace 没有删除段落的效果，段落无法被删除。

### Reproduction Steps

1. 打开 WeaveMD 应用
2. 创建新文件（File → New）
3. 在非源码模式下输入一些内容
4. 按 Enter 键多次创建多个空段落
5. 尝试用 Backspace 删除空段落
6. 观察到无法删除段落

### Environment

- OS: Windows
- App: WeaveMD (Electron)
- Mode: Normal Mode (非源码模式)

### Hypotheses

1. **H1**: ✅ ParagraphBlock 没有处理 Backspace 事件，当段落为空时没有触发删除逻辑。
2. **H2**: ✅ 缺少删除块的回调接口，无法将删除请求传递到 EditorView。
3. **H3**: ❌ blockTree 的 removeBlock 函数正常工作。
4. **H4**: ⚠️ 删除段落时光标位置需要浏览器自动处理（contentEditable 行为）。
5. **H5**: ✅ 需要处理边界情况，至少保留一个段落。

### Evidence Collected

通过静态代码分析确认：

- ParagraphBlock/HeadingBlock 没有处理 Backspace 删除段落的逻辑
- 组件之间没有传递删除块的回调
- blockTree 的 removeBlock 函数已经实现，可以直接使用

### Fix Applied

**文件修改列表**：

1. **ParagraphBlock.tsx**
   - 添加 `onDelete` 回调属性
   - 修改 `handleKeyDown`，当段落为空且光标在开头时按 Backspace 调用 `onDelete`

2. **HeadingBlock.tsx**
   - 添加 `onDelete` 回调属性
   - 修改 `handleKeyDown`，当标题为空且光标在开头时按 Backspace 调用 `onDelete`

3. **BlockRenderer.tsx**
   - 添加 `onBlockDelete` 回调属性
   - 将 `onBlockDelete` 传递给 HeadingBlock 和 ParagraphBlock

4. **EditorScrollContainer.tsx**
   - 添加 `onBlockDelete` 属性
   - 将 `onBlockDelete` 传递给 BlockRenderer

5. **EditorView.tsx**
   - 导入 `removeBlock` 函数
   - 添加 `handleBlockDelete` 回调函数，删除块并同步到 store
   - 边界处理：至少保留一个段落

### Verification Result

- ✅ 类型检查通过（npm run typecheck）
- ✅ 所有 185 个测试通过（npm run test）
- ✅ lint 检查通过（npm run lint）

### Root Cause

1. ParagraphBlock/HeadingBlock 没有处理 Backspace 删除段落的逻辑
2. 缺少删除块的回调链路
3. 没有处理边界情况（至少保留一个段落）
