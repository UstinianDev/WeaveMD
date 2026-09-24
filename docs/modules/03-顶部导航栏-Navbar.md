# 03 — 顶部导航栏

> 最后更新：2026-09-24

## 做什么

应用主界面顶部导航栏：应用 Logo、编辑器/AI 面板切换、Source 模式切换、帮助菜单、撤销/重做/保存、设置、窗口控制。

## 架构

```
src/render/components/Navbar/
├── TopBar.tsx           ← 导航栏主组件
│                           渲染：Logo / 收起编辑器 / AI 面板 / Source 模式（内联 IconButton）
│                                 / HelpMenu / 撤销 / 重做 / 保存 / 设置 / WindowControls
├── HelpMenu.tsx         ← 帮助菜单（反馈 / 检查更新 / 版本）
├── WindowControls.tsx   ← 窗口控制（Min/Max/Close）
├── NavMenu.tsx          ← 菜单包装器（HelpMenu 复用）
└── CreatePanel.tsx      ← 新建文件/文件夹弹窗（被 OutlinePanel 复用）

src/render/components/Editor/panels/
├── SidebarToolbar.tsx   ← 目录区工具栏：搜索 + 导入 + 导出 + 新建文件/文件夹
├── FindReplaceBar.tsx   ← 查找替换 inline bar（Ctrl+F）
└── HistoryPanel.tsx     ← 编辑历史面板（宽度可拖拽）
```

## 3. 实现逻辑流程

### 3.1 布局结构

```
┌─────────────────────────────────────────────────────────────────┐
│ 左侧区域 (no-drag)                     右侧区域 (no-drag)       │
│                                                                 │
│  📔 │ ⊟ │ 🤖 │ 👁 │ ❓         ↶ 撤销  ↷ 重做  💾 保存  ⚙ │ ─ □ ✕│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

- 左侧：Logo、收起编辑器、AI 面板切换、**Source/Rich 模式切换（内联 IconButton）**、帮助菜单
- 右侧：撤销、重做、**保存（Ctrl+S）**、设置、窗口控制

- 高度：`h-12`（48px），`flex-shrink-0`
- 背景色：`--navbar-bg`（根据主题变化）
- 边框：底部 1px `--border-color`

### 3.2 快捷键系统

快捷键**不在 TopBar 内监听**，统一由 `src/render/hooks/useGlobalShortcuts.ts` 模块级单例 listener 承担
（合并原 TopBar 与 EditorView 两处 keydown，避免双 listener 重复触发；含 `shouldIgnoreGlobalShortcutTarget`
目标过滤，普通输入框内不拦截）。

| 快捷键 | 动作 | 回调来源 |
|--------|------|---------|
| `Ctrl+F` | 查找替换 | hook 内部（`uiStore.toggleFindReplace`） |
| `Ctrl+`` ` | 切换 Source 模式 | hook 内部（`uiStore.toggleSourceCodeMode`） |
| `Ctrl+N` | 新建文件 | `TopBar.tsx:59` 传入 `onNewFile` → `useNavbarActions.handleNewFile` |
| `Ctrl+O` | 打开文件 | `TopBar.tsx:59` 传入 `onOpenFile` → `handleOpenFile` |
| `Ctrl+S` | 保存 | `TopBar.tsx:59` 传入 `onSave` → `handleSave`（带 saving 状态） |
| `Ctrl+Z` | 撤销（先 flush 草稿） | hook 内部 |
| `Ctrl+Y` / `Ctrl+Shift+Z` | 重做 | hook 内部 |

调用方两处：`TopBar.tsx:59 useGlobalShortcuts({onSave, onOpenFile, onNewFile})`、
`EditorView.tsx:45 useGlobalShortcuts()`（无参，Ctrl+F/`/Z/Y 仍生效）。

### 3.3 菜单与功能入口

导航栏上只有 **Help 一个菜单**；新建/打开/删除/导出/历史/源码模式等入口分布在侧栏工具栏、全局快捷键与文件树。

#### Help 菜单

| 菜单项   | 实现逻辑                                         |
| -------- | ------------------------------------------------ |
| 反馈     | `FeedbackModal`（`feedbackOpen` state）          |
| 检查更新 | `electron-updater`（可用/下载/安装/跳过状态机）  |
| Settings | `uiStore.toggleSettings()` → 全局 UnifiedSettings |
| Version  | `window.weaveMD.version`（IPC `app:get-version` → 主进程 `app.getVersion()`）替换 `Version {version}` 占位符 |

#### 其余功能入口

| 功能 | 入口 |
|------|------|
| 新建文件 / 文件夹 | `SidebarToolbar` → `<CreatePanel>`；快捷键 `Ctrl+N` |
| 打开文件 | 快捷键 `Ctrl+O` → `useNavbarActions.handleOpenFile` |
| 删除文件 / 文件夹 | 文件树右键 → `handleDeleteFile` / `handleDeleteFolder` |
| 导出 | `SidebarToolbar` 导出下拉 → `handleExport` |
| 源码模式 | TopBar 内联 IconButton；快捷键 `` Ctrl+` `` |
| 查找替换 | 快捷键 `Ctrl+F` → EditorView 内联 `FindReplaceBar` |
| 编辑历史 | 文件树入口 → `HistoryPanel`（宽度可拖拽，最小 200px） |

#### Find & Replace（inline bar）

不用模态弹窗，改为 EditorView 内部内联栏（`FindReplaceBar.tsx`），Normal / Source 两种模式均可用。

- **布局**：EditorView 顶部 slide-down 动画栏，不阻断编辑区
- **引擎**：`src/render/services/searchEngine.ts` — `findAllMatches`、`replaceAll`、`validateRegex`
- **功能**：查找/替换双 tab、大小写 (Aa)、全词 (W)、正则 (.*)、◀▶ 导航、匹配预览（黄色高亮）、全部替换
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
// TopBar 本地 state（实际仅 2 个）
const [feedbackOpen, setFeedbackOpen] = useState(false);
const [saving, setSaving] = useState(false);

// 从 Zustand stores 获取的状态
const isDirty = useEditorStore((s) => s.isDirty);
const saveFile = useEditorStore((s) => s.saveFile);
const isSourceCodeMode = useUIStore((s) => s.isSourceCodeMode);
const undoStack = useEditorStore((s) => s.undoStack);
const redoStack = useEditorStore((s) => s.redoStack);

// isLoading / errorMessage 来自 useNavbarActions 解构（非 useState）
const { isLoading, errorMessage, handleNewFile, handleOpenFile, handleSave, ... } = useNavbarActions();
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

/* 菜单触发器（原 6 个菜单统一，现仅 HelpMenu 使用） */
.navbar-menu-trigger {
  font-size: 15px;
  letter-spacing: 0.06em;
  word-spacing: 0.1em;
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

> 触发源：`Ctrl+N/O`（`useGlobalShortcuts` → `useNavbarActions`）、`SidebarToolbar`（导入/导出/新建）
> 与文件树右键。**IPC 通道名与处理逻辑见 `src/shared/constants.ts`**；
> 新建弹窗组件为 `Navbar/CreatePanel.tsx`（被 `Editor/panels/OutlinePanel.tsx` 复用）。

**New File 流程（触发：`Ctrl+N` / `SidebarToolbar` 新建按钮）：**

```
handleNewFile (useNavbarActions:75)
  → dialog.saveFilePath 取路径（自动补 .md）
  → IPC: file:write(filePath, content)
  → editorStore.openFile({ id: path, name, content }) + fileTreeStore.addFile
  → 编辑器加载空内容
```

**Open File 流程（触发：`Ctrl+O` / 文件树）：**

```
handleOpenFile (useNavbarActions:109)
  → IPC: dialog:open-file
  → 系统文件对话框（过滤 .md 文件）
  → 用磁盘路径作 file ID
  → editorStore.openFile(...) + fileTreeStore.addFile 到侧栏
```

**Delete File 流程（触发：文件树右键）：**

```
handleDeleteFile (useNavbarActions:137)
  → 确认弹框（"确定删除此文件？"）
  → IPC: file:delete-disk(filePath)
  → 主进程: fs.unlinkSync(filePath) 删磁盘
  → fileTreeStore.removeFileFromEverywhere 清列表
  → editorStore.closeFile() 显示空状态
```

**Create Folder 流程（触发：`SidebarToolbar` 新建文件夹）：**

```
handleNewFolder (useNavbarActions:159)
  → <CreatePanel type="folder">（Navbar/CreatePanel.tsx）
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
2. **全局快捷键**：统一收敛到 `useGlobalShortcuts` 模块级单例 listener（合并原 TopBar/EditorView 两处 keydown），
   TopBar 只通过 `useGlobalShortcuts({onSave, onOpenFile, onNewFile})` 注入回调
3. **自动保存**：关闭窗口时通过 `before-quit` 事件自动保存，无需手动保存按钮
4. **菜单收敛**：导航栏只保留 HelpMenu，文件/历史/导出/源码/查找等功能入口分布在 `SidebarToolbar`、`useGlobalShortcuts` 与文件树
5. **账号标签**：导航栏显示当前账号，提供快速切换入口
6. **Source 模式切换**：通过 `uiStore.isSourceCodeMode` 状态共享，EditorView 与 TopBar 内联 IconButton 均可触发
7. **Find & Replace inline**：不用模态弹窗，改为 EditorView 内联栏（`uiStore.isFindReplaceOpen`），避免 IME 焦点转移问题
8. **i18n 全覆盖**：TopBar + HelpMenu + WindowControls 接入 `useI18n`；品牌名 "WeaveMD" 与 emoji 图标保持硬编码；Version 项用 `{version}` 占位符替换
