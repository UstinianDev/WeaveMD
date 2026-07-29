# Tasks

- [x] Task 1: uiStore 添加 outlineWidth 状态
  - [x] 添加 `outlineWidth: number`（默认 280）
  - [x] 添加 `setOutlineWidth: (width: number) => void`，限制 200-500 范围
  - [x] 在 `persistSettings` / `loadSettings` 中持久化 outlineWidth

- [x] Task 2: OutlinePanel 增大字体 + 自定义滚动条样式
  - [x] FONT_CLASSES 改为 `['text-lg font-semibold', 'text-base font-medium', 'text-sm']`
  - [x] 为目录内容区添加 `.outline-scroll` CSS 类，使用 10px 宽滚动条
  - [x] globals.css 添加 `.outline-scroll::-webkit-scrollbar` 样式（10px, 圆角, 悬停加粗）

- [x] Task 3: MainPage 实现可拖拽调整目录宽度
  - [x] 从 uiStore 读取 `outlineWidth`，用 `style={{ width: outlineWidth }}` 替代 `w-1/4`
  - [x] 在目录面板右侧添加拖拽手柄 div（`cursor: col-resize`）
  - [x] 实现 mousedown → mousemove → mouseup 拖拽逻辑
  - [x] 拖拽时添加 `border-r-2 border-accent` 视觉反馈
  - [x] 拖拽时 `document.body.style.cursor = 'col-resize'` + `userSelect: 'none'`

- [x] Task 4: 编辑器滚动条样式优化
  - [x] globals.css 中 `.editor-scroll-container::-webkit-scrollbar` 宽度改为 10px
  - [x] thumb 样式改为 `border-radius: 5px`，悬停时 `background: var(--text-sub)`

- [x] Task 5: 验证
  - [x] `npm run typecheck` 通过
  - [x] `npm run lint` 通过
  - [x] `npm run test` 全部通过

# Task Dependencies

- Task 2 depends on Task 1 (不需要，独立)
- Task 3 depends on Task 1 (需要 outlineWidth 状态)
- Task 4 无依赖
- Task 5 depends on All
