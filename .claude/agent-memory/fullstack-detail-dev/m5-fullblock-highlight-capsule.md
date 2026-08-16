---
name: m5-fullblock-highlight-capsule
description: M5 选区整块渐变高亮 + 左端取消胶囊的实现要点与 Edit 工具对 U+200B 的编辑坑
metadata:
  type: project
---

# M5：选区覆盖块整块渐变高亮 + 左端「取消」胶囊（需求①已交付）

入口：`useRewriteStore.selectionContext?.sel` → `buildHighlightRanges` → 覆盖的每个叶整块
`{leafIndex:i, start:0, end:叶长}`（start/end 不再取选区 offset）；EditorV2 `rewriteHighlights`
memo 改为每叶取 `.block-content` span 整行 `getBoundingClientRect()`（不再用子串 range/TreeWalker）。
胶囊 `.rewrite-cancel-capsule`：absolute + z-70 + `pointer-events:auto`，`transform:translateY(-100%)`
+ `margin-top:-8px` 上移首块左缘；内含 `button` onClick → `useRewriteStore.getState().clearRewrite()`。
高亮本体 `.rewrite-highlight` 仍 `pointer-events:none` 不入 contentEditable（铁律）。

**Why:** 需求①要求选区选中的块整体渐变蓝（左浅右深）+ 左端常驻胶囊取消；CSS `linear-gradient(90deg,
rgba(59,130,246,0.16), rgba(37,99,235,0.45))` 负责渐变，JSX 只注入 left/top 定位。

**How to apply:** 后续改动 EditorV2/高亮时以 `.rewrite-highlight`（渐变蓝）与 `.rewrite-cancel-capsule`
（取消胶囊）两个 CSS 类为准；胶囊仅高亮非空时渲染。

## Edit 工具坑：源码含 U+200B 字符（零宽空格）
EditorV2 旧的高亮代码用 `value[i] !== '​'` 判零宽空格，文件字节是字面 U+200B。
**Read 显示为 `​` 转义，但 Edit 的 old_string 传入字面/转义均无法匹配**（Edit 报 swap 也失败）。
可靠改法：`node -e` 脚本用 `indexOf(startMarker)`/`indexOf(endMarker)` 定位后 `s.slice` 替换，
锚点选**不含零宽空格**的行（如 `const span = leaves[r.leafIndex];` … `[content, selectionSel, highlightTick]);`）。
相关：[[fts5-cjk-unicode61]]
