# 状态文档：目录区工具栏迁移

## 任务分级
- **类型**: 功能开发
- **影响面**: 跨模块（FileTreePanel + Navbar + 工具栏 + 右键菜单）
- **档位**: M（半天内·1~3 模块）

## 完成项

### 1. FILE_RENAME IPC 通道 ✅
- `src/shared/constants.ts` — 新增 `FILE_RENAME` 通道
- `src/main/ipc-handlers.ts` — 注册 `file.rename` handler（fs.renameSync + 重名校验）
- `src/main/preload.ts` — 暴露 `file.rename` API
- `src/render/utils/weaveMDBridge.ts` — 补充 browser bridge 降级

### 2. fileTreeStore.renameNode ✅
- 新增 `renameNode(oldId, newName)` action
- 递归更新 looseFiles 和 folder tree 中的 id/name/path

### 3. SidebarToolbar 组件 ✅
- `src/render/components/Editor/panels/SidebarToolbar.tsx`
- 从左到右：📑目录 | 📁文件 | ◀折叠 | 🔍搜索 | ⬆导入 | ⬇导出 | 📄新建文件 | 📁新建文件夹
- 导出下拉菜单支持 8 种格式

### 4. FileSearchBar 搜索组件 ✅
- `src/render/components/Editor/panels/FileSearchBar.tsx`
- 工具栏下方展开，实时过滤文件树，Escape 或×关闭

### 5. ImportMarkdownModal 模态框 ✅
- `src/render/components/Editor/panels/ImportMarkdownModal.tsx`
- 参照 Notus 原型图：导入到下拉框 + 重名处理 + 拖拽区 + 选择文件/目录 + 待导入列表

### 6. ContextMenu 右键菜单 ✅
- `src/render/components/Editor/panels/ContextMenu.tsx`
- 右击文件/文件夹弹出：重命名 + 删除

### 7. FileTreePanel 增强 ✅
- 右键菜单（重命名/删除）
- 双击已打开文件 → 关闭文件
- inline 重命名（RenameInput 组件）
- 搜索过滤（文件名匹配 + 文件夹递归检查）

### 8. 顶部导航栏精简 ✅
- 移除 FileMenu、HistoryMenu、MoreMenu、ExportMenu
- 保留：HelpMenu、ViewMenu、Undo/Redo、Settings、WindowControls

### 9. i18n keys ✅
- zh-CN.json、en.json、zh-TW.json 新增 sidebar.* 和 import.* keys

## 测试证据
- **tsc**: 0 新增 error（ipc.test.ts 为预存问题）
- **lint**: 0 error, 0 warning
- **vitest**: 1528/1528 通过

## 未完成项
- 导入模态框的拖拽文件功能（Electron 中需要额外 IPC 支持）
- 重命名时同步更新 recentStore 中的记录

## 风险
- L2 低风险：UI 重构，不影响核心编辑逻辑
