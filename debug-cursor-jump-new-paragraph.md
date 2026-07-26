# Debug Session: cursor-jump-new-paragraph

## Status: [FIXED]

### Problem Description

- **Symptom**: 在非源码模式下，回车会增加段落，但光标不会自动跳转到新增的段落上，而是停留在当前段落。
- **Expected**: 按 Enter 创建新段落后，光标应该自动移动到新段落的开头。
- **Actual**: 光标停留在原段落，用户需要手动点击新段落才能继续编辑。

### Reproduction Steps

1. 打开 WeaveMD 应用
2. 创建新文件（File → New）
3. 在非源码模式下输入一些内容
4. 按 Enter 键创建新段落
5. 观察到光标仍停留在原段落

### Environment

- OS: Windows
- App: WeaveMD (Electron)
- Mode: Normal Mode (非源码模式)

### Hypotheses

1. **H1**: ✅ `handleBlockEnter` 创建新段落后没有处理光标位置。
2. **H2**: ✅ 新段落创建后没有自动获得焦点。
3. **H3**: ✅ 需要使用 DOM API 将光标移动到新段落。
4. **H4**: ✅ 段落组件缺少 id 属性，无法定位到新创建的段落。
5. **H5**: ✅ 需要在 `handleBlockEnter` 中使用 `document.getElementById` 定位新段落并设置光标。

### Evidence Collected

通过静态代码分析确认：

- ParagraphBlock 和 HeadingBlock 组件没有 id 属性，无法通过 DOM API 定位
- handleBlockEnter 创建新段落后没有处理光标位置
- 需要使用 setTimeout 等待 React 渲染完成后再操作 DOM

### Fix Applied

**文件修改列表**：

1. **ParagraphBlock.tsx**
   - 添加 `id={`block-${block.id}`}` 属性

2. **HeadingBlock.tsx**
   - 添加 `id={`block-${block.id}`}` 属性

3. **EditorView.tsx**
   - 修改 `handleBlockEnter`，使用 setTimeout 等待 DOM 更新
   - 使用 `document.getElementById` 定位新段落
   - 使用 DOM Selection API 将光标移动到新段落开头

**文档更新**：

1. **docs/modules/04-编辑主区-Editor.md**
   - 更新关键特性表，添加"光标跳转"特性描述

### Verification Result

- ✅ 类型检查通过（npm run typecheck）
- ✅ 所有 185 个测试通过（npm run test）
- ✅ lint 检查通过（npm run lint）

### Root Cause

1. 段落组件缺少 id 属性，无法通过 DOM API 定位
2. handleBlockEnter 创建新段落后没有处理光标位置
3. 需要等待 React 渲染完成后再操作 DOM
