# 保存功能失效修复状态文档

## 任务分级

- **请求类型**：Bug 修复
- **影响面**：单模块（文件保存功能）
- **预估工时**：S（≤30 分钟）
- **裁剪理由**：S级跳过完整拷问/调研/规划，直接进入最小修复路径

## 问题分析

### 根本原因

用户日志显示：
```
[saveFile] 文件类型: DB文件
[saveFile] 调用 window.weaveMD.file.save，fileId: 测试.md
[saveFile] DB保存结果: {success: false, message: 'File not found'}
```

**问题**：`saveFile` 函数通过 `id` 是否包含路径分隔符（`/` 或 `\`）来判断是磁盘文件还是 DB 文件。但某些情况下磁盘文件的 `id` 不含路径分隔符（如 AI 创建的文件），导致被错误当作 DB 文件处理。

### 代码审查结果

1. **保存按钮实现**（TopBar.tsx:88-96）：
   - 直接调用 `saveFile()` 函数
   - 检查 `isDirty` 和 `saving` 状态

2. **saveFile 函数**（editorStore.ts:55-112）：
   - 原逻辑：通过 `id` 是否包含路径分隔符判断文件类型
   - 问题：AI 创建的文件 `id` 是文件名，不含路径分隔符

3. **FileTreePanel**（FileTreePanel.tsx:74-116）：
   - `doSwitchFile` 使用 `node.id` 作为文件 `id`
   - 问题：AI 创建的文件节点 `id` 是文件名，不是路径

### 测试结果

1. **现有测试**：所有 13 个 editorStore 测试通过
2. **新增测试**：4 个保存功能测试通过

## 修复方案

### 修改1：FileTreePanel.tsx
- 修改 `doSwitchFile` 函数，使用 `node.path || node.id` 作为文件 `id`
- 确保磁盘文件使用完整路径作为 `id`

### 修改2：editorStore.ts
- 改进 `saveFile` 函数的文件类型判断逻辑
- 添加兜底方案：当 DB 保存失败时，尝试磁盘保存
- 添加详细的调试日志

## 当前状态

- [x] 任务分级与分类
- [x] 需求对齐
- [x] 代码审查
- [x] 测试验证
- [x] 调试日志添加
- [x] IPC调用验证
- [x] 状态更新检查
- [x] 修复测试
- [x] FileTreePanel 修复
- [x] editorStore 修复

## 测试证据

1. **editorStore 测试**：13/13 通过
2. **保存功能测试**：4/4 通过
3. **调试日志**：已添加详细的控制台日志

## 验证方法

1. 运行 `npm run dev` 启动应用
2. 通过 AI 创建文件（如"创建一个测试.md文件"）
3. 修改文件内容
4. 点击保存按钮或 Ctrl+S
5. 检查控制台日志，确认保存成功