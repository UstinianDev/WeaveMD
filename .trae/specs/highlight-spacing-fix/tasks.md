# Tasks

- [x] Task 1: 修复 .editor-block-highlight CSS 避免垂直间距收缩
  - 将 `margin: 0 -6px` 改为 `margin-left: -6px; margin-right: -6px`
  - 将 `padding: 0 6px` 改为 `padding-left: 6px; padding-right: 6px`
- [x] Task 2: 将底部 padding 改为动态 50vh
  - 将 EditorScrollContainer 的 `style={{ padding: '40px 0 400px 0' }}` 改为 `padding: '40px 0 50vh 0'`
- [x] Task 3: 验证 typecheck 和 lint 通过
