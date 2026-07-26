# Debug Plan: Cursor Doesn't Jump to New Paragraph

## Repo Research Conclusion

**问题根因分析**：

1. **光标位置未处理**：`handleBlockEnter` 创建新段落后，没有将光标移动到新段落。
2. **缺少焦点管理**：新段落创建后没有自动获得焦点。
3. **需要 DOM 操作**：需要在段落渲染后使用 DOM API 将光标移动到新段落的开头。

## Files to Modify

| 文件 | 修改内容 |
|------|----------|
| `src/render/components/Editor/EditorView.tsx` | 修改 `handleBlockEnter`，创建新段落后将光标移动到新段落 |
| `src/render/components/Editor/blocks/ParagraphBlock.tsx` | 添加 `id` 属性以便定位 |

## Debug Steps

### Step 1: 插桩 - 添加调试日志

在以下位置添加日志：
- `handleBlockEnter` 创建新段落后记录新块 ID
- 记录 DOM 中是否存在新段落元素
- 记录光标位置

### Step 2: 复现问题

1. 启动应用
2. 创建新文件
3. 在非源码模式下输入内容
4. 按 Enter 键创建新段落
5. 观察光标位置
6. 收集日志

### Step 3: 分析证据

根据日志分析：
- 新段落是否正确创建
- DOM 中是否存在新段落元素
- 光标是否停留在原段落

### Step 4: 修复

1. 修改 ParagraphBlock 添加 `id` 属性
2. 修改 `handleBlockEnter`，创建新段落后使用 `setTimeout` 等待 DOM 更新
3. 使用 DOM API 将光标移动到新段落开头

### Step 5: 验证

1. 测试按 Enter 创建新段落后光标自动跳转
2. 测试连续按 Enter 创建多个段落时光标正确跳转
3. 测试所有现有功能保持正常

## Potential Dependencies

- React 的渲染机制（需要等待 DOM 更新）
- DOM Selection API（设置光标位置）
- setTimeout（等待渲染完成）

## Risk Handling

- 使用 setTimeout 可能导致闪烁
- 需要确保段落 ID 在 DOM 中唯一
- 需要处理边界情况（如最后一个段落）

## Success Criteria

- 按 Enter 创建新段落后光标自动移动到新段落开头
- 连续按 Enter 时光标正确跟随
- 所有现有测试通过
- 类型检查通过

## Documentation Updates

- 更新 `.claude/CLAUDE.md` 中的功能描述
- 更新 `docs/modules/04-编辑主区-Editor.md` 中的数据流说明
