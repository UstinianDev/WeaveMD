# Debug Plan: Ctrl+Z Cannot Undo Paragraph Operations

## Repo Research Conclusion

**问题根因分析**：

1. **空段落序列化无变化**：当用户在空文档中创建第一个段落（`sourceLines: ['']`）时，`serializeBlockTree` 返回空字符串 `""`，与之前的内容相同，导致 `updateContent` 不推入 `undoStack`。

2. **同步更新顺序问题**：`handleBlockEnter` 和 `handleBlockDelete` 先更新 `blockTree`，再通过 `syncTreeToStore` 更新 `content`。但 `syncTreeToStore` 中设置了 `isUpdatingFromExternalRef.current = true`，这会阻止 `content` 变化时重建 `blockTree`。

3. **撤销时块树未重建**：当用户按 Ctrl+Z 时，`undo()` 更新了 `content`，但由于 `isUpdatingFromExternalRef.current` 的检查，`blockTree` 可能没有被正确重建。

## Files to Modify

| 文件 | 修改内容 |
|------|----------|
| `src/render/components/Editor/EditorView.tsx` | 修改 `syncTreeToStore` 逻辑，确保撤销时 `blockTree` 能正确重建 |
| `src/render/stores/editorStore.ts` | 修改 `updateContent`，确保即使内容相同也能记录历史（可选） |
| `src/render/services/blockTreeSerializer.ts` | 确保空段落正确序列化（可选） |

## Debug Steps

### Step 1: 插桩 - 添加调试日志

在以下位置添加日志：
- `handleBlockEnter` 调用时记录当前 `blockTree` 和序列化后的 `content`
- `handleBlockDelete` 调用时记录当前 `blockTree` 和序列化后的 `content`
- `syncTreeToStore` 调用时记录 `isUpdatingFromExternalRef.current` 的值
- `useEffect` 中 `content` 变化时记录是否跳过重建

### Step 2: 复现问题

1. 启动应用
2. 创建新文件
3. 在非源码模式下输入内容
4. 按 Enter 键创建新段落
5. 按 Ctrl+Z 尝试撤销
6. 收集日志

### Step 3: 分析证据

根据日志分析：
- 序列化后的 `content` 是否正确变化
- `undoStack` 是否被正确推入
- 撤销时 `blockTree` 是否被正确重建

### Step 4: 修复

1. 修改 `syncTreeToStore`，确保撤销时 `isUpdatingFromExternalRef.current` 为 `false`
2. 确保空段落创建时 `content` 有变化（添加换行符）
3. 在 `handleBlockEnter` 和 `handleBlockDelete` 中手动调用 `pushUndo`

### Step 5: 验证

1. 测试空文档中按 Enter 创建段落，然后按 Ctrl+Z 撤销
2. 测试按 Enter 创建多个段落，然后按 Ctrl+Z 依次撤销
3. 测试按 Backspace 删除段落，然后按 Ctrl+Z 撤销
4. 测试所有现有功能保持正常

## Potential Dependencies

- `editorStore.ts` 的 `updateContent` 和 `pushUndo` 函数
- `blockTreeSerializer.ts` 的 `serializeBlockTree` 函数
- `EditorView.tsx` 的 `syncTreeToStore` 和 `useEffect`

## Risk Handling

- 修改序列化逻辑可能影响其他功能
- 需要确保撤销/重做时块树正确重建
- 需要确保历史记录不会无限增长

## Success Criteria

- Ctrl+Z 可以撤销新增的段落
- Ctrl+Z 可以撤销删除的段落
- Ctrl+Z 可以撤销修改的内容
- 所有现有测试通过
- 类型检查通过

## Documentation Updates

- 更新 `.claude/CLAUDE.md` 中的架构说明
- 更新 `docs/SUMMARY.md` 中的编辑主区文档
- 更新 `docs/modules/编辑主区.md` 中的功能说明
