# 保存功能失效修复需求文档

## 任务分级

- **请求类型**：Bug 修复
- **影响面**：单模块（文件保存功能）
- **预估工时**：S（≤30 分钟）
- **裁剪理由**：S级跳过完整拷问/调研/规划，直接进入最小修复路径

## 需求清单

### 核心问题
用户报告：顶部导航栏的保存功能无法使用，并且切换文档保存也保存不了。

### 功能需求
1. **顶部导航栏保存按钮**：点击保存按钮时，应正确保存当前文件内容到磁盘/数据库
2. **切换文档保存**：切换文件时，如果当前文件有未保存修改，应弹出确认对话框并正确保存
3. **快捷键保存**：Ctrl+S 快捷键应正常工作

### 验收标准
1. [ ] 顶部导航栏保存按钮点击后，文件内容成功保存
2. [ ] 切换文件时，dirty状态的文件能正确保存
3. [ ] Ctrl+S快捷键保存功能正常
4. [ ] 保存后isDirty状态正确重置为false
5. [ ] 保存失败时有错误提示

## 已对齐问题清单

### 问题分析
通过代码审查发现：

1. **保存按钮实现**（TopBar.tsx:88-96）：
   - 直接调用 `saveFile()` 函数
   - 检查 `isDirty` 和 `saving` 状态

2. **saveFile 函数**（editorStore.ts:55-112）：
   - 区分磁盘文件（id包含路径分隔符）和DB文件
   - 磁盘文件：调用 `window.weaveMD.file.write`
   - DB文件：调用 `window.weaveMD.file.save`

3. **IPC handler**（ipc-handlers.ts:400-407）：
   - `FILE_WRITE`：`fs.writeFileSync(filePath, content, 'utf-8')`
   - `FILE_SAVE`：`updateFileContent(fileId, userId, content)`

### 潜在问题点
1. **IPC通信**：preload.ts中API定义正确，但需要验证实际调用
2. **错误处理**：saveFile函数有try-catch，但错误信息可能没有正确显示
3. **状态管理**：isDirty状态可能没有正确更新

### 需要进一步确认
1. 用户具体的复现步骤
2. 控制台是否有错误信息
3. 是所有文件还是特定文件有问题

## 关联文档
- [编辑器模块文档](../modules/04-编辑主区-Editor.md)
- [顶部导航栏文档](../modules/03-顶部导航栏-Navbar.md)
- [IPC通信机制](../modules/08-IPC通信机制.md)