# 浮动工具栏实时渲染 + 格式化叠加 - The Implementation Plan

## [x] Task 1: 修复块类型转换 handleBlockTypeChange + handleStructureChange

- **Priority**: high
- **Depends On**: None
- **Description**:
  - `EditorView.handleBlockTypeChange(id, newType, headingLevel?)`：不再清空 sourceLines，改为调用 `buildSourceLinesFromContent(currentBlock, text)` + 前缀拼接后使用 `updateBlockSource` 重建类型。支持 12 种：paragraph / heading-1..6 / unordered-list-item / ordered-list-item / task-list-item / code-fence / blockquote。对 task-list-item 插入 `- [ ] ` 前缀；code-fence 外包 ``` fence；blockquote 每行加 `> `。
  - `FloatingToolbarWYSIWYG.handleStructureChange`：删除错误的 `headingLevel` 分支（用字符串替换 content 的那部分），统一用 `onBlockTypeChange(blockId, blockType, headingLevel)` 三参数回调。
  - 工具栏 props 签名更新为 `onBlockTypeChange: (blockId: BlockId, newType: BlockType, headingLevel?: number) => void`。
  - 每次转换前 `pushUndo(serializeBlockTree(prev))`。
- **Acceptance Criteria Addressed**: AC-1, AC-5, AC-6, AC-7
- **Test Requirements**:
  - `programmatic` TR-1.1: `npm run typecheck` + `npm run lint` 通过
  - `programmatic` TR-1.2: `npm run test` 现有测试通过
  - `human-judgement` TR-1.3: 依次选 12 个结构选项，块视觉立即切换到对应样式（H1 大字号 / 引用紫竖条 / 列表 bullet / 代码块灰底等），光标位置不丢

## [x] Task 2: DOM 内联格式化 — Bold/Italic/Underline/Highlight/Code 用 execCommand 叠加

- **Priority**: high
- **Depends On**: Task 1（建议先完成结构转换再做格式化，无强依赖可并行；若资源够则并行，但测试要串行）
- **Description**:
  - 重写 `FloatingToolbarWYSIWYG.handleFormat`：不再操作 sourceLines 字符串，改为调用 `document.execCommand(cmd)`：
    - Bold → `execCommand('bold', false, null)` → 产生 `<strong>`
    - Italic → `execCommand('italic', false, null)` → `<em>`
    - Underline → `execCommand('underline', false, null)` → `<u>`
    - Highlight → 调用新 helper `wrapRangeWithTag('mark')`，用 Range.surroundContents 包装 `<mark>`；execCommand hiliteColor 在不同浏览器不一致，手动用 Range API 更稳定
    - Code → `wrapRangeWithTag('code')`，产生 `<code>` 并加 class `inline-code`
  - 在 globals.css 中补充 `<mark>` 和 `code.inline-code` 的样式：`mark { background: var(--accent)/20; color: inherit; border-radius: 3px; padding: 0 2px; }`；`inline-code { background: var(--bg-code); color: var(--text-code); padding: 1px 4px; border-radius: 4px; font-family: var(--font-mono); font-size: 13px; }`
  - 每次格式化后手动触发 `input` 事件：`container.dispatchEvent(new Event('input', { bubbles: true }))`，走现有 EditorView 的 onInput → debounce → buildSourceLinesFromContent → 写回 store 管道
  - 格式化前 pushUndo
- **Acceptance Criteria Addressed**: AC-2, AC-3, AC-5, AC-6, AC-7
- **Test Requirements**:
  - `programmatic` TR-2.1: `npm run typecheck` 通过
  - `human-judgement` TR-2.2: 选中一段文本，依次按 B→I→U，视觉三属性同时存在；再按 B 取消加粗后 I+U 保留；全部取消后恢复普通
  - `human-judgement` TR-2.3: H→C 叠加，`<mark><code class="inline-code">text</code></mark>` 正确渲染

## [x] Task 3: Link / Comment 即时渲染

- **Priority**: medium
- **Depends On**: Task 2
- **Description**:
  - Link：选中后 prompt('Enter URL:')，若用户取消则保留占位 `url`；否则用 `<a href="...">text</a>` 包裹；class `inline-link`，color:var(--accent) text-underline hover:opacity-80 cursor-pointer；href 如果是 `url` 占位则加 `data-placeholder="true"` + 点击 preventDefault
  - Comment：选中文本后在末尾追加 `<span class="comment-marker" title="comment">[✎]</span>`，class 样式用淡色小标；同时保留原 MD 语义 `^[comment]` 用于 sourceLines 写回
  - 两个操作同样 dispatch input 事件走持久化链，且 pushUndo
- **Acceptance Criteria Addressed**: AC-4, AC-5, AC-6, AC-7
- **Test Requirements**:
  - `human-judgement` TR-3.1: Link 插入后 hover 手型，颜色为 accent；点击占位 Link 不跳转
  - `human-judgement` TR-3.2: Comment 文本右侧可见小图标，切 Source Mode 可见 `^[comment]`

## [x] Task 4: buildSourceLinesFromContent 兼容 inline HTML — DOM→MD 反转

- **Priority**: high
- **Depends On**: Task 2, Task 3
- **Description**:
  - 当前 `buildSourceLinesFromContent` 只提取纯文本，导致 `<strong>/<em>/<u>/<mark>/<code>/<a>/<span.comment-marker>` 被吞掉，切 Source 会丢失格式。
  - 重写 helper：遍历 Block 的 DOM 子节点（Text + Element 混合），根据 tagName 输出对应 MD 语法：
    - `<strong>/<b>` → `**%s**`
    - `<em>/<i>` → `*%s*`
    - `<u>` → `<u>%s</u>`
    - `<mark>` → `==%s==`
    - `<code.inline-code>` → `` `%s` ``
    - `<a>` → `[%s](href)`
    - `.comment-marker` → ` ^[comment]`（如果存在 title 则填内容）
    - 嵌套时正确递归，保持栈结构
  - 切换 Source Mode 验证源码完整保留格式化
- **Acceptance Criteria Addressed**: AC-2, AC-3, AC-4, AC-6
- **Test Requirements**:
  - `human-judgement` TR-4.1: B+I+U 叠加后切 Source Code Mode，源码包含三者语法；切回 Normal Mode 视觉仍一致
  - `programmatic` TR-4.2: Vitest 新增单测 `describe('buildSourceLinesFromContent inline formatting')` 覆盖 B/I/U/mark/code/a 及其组合

## [x] Task 5: 补全 Vitest 单测 + 全局沙箱验证

- **Priority**: high
- **Depends On**: Task 1-4
- **Description**:
  - 新增或补全测试：
    - `handleBlockTypeChange` 的 12 种转换：`it('converts paragraph to heading-1', ...)` 等
    - `buildSourceLinesFromContent` 对 HTML→MD 转换的覆盖
    - 撤销栈 `pushUndo` 在每次操作前后 stackLength 正确递增
  - 执行 `npm run test`, `npm run typecheck`, `npm run lint`，必须 100% 通过
- **Acceptance Criteria Addressed**: AC-7, AC-6
- **Test Requirements**:
  - `programmatic` TR-5.1: 三项命令全部 exit 0
  - `programmatic` TR-5.2: 新增测试覆盖率不回退（总 coverage 阈值与当前一致即可）

# Task Dependencies

- Task 2 depends on Task 1（弱依赖，代码上无直接依赖但建议顺序执行）
- Task 3 depends on Task 2
- Task 4 depends on Task 2, Task 3
- Task 5 depends on Task 1-4 all complete
