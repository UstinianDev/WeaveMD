# Debug Session: ctrl-z-undo-paragraph

## Status: [FIXED]

### Problem Description

- **Symptom**: 在非源码模式下，Ctrl+Z 无法撤销新增的段落。用户可以回车增加段落，Backspace 删除段落，但撤销操作无效。
- **Expected**: Ctrl+Z 应该撤销最近的操作（包括新增段落、删除段落、修改内容）。
- **Actual**: Ctrl+Z 只对内容修改有效，对段落的增删操作无效。

### Reproduction Steps

1. 打开 WeaveMD 应用
2. 创建新文件（File → New）
3. 在非源码模式下输入一些内容
4. 按 Enter 键创建新段落
5. 按 Ctrl+Z 尝试撤销
6. 观察到段落没有被撤销

### Environment

- OS: Windows
- App: WeaveMD (Electron)
- Mode: Normal Mode (非源码模式)

### Hypotheses

1. **H1**: ✅ editorStore 的 undo/redo 机制没有正确记录段落增删操作。
2. **H2**: ✅ handleBlockEnter 和 handleBlockDelete 没有触发编辑器的历史记录更新。
3. **H3**: ✅ 当前的历史记录只基于 content 变化，而段落增删可能没有正确触发 content 更新。
4. **H4**: ❌ 撤销时 blockTree 能正确重建（通过 useEffect 监听 content 变化）。
5. **H5**: ✅ 需要在段落增删时手动调用 pushUndo 记录历史。

### Evidence Collected

通过静态代码分析确认：

- `handleBlockEnter` 和 `handleBlockDelete` 只调用 `syncTreeToStore` 更新 content
- `syncTreeToStore` 调用 `setContent`（即 `updateContent`），但 `updateContent` 只在 content 变化时推入 undoStack
- 空段落（`sourceLines: ['']`）序列化后可能与之前的内容相同，导致不推入历史
- 需要在更新前手动调用 `pushUndo` 记录当前状态

### Fix Applied

**文件修改列表**：

1. **EditorView.tsx**
   - 添加 `pushUndo` store 方法引用
   - 在 `handleBlockEnter` 中，更新 blockTree 前调用 `pushUndo(serializeBlockTree(prev))`
   - 在 `handleBlockDelete` 中，更新 blockTree 前调用 `pushUndo(serializeBlockTree(prev))`

**文档更新**：

1. **.claude/CLAUDE.md**
   - 更新架构说明为 v4，添加 WYSIWYG 编辑功能描述
   - 更新设计决策表，添加 Undo/Redo 说明

2. **docs/SUMMARY.md**
   - 更新编辑主区模块描述，标注 WYSIWYG 可编辑

3. **docs/modules/04-编辑主区-Editor.md**
   - 更新版本为 v4.0
   - 更新功能概述，添加可编辑功能描述
   - 更新组件层描述，标注 Heading 和 Paragraph 可编辑
   - 更新数据流图，添加 WYSIWYG 编辑流程

### Verification Result

- ✅ 类型检查通过（npm run typecheck）
- ✅ 所有 185 个测试通过（npm run test）
- ✅ lint 检查通过（npm run lint）

### Root Cause

1. 段落增删操作没有手动记录历史到 undoStack
2. `updateContent` 只在 content 变化时推入历史，空段落序列化可能无变化
3. 需要在更新前手动调用 `pushUndo` 记录当前状态
