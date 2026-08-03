# 顶部导航栏 (Navbar) 功能总结

> 模块编号：03 | 优先级：P0 | 最后更新：2026-08-03

---

## 1. 功能概述

应用主界面的顶部导航栏，包含应用 Logo、账号标签、File/Help/History/View 菜单、撤销/重做、导出、查找替换 (Ctrl+F)、窗口控制等功能。

## 2. 架构位置

```
src/render/components/Navbar/
├── TopBar.tsx           # 导航栏主组件（布局 + 快捷键）
├── FileMenu.tsx         # 文件菜单（New/Open/Delete/Close + 新建/打开/删除文件夹）
├── HelpMenu.tsx         # 帮助菜单（Settings / Version）
├── HistoryMenu.tsx      # 历史菜单（文件列表 / Manage Files）
├── ViewMenu.tsx         # 视图菜单（Source Code Mode 切换）
├── MoreMenu.tsx         # 更多菜单（Find & Replace / Edit History）
└── WindowControls.tsx   # 窗口控制按钮（Min/Max/Close）
src/render/components/Editor/
└── FindReplaceBar.tsx   # 查找与替换 inline bar（Typora 风格，渲染于 EditorView 内）
src/render/stores/
├── authStore.ts         # 用户认证状态
├── editorStore.ts       # 编辑器状态（当前文件、撤销/重做）
├── uiStore.ts           # UI 状态（isSourceCodeMode, isFindReplaceOpen, 模态框等）
└── historyStore.ts      # 历史文件列表
```

## 3. 实现逻辑流程

### 3.1 布局结构

```
┌──────────────────────────────────────────────────────────────┐
│ 左侧区域 (drag-region)                       右侧区域 (no-drag)│
│                                                              │
│  📔 WeaveMD  @username  │  File ▼  Help ▼  History ▼  View ▼ │
│                                                              │
│                                     ↶ 撤销  ↷ 重做  ⬇ 导出  │
│                                     ⋮ 更多  _ 最小化  □ 全屏 │
│                                              ✕ 关闭          │
└──────────────────────────────────────────────────────────────┘
```

- 高度：`h-12`（48px），`flex-shrink-0`
- 背景色：`--navbar-bg`（根据主题变化）
- 边框：底部 1px `--border-color`

### 3.2 快捷键系统

`TopBar` 组件实现了全局快捷键处理：

```typescript
// 快捷键映射
type ShortcutAction = 'new-file' | 'open-file' | 'undo' | 'redo' | null;

function getShortcutAction(event: KeyboardEvent): ShortcutAction {
  const isCtrl = event.ctrlKey || event.metaKey;
  if (isCtrl && event.key === 'n') return 'new-file';
  if (isCtrl && event.key === 'o') return 'open-file';
  if (isCtrl && event.key === 'z') return 'undo';
  if ((isCtrl && event.key === 'y') || (isCtrl && event.shiftKey && event.key === 'z'))
    return 'redo';
  return null;
}
```

### 3.3 菜单功能详解

#### File 菜单

| 菜单项      | 快捷键   | 实现逻辑                                                                                                                   |
| ----------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| New File    | `Ctrl+N` | 打开 CreateDialog 弹窗（选位置+填名称，文件自动加 .md 后缀，空名提示不退出）→ `file:write` 写磁盘 → `openFile` + `addFile` |
| Open File   | `Ctrl+O` | 调用 `dialog:open-file` IPC → 用磁盘路径作 file ID → `openFile` + `addFile` 到侧栏                                         |
| Delete File | -        | 确认弹框 → 调用 `file:delete-disk` 删磁盘 → `removeFileFromEverywhere` 清列表 → `closeFile` 显示空状态                     |
| Close       | -        | 先保存（如脏数据）→ `editorStore.closeFile()`                                                                              |

#### Help 菜单

| 菜单项   | 实现逻辑                                         |
| -------- | ------------------------------------------------ |
| Settings | `uiStore.openModal('settings')` → 打开设置模态框 |
| Version  | 显示 `v1.1`（来自 `APP_VERSION` 常量）           |

#### History 菜单

| 菜单项       | 实现逻辑                                                 |
| ------------ | -------------------------------------------------------- |
| 文件列表     | 从 `historyStore.files` 读取当前用户文件列表（升序排列） |
| Manage Files | `uiStore.toggleHistoryPanel()` → 打开历史面板            |

#### View 菜单

| 菜单项           | 快捷键     | 实现逻辑                                           |
| ---------------- | ---------- | -------------------------------------------------- |
| Source Code Mode | `Ctrl+`` ` | `uiStore.toggleSourceCodeMode()` → EditorView 切换 |

#### 更多菜单 (⋮)

| 菜单项         | 优先级 | 说明                                                                                                                                                           |
| -------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Find & Replace | P0     | `uiStore.toggleFindReplace()` → EditorView 内 FindReplaceBar                                                                                                   |
| Edit History   | P1     | `uiStore.toggleHistoryPanel()` → HistoryPanel 滑出；宽度可拖拽调整（最小 200px，无上限，持久化）                                                               |
| 新建文件夹     | P1     | 打开 CreateDialog 弹窗（folder 模式）→ `folder.createFolder` → `loadFolderContents`                                                                            |
| 打开文件夹     | P1     | `dialog.openFolder()` → `folder.readFolder(path)` 递归扫描 .md → `fileTreeStore.loadFolderContents` 构建层级树                                                 |
| 删除文件夹     | P1     | `getSelectedFolder()` 从侧栏获取选中文件夹（递归搜索）→ 非文件夹提示 → `folder.deleteFolder` 删磁盘 → `removeFolder` 清列表 → 当前文件在文件夹内则 `closeFile` |

**Find & Replace（Typora 风格 inline bar）：**

查找替换不再使用居中模态弹窗，改为 EditorView 内部的内联栏（`FindReplaceBar.tsx`），渲染在编辑器流式布局内。两种编辑器模式（Normal / Source Code）均可用。

- **布局**：EditorView 顶部 slide-down 动画栏，不阻断编辑区
- **引擎**：`src/render/services/searchEngine.ts` — `findAllMatches`、`replaceAll`、`validateRegex`
- **功能**：查找/替换双 tab、大小写 (Aa)、全词 (W)、正则 (.*)、◀▶ 导航、匹配预览（黄色高亮）、全部替换
- **打开方式**：`Ctrl+F`（EditorView 快捷键）或 More → Find & Replace
- **状态**：`uiStore.isFindReplaceOpen` — TopBar 和 EditorView 共享
- **IME 兼容**：非受控输入 + `isComposing` 守卫；动画仅 opacity（无 transform）

### 3.4 右侧操作按钮

| 按钮     | IPC 通道          | 实现逻辑                      |
| -------- | ----------------- | ----------------------------- |
| ↶ 撤销   | -                 | `editorStore.undo()`          |
| ↷ 重做   | -                 | `editorStore.redo()`          |
| ⬇ 导出   | -                 | 打开导出对话框（MD/Word/PDF） |
| ⋮ 更多   | -                 | 打开更多菜单下拉              |
| _ 最小化 | `window:minimize` | 窗口最小化                    |
| □ 全屏   | `window:maximize` | 窗口最大化/还原切换           |
| ✕ 关闭   | `window:close`    | 窗口关闭（触发自动保存）      |

## 4. 实现细节

### 4.1 组件状态

```typescript
// TopBar 组件状态
const [isLoading, setIsLoading] = useState(false);
const [errorMessage, setErrorMessage] = useState('');

// 从 Zustand stores 获取的状态
const user = useAuthStore((s) => s.user);
const currentFile = useEditorStore((s) => s.currentFile);
const undoStack = useEditorStore((s) => s.undoStack);
const redoStack = useEditorStore((s) => s.redoStack);
const files = useHistoryStore((s) => s.files);
```

### 4.2 菜单样式

```css
/* 菜单容器 */
.navbar-menu {
  background: var(--navbar-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: var(--shadow-dropdown);
}

/* 菜单项 */
.navbar-menu-item {
  color: var(--navbar-text-primary);
  padding: 6px 12px;
  font-size: 13px;
  transition: background 150ms ease;
}

.navbar-menu-item:hover {
  background: #2d2d2d;
}
```

### 4.3 拖拽区域

```css
/* 整个导航栏可拖拽 */
.drag-region {
  -webkit-app-region: drag;
}

/* 菜单和按钮不可拖拽 */
.no-drag {
  -webkit-app-region: no-drag;
}
```

### 4.4 账号标签

- 显示格式：`@{username}`
- 点击可打开账号管理（设置中）
- 颜色：`--navbar-text-sub`

### 4.5 文件操作流程

**New File 流程：**

```
用户点击 New File
  → 打开 CreateDialog 弹窗（选位置+填名称，文件自动加 .md 后缀，空名提示不退出）
  → IPC: file:write(filePath, content)
  → editorStore.openFile({ id: path, name, content }) + fileTreeStore.addFile
  → 编辑器加载空内容
```

**Open File 流程：**

```
用户点击 Open File
  → IPC: dialog:open-file
  → 系统文件对话框（过滤 .md 文件）
  → 用磁盘路径作 file ID
  → editorStore.openFile({ id: path, name, content }) + fileTreeStore.addFile 到侧栏
```

**Delete File 流程：**

```
用户点击 Delete File
  → 确认弹框（"确定删除此文件？"）
  → IPC: file:delete-disk(filePath)
  → 主进程: fs.unlinkSync(filePath) 删磁盘
  → fileTreeStore.removeFileFromEverywhere 清列表
  → editorStore.closeFile() 显示空状态
```

**Create Folder 流程：**

```
用户点击更多菜单"新建文件夹"
  → 打开 CreateDialog 弹窗（folder 模式，选父路径+填名称）
  → IPC: folder:create(parentPath, folderName)
  → 主进程: fs.mkdirSync 创建磁盘文件夹
  → fileTreeStore.loadFolderContents 刷新文件树
```

## 5. 与其他模块的交互

| 模块       | 交互方式                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| 编辑器     | `editorStore` 操作文件/撤销/重做；`uiStore.toggleFindReplace()` 切换查找栏；`uiStore.toggleSourceCodeMode()` 切换源码模式 |
| 认证系统   | 显示当前账号标签；通过 `authStore.user` 获取用户信息                                                                      |
| 设置       | 通过 `uiStore.openModal('settings')` 打开设置                                                                             |
| 窗口控制   | 通过 IPC 调用窗口控制（最小化/最大化/关闭）                                                                               |
| 数据持久化 | 通过 IPC 调用文件系统直操作（file:write/read/delete-disk）                                                                |
| 历史面板   | 通过 `uiStore.toggleHistoryPanel()` 打开/关闭                                                                             |

## 6. 关键设计决策

1. **无边框窗口**：导航栏顶部区域作为窗口拖拽区域，菜单和按钮使用 `no-drag` 排除
2. **全局快捷键**：在 TopBar 组件中监听键盘事件，实现 `Ctrl+N/O/Z/Y` 快捷键
3. **自动保存**：关闭窗口时通过 `before-quit` 事件自动保存，无需手动保存按钮
4. **菜单分层**：File/Help/History/View 四个主菜单 + 更多菜单 (⋮)，按功能域划分
5. **账号标签**：导航栏显示当前账号，提供快速切换入口
6. **View 菜单**：Source Code Mode 切换通过 `uiStore.isSourceCodeMode` 状态共享，EditorView 和 TopBar 均可触发
7. **Find & Replace inline**：不再使用模态弹窗，改为 EditorView 内联栏（`uiStore.isFindReplaceOpen`），避免 IME 焦点转移问题
8. **i18n 全覆盖**：TopBar + 6 个菜单组件（FileMenu/HelpMenu/HistoryMenu/ViewMenu/MoreMenu）+ WindowControls 全部接入 `useI18n`；品牌名 "WeaveMD" 与 emoji 图标保持硬编码；Version 项用 `{version}` 占位符替换
