// ============================================
// WeaveMD — DOM selectors 常量集中
// ============================================
// 全项目 CSS 选择器统一于此，避免字面量散落

/** 编辑主区滚动容器（EditorScrollContainer 渲染的 .editor-scroll-container div） */
export const SEL_EDITOR_SCROLL_CONTAINER = '.editor-scroll-container';

/** Monaco Editor 根节点选择器 */
export const SEL_MONACO_EDITOR_ROOT = '.monaco-editor';

/** Monaco 内部隐藏 textarea（仅 <textarea> 元素，IME 输入与键盘事件桥接） */
export const SEL_MONACO_HIDDEN_TEXTAREA = 'textarea.ime-text-area, textarea.inputarea';

/** Find & Replace 工具栏 — 输入区归属选择器 */
export const SEL_FIND_REPLACE_BAR = '.find-replace-bar';