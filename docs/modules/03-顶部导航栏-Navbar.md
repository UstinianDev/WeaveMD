# 顶部导航栏 (Navbar) 功能总结

> 模块编号：03 | 优先级：P0 | 最后更新：2026-07-24

---

## 1. 功能概述

应用主界面的顶部导航栏，包含应用 Logo、账号标签、文件操作菜单、帮助菜单、历史记录菜单、撤销/重做、导出、查找替换 (Ctrl+F)、窗口控制等功能。

## 2. 架构位置

```
src/render/components/Navbar/
├── TopBar.tsx           # 导航栏主组件（布局 + 快捷键）
├── FileMenu.tsx         # 文件菜单（New/Open/Delete/Close）
├── MoreMenu.tsx         # 更多菜单（Find & Replace / Edit History）
├── HelpMenu.tsx         # 帮助菜单（Settings / Version）
├── WindowControls.tsx   # 窗口控制按钮（Min/Max/Close）
└── HistoryMenu.tsx      # 历史菜单（文件列表 / Manage Files）
src/render/components/Editor/
└── FindReplaceModal.tsx # 查找与替换弹窗（居中模态框，macOS 三色圆点，双 Tab）
src/render/stores/
├── authStore.ts         # 用户认证状态
├── editorStore.ts       # 编辑器状态（当前文件、撤销/重做）
├── uiStore.ts           # UI 状态（模态框、历史面板）
└── historyStore.ts      # 历史文件列表
```

## 3. 实现逻辑流程

### 3.1 布局结构

```
┌──────────────────────────────────────────────────────────────┐
│ 左侧区域 (drag-region)                       右侧区域 (no-drag)│
│                                                              │
│  📔 WeaveMD  @username  │  File ▼  Help ▼  History ▼        │
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

| 菜单项      | 快捷键   | 实现逻辑                                                                                |
| ----------- | -------- | --------------------------------------------------------------------------------------- |
| New File    | `Ctrl+N` | 调用 `file:create` IPC → 创建新文件 → `editorStore.openFile()`                          |
| Open File   | `Ctrl+O` | 调用 `dialog:open-file` IPC → 系统文件对话框 → 读取 .md 内容 → `editorStore.openFile()` |
| Delete File | -        | 确认弹框 → 调用 `file:delete` IPC → 软删除 → `editorStore.closeFile()`                  |
| Close       | -        | 先保存（如脏数据）→ `editorStore.closeFile()`                                           |

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

#### 更多菜单 (⋮)

| 菜单项         | 优先级 | 说明                              |
| -------------- | ------ | --------------------------------- |
| Find & Replace | P0     | `uiStore.openModal('findReplace')` |
| Edit History   | P1     | `uiStore.toggleHistoryPanel()`    |

**Find & Replace 弹窗详情：**

点击后在屏幕正中弹出居中模态框 (`FindReplaceModal.tsx`)，搜索 `editorStore.content` 原始文本。采用 macOS 终端风格的标题栏（红/黄/绿三色圆点）。使用纯透明度动画（无 CSS `transform`）避免 IME 候选窗定位问题：

- **外观**：居中模态框（520px 宽）+ 半透明遮罩，左上角红色（#ff5f57）/黄色（#febc2e）/绿色（#28c840）三个圆点
- **动画**：`modal-content-fade-in` — 仅 opacity 变化，无 `transform`，IME 候选窗定位永远正确
- **搜索行**：查找内容输入框 → 选项切换（Aa 大小写/W 全词/.* 正则）→ ◀▶ 导航按钮 → 匹配计数器（如 "2/10"）
- **替换行**（切换至"替换"标签显示）：替换内容输入框 → 替换按钮及全部替换按钮
- **匹配预览**：实时显示当前匹配的行号、列号及上下文（黄色高亮）
- **搜索引擎**：独立模块 `src/render/services/searchEngine.ts` — 支持大小写敏感、全词匹配、正则搜索及正则验证
- **键盘快捷键**：`Ctrl+F` 切换打开/关闭（EditorView 注册）；Enter 查找下一处；点击遮罩或按 Esc 关闭
- **IME 兼容**：输入框采用非受控模式（`defaultValue` + `key` 强制重挂载），`onKeyDown` 以 `nativeEvent.isComposing || keyCode === 229` 守卫 Enter 键

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
  → 弹出文件名输入框（默认 "untitled.md"）
  → IPC: file:create(userId, name)
  → 主进程: INSERT INTO files → 返回 IFile
  → editorStore.openFile(file)
  → 编辑器加载空内容
```

**Open File 流程：**

```
用户点击 Open File
  → IPC: dialog:open-file
  → 系统文件对话框（过滤 .md 文件）
  → 主进程: fs.readFileSync(filePath, 'utf-8')
  → 返回 { path, name, content }
  → editorStore.openFile({ id: path, name, content, ... })
```

**Delete File 流程：**

```
用户点击 Delete File
  → 确认弹框（"确定删除此文件？"）
  → IPC: file:delete(fileId, userId)
  → 主进程: UPDATE files SET deleted_at = ? WHERE id = ?
  → 成功 → editorStore.closeFile()
  → 刷新文件列表
```

## 5. 与其他模块的交互

| 模块       | 交互方式                                             |
| ---------- | ---------------------------------------------------- |
| 编辑器     | 通过 `editorStore` 操作当前文件、撤销/重做；FindReplaceModal 搜索 `editorStore.content` 并调用 `updateContent` 替换 |
| 认证系统   | 显示当前账号标签；通过 `authStore.user` 获取用户信息 |
| 设置       | 通过 `uiStore.openModal('settings')` 打开设置        |
| 窗口控制   | 通过 IPC 调用窗口控制（最小化/最大化/关闭）          |
| 数据持久化 | 通过 IPC 调用文件 CRUD 操作                          |
| 历史面板   | 通过 `uiStore.toggleHistoryPanel()` 打开/关闭        |

## 6. 关键设计决策

1. **无边框窗口**：导航栏顶部区域作为窗口拖拽区域，菜单和按钮使用 `no-drag` 排除
2. **全局快捷键**：在 TopBar 组件中监听键盘事件，实现 `Ctrl+N/O/Z/Y` 快捷键
3. **自动保存**：关闭窗口时通过 `before-quit` 事件自动保存，无需手动保存按钮
4. **菜单分层**：File/Help/History 三个主菜单 + 更多菜单 (⋮)，按功能域划分
5. **账号标签**：导航栏显示当前账号，提供快速切换入口
