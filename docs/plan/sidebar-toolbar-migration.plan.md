# 实施计划：目录区工具栏迁移

## 变更清单

### 新增文件
- `src/render/components/Editor/panels/SidebarToolbar.tsx` — 侧栏工具栏组件
- `src/render/components/Editor/panels/FileSearchBar.tsx` — 文件搜索框组件
- `src/render/components/Editor/panels/ImportMarkdownModal.tsx` — 导入 Markdown 模态框
- `src/render/components/Editor/panels/ContextMenu.tsx` — 右键上下文菜单
- `src/render/components/Editor/panels/RenameInput.tsx` — 重命名 inline 输入框

### 修改文件
- `src/render/components/Editor/panels/OutlinePanel.tsx` — 重构 Tab Header 为工具栏
- `src/render/components/Editor/panels/FileTreePanel.tsx` — 增加右键菜单、双击切换、重命名、搜索过滤
- `src/render/components/Navbar/TopBar.tsx` — 移除 FileMenu/HistoryMenu/MoreMenu/ExportMenu
- `src/render/hooks/useNavbarActions.ts` — 移除不再需要的导出函数（迁移到侧栏）
- `src/shared/constants.ts` — 新增 FILE_RENAME IPC 通道
- `src/main/ipc-handlers.ts` — 注册 FILE_RENAME handler
- `src/main/preload.ts` — 暴露 file.rename API
- `src/render/stores/fileTreeStore.ts` — 新增 renameNode action
- `src/render/i18n/zh-CN.json` + `en.json` + `zh-TW.json` — 新增 i18n key

### 验收标准
1. 侧栏工具栏 8 个图标正确排列，功能正常
2. 搜索框点击展开/关闭，实时过滤文件树
3. 导入 Markdown 模态框可选文件/目录，导入后出现在文件树
4. 右键菜单重命名/删除功能正常
5. 双击已打开文件可关闭
6. 顶部导航栏精简（无 File/History/More/Export）
7. tsc 0 新增 error | vitest 通过 | lint 0 新增 error
