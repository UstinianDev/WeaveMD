# WeaveMD — 前端设计规范

> 本章节为占位文档，将在开发过程中逐步完善。

## UI 规范
- 配色系统、排版、间距网格、圆角 — 详见 `WeaveMD_需求文档.txt` UI/UX 设计规范章节
- 深色主题：`<html class="dark">` + TailwindCSS dark mode

## 组件架构
```
components/
├── Auth/        # LoginPage, SignupPage, SplashLoader
├── Editor/      # EditorView, OutlinePanel, FloatingToolbar
├── Navbar/      # TopBar, FileMenu, MoreMenu
├── Settings/    # SettingsModal, ThemeSelector
└── Common/      # Button, Input, Modal, Dropdown
```

## 状态管理
- Zustand stores: `auth`, `editor`, `ui`, `history`
- 按账号隔离：切换账号时重置对应 store

## 关键约定
- 无内联样式，全部使用 Tailwind utility classes
- 浮动工具栏定位：选中文本上方 8px，半透明 #1A1A1A