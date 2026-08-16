---
name: rewrite-highlight-leaf-index-a3
description: A3 持久高亮——leafIndex→DOM .block-content 的位置映射（非 id），及零宽空格字面量不被 eslint no-irregular-whitespace 接受
metadata:
  type: project
---

第 7 期批次③（A2 混合工具栏 + A3 持久高亮），提交 `973b9e4`（2026-08-15）。

**A3 高亮定位**：`highlight.ts buildHighlightRanges(content, sel)` 纯函数按叶序下标 + offset 映射到当前 markdownToState 解析树叶；EditorV2 再把这些 `{leafIndex, start, end}` 渲染成绝对定位 `.rewrite-highlight` overlay。leafIndex → DOM `.block-content` span 的查找是**位置映射**（`leaves[leafIndex]` 直接按下标取 `.block-content`），延续 [[rewrite-leaf-index-a4]] 的「瞬时位置映射、非跨解析 id 键」约束。坐标用 `range.getBoundingClientRect()` 视口坐标减去宿主 `relative` 容器自身 rect（overlay absolute 定位于容器内），并监听容器 scroll + window resize 重算。

**关键坑（偏离直觉）**：offset 定位沿用 kernel/selection.ts `offsetToDomPoint` 的 TreeWalker「跳过零宽空格」口径；而 `.block-content` 经 `dangerouslySetInnerHTML` 行内渲染后 textContent 与 leaf.text 一致（stripZeroWidth 后），所以 offset 空间 1:1。**但 jsdom 单测对 overlay 定位不可信**——e2e 才是高亮可见性的权威（断言 `.rewrite-highlight` 出现/随 selectionContext 清除）。

**eslint 陷阱**：字符串里写**字面零宽空格 U+200B**（`'​'` / `/​/g`）会被 `no-irregular-whitespace` 判 error（基线 lint 门禁 8 warning 0 error，src/ 内准入）；必须写**转义文本** `'\\u200B'` / `/\\u200B/`（backslash-u… 五个字符）。用 Python 改这类字面量时注意 shell heredoc 会吃反斜杠、引号，建议先写临时 .py 文件再执行，或按 codepoint 逐字符构造。
