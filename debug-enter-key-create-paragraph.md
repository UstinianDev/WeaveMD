# Debug Session: enter-key-create-paragraph

## Status: [FIXED]

### Problem Description

- **Symptom**: 在非源码模式下，回车无法增加段落。新建文件后全文空白，无法编辑任何内容。
- **Expected**: 回车应该创建新段落，用户可以在空白文档中开始编辑。
- **Actual**: 回车没有效果，空白文档无法开始编辑。

### Reproduction Steps

1. 打开 WeaveMD 应用
2. 创建新文件（File → New）
3. 在非源码模式下尝试输入内容或按回车
4. 观察到无法创建段落

### Environment

- OS: Windows
- App: WeaveMD (Electron)
- Mode: Normal Mode (非源码模式)

### Hypotheses

1. **H1**: ✅ 新建文件时，blockTree 为空，没有可编辑的块。EmptyBlock 组件没有 contentEditable 属性。
2. **H2**: ✅ contentEditable 块的 Enter 事件被 preventDefault 阻止，导致无法创建新段落。
3. **H3**: ✅ ParagraphBlock 和 HeadingBlock 的 Enter 处理只更新当前块内容，没有创建新块的逻辑。
4. **H4**: ✅ EditorScrollContainer 在 blocks.length === 0 时只渲染 EmptyBlock，无法开始编辑。
5. **H5**: ❌ blockTree 的 insertBlockAfter 函数正常工作。

### Evidence Collected

通过静态代码分析确认：

- EmptyBlock 组件没有 contentEditable 属性
- ParagraphBlock/HeadingBlock 的 Enter 事件处理只调用 onContentChange，没有创建新块的逻辑
- EditorScrollContainer 没有传递创建新块的回调

### Fix Applied

**文件修改列表**：

1. **EmptyBlock.tsx**
   - 添加 `contentEditable` 属性，允许用户在空白文档中开始编辑
   - 添加 `onContentChange` 回调，当用户输入内容后创建第一个段落

2. **ParagraphBlock.tsx**
   - 添加 `onEnter` 回调属性
   - 修改 `handleKeyDown`，按 Enter 时调用 `onEnter` 创建新段落

3. **HeadingBlock.tsx**
   - 添加 `onEnter` 回调属性
   - 修改 `handleKeyDown`，按 Enter 时调用 `onEnter` 创建新段落

4. **BlockRenderer.tsx**
   - 添加 `onBlockEnter` 回调属性
   - 将 `onBlockEnter` 传递给 HeadingBlock 和 ParagraphBlock

5. **EditorScrollContainer.tsx**
   - 添加 `onBlockEnter` 属性
   - 将 `onBlockEnter` 传递给 BlockRenderer

6. **EditorView.tsx**
   - 导入 `insertBlockAfter` 和 `generateBlockId` 函数
   - 添加 `handleBlockEnter` 回调函数，创建新段落块并同步到 store

### Verification Result

- ✅ 类型检查通过（npm run typecheck）
- ✅ 所有 185 个测试通过（npm run test）
- ✅ lint 检查通过（npm run lint）

### Root Cause

1. EmptyBlock 不可编辑，导致新建文件后无法开始编辑
2. Enter 事件处理只更新当前块内容，没有创建新段落的逻辑
3. 缺乏新块创建的回调链路
