# Implementation Plan: 编辑主区 + 浮动工具栏代码重构（refactor-editor-main-ft）

## Overview

依据 requirements.md（grilling 共识 Q1–Q8）对编辑主区 v2 渲染层与 7 个交互控制器做**纯结构重构**：消除重复代码（零宽剥离 ×3、clamp ×2、父链容器解析 ×4、空段落后置 ×4、行内标记表 ×2、工具栏按钮 JSX ×3、rAF 节流 ×2）、拆分过长函数（`formatRange`/`exitListItem`/`handleEnter`/`handleKeyDown`/`onConvertBlock`/`handleInput`）、拆分上帝组件（EditorV2 → 4 hooks、FloatingToolbar 纯函数下沉）、修正命名。**外部行为严格不变**，以现有测试为基线（Vitest ≈493 例），每原子单元测试全绿后单独提交，不新增测试、不修复范围外 bug。

## Requirements（引自 requirements.md §1–§5）

- 重构目标 5 项：①重复代码 ②过长/过度嵌套函数 ③命名不清 ④上帝组件/上帝文件 ⑤可提取公共逻辑。
- 优先级顺序：**重复代码/公共逻辑抽取 → 过长函数拆分 → 上帝组件拆分 → 命名修正**。
- 范围内：`v2/` 7 个文件 + `v2/blocks/` 5 个文件 + `controllers/` 7 个文件（`index.ts` **不在清单内，视为范围外，不得修改**）。
- 受限：`kernel/syntaxType.ts`（仅新增导出 `sameSyntaxType`）、`kernel/selection.ts`（仅导出已有 `stripZeroWidth`）；不改任何 kernel 既有函数体。
- 范围外：kernel 其余文件、`editorInstance.ts`、认证/设置/导航/数据层/其余组件。
- 行为保持：渲染输出、编辑器交互（输入/回车/退格/格式化/转换/拖选/光标恢复）、工具栏显示逻辑严格不变；`getContentArea` 命名疑义列入遗留清单。
- 成功标准：基线 `npm test` 全绿 → 每原子单元全绿 → 最终 `npm test` + `npm run typecheck` 0 error + `npm run lint` 无 error。
- 提交粒度：每原子单元（测试全绿）创建本地提交，不推送远程。
- 文档同步：仅当接口/文件路径变更影响 `docs/modules/04-编辑主区-Editor.md` 时同步。

## Scope Boundary（范围边界）

| 类别 | 内容 |
|---|---|
| ✅ 可修改 | `v2/`：EditorV2.tsx、FloatingToolbar.tsx、BlockRenderer.tsx、EditorScrollContainer.tsx、useCrossBlockDragSelection.ts、useOutlineNavigation.ts、types.ts；`v2/blocks/`：ContentBlock/LeafBlock/CodeBlock/ListItemBlock/BlockquoteBlock；`controllers/`：formatCtrl/convertCtrl/enterCtrl/inputCtrl/backspaceCtrl/listCtrl/clickCtrl |
| 🔶 受限（仅新增导出/移动已有函数） | `kernel/syntaxType.ts`（导出 `sameSyntaxType`）、`kernel/selection.ts`（导出 `stripZeroWidth`） |
| 🆕 新增文件（目录在范围内，允许新增） | `controllers/shared.ts`（clamp + 父链上下文）、`v2/rafThrottle.ts`（rAF 节流工厂） |
| ⛔ 范围外 | `controllers/index.ts`、kernel 其余文件、editorInstance、其余组件/数据层；**若需跨模块新增导出，一律直连文件 import，不经过 index.ts** |

**kernel 新增导出无需改 `kernel/index.ts`**：`export * from './syntaxType'` 与 `export * from './selection'` 已存在，自动透传。

---

## Phase 1：公共逻辑抽取与去重（U1–U10）

### U1 — 零宽剥离统一（3 处 → kernel 单点）
- **文件**：`src/render/editor/kernel/selection.ts`、`src/render/editor/controllers/inputCtrl.ts`、`src/render/components/Editor/v2/blocks/LeafBlock.tsx`
- **改动**：`selection.ts` L39 `stripZeroWidth` 仅加 `export` 关键字（函数体不动）；`inputCtrl.ts` L52 `domText.replace(/\u200B/g, '')` → `stripZeroWidth(domText)`；`LeafBlock.tsx` L42 `(span.textContent ?? '').replace(/\u200B/g, '').length` → `stripZeroWidth(span.textContent ?? '').length`。
- **等价性论证**：纯字符串替换语义完全一致（`/\u200B/g` 与 `stripZeroWidth` 实现逐字符相同），无调用时序变化。
- **测试命令**：`npx vitest run tests/editor/kernel/selection.test.ts tests/editor/controllers.test.ts tests/components/editorV2Input.test.tsx` → `npm test`
- **提交建议**：`refactor(editor): unify zero-width strip via exported kernel stripZeroWidth`
- **风险**：L3（kernel 新增导出，需求文档 §2 已授权范围；执行前简报确认）

### U2 — sameSyntaxType 下沉 kernel 并删除 FloatingToolbar 本地副本
- **文件**：`src/render/editor/kernel/syntaxType.ts`、`src/render/components/Editor/v2/FloatingToolbar.tsx`
- **改动**：`syntaxType.ts` L33 `sameSyntaxType` 加 `export`；`FloatingToolbar.tsx` L133–137 删除本地 `sameSyntaxType`，改为从 kernel 导入。
- **等价性论证**：两份实现逐字符相同（已验证 L133-137 与 L33-37），删除副本仅去重。
- **测试命令**：`npx vitest run tests/editor/kernel/syntaxType.test.ts tests/components/floatingToolbarV2.test.tsx` → `npm test`
- **提交建议**：`refactor(editor): reuse kernel sameSyntaxType in FloatingToolbar`
- **风险**：L3（kernel 新增导出，已授权）

### U3 — selectionSyntaxTypesConsistent 简化（依赖 kernel 一致性保证）
- **文件**：`src/render/components/Editor/v2/FloatingToolbar.tsx`
- **改动**：L164–176 中 `const first = types[0]; return types.every((t) => sameSyntaxType(t, first));` 简化为 `return types !== null && types.length > 0`。**保留函数签名与 export 位置**（`tests/editor/kernel/syntaxType.test.ts` L26 直接 import 此函数，测试边界渗透列入遗留，故导出路径不能变）。
- **等价性论证**：`resolveSyntaxTypesInRange` 在遍历中一旦出现与首类型不同即返回 `null`（syntaxType.ts L108），因此非 null 数组必然全同类型；`.every` 恒 true，删除后返回值不变。`types.length === 0` 在实际可达路径不存在（startId===endId 返回单元素），保留长度守卫仅为类型安全。
- **测试命令**：同上（U2 之后执行，依赖 U2 的导出）
- **提交建议**：`refactor(editor): simplify selectionSyntaxTypesConsistent via kernel guarantee`
- **风险**：L2（纯函数简化，G1 测试矩阵 11 例覆盖）

### U4 — clamp 去重（新建 controllers/shared.ts）
- **文件**：新增 `src/render/editor/controllers/shared.ts`；`formatCtrl.ts`、`FloatingToolbar.tsx`
- **改动**：`shared.ts` 导出 `clamp`（复制 L104-106 / L122-124 实现，行为相同）；`formatCtrl.ts` 删除本地 `clamp` 改 import；`FloatingToolbar.tsx` 删除本地 `clamp` 改从 `'../../../editor/controllers/shared'` import。
- **等价性论证**：实现相同；import 路径为文件直连，不经过 `controllers/index.ts`（范围外）。
- **测试命令**：`npx vitest run tests/editor/controllers/formatCtrl.test.ts tests/editor/kernel/formatCtrl.test.ts tests/components/floatingToolbarV2.test.tsx` → `npm test`
- **提交建议**：`refactor(editor): extract shared clamp into controllers/shared`
- **风险**：L2（新增共享模块 + 纯函数替换，测试覆盖）

### U5 — 父链容器解析统一（getListContext / getQuoteContext）
- **文件**：`controllers/shared.ts`、`listCtrl.ts`、`convertCtrl.ts`、`enterCtrl.ts`
- **改动**：`shared.ts` 新增 `getListContext(tree, blockId): { item: BlockNodeV2; list: BlockNodeV2 } | null`（守卫语义取四者并集：`block 存在 && block.text !== null && item 存在 && list 存在`）与 `getQuoteContext(tree, blockId): BlockNodeV2 | null`。替换：
  - `listCtrl.ts` L12–23 `resolveListContext` 内部实现（保持私有壳，或直接内联调用共享函数后删除）；
  - `convertCtrl.ts` `exitListItem` L245–248 的 leaf→listItem→list 解析；
  - `convertCtrl.ts` `exitBlockquote` L315 的 leaf→quote 解析；
  - `enterCtrl.ts` `enterInListItem` L120–123 的 content→item→list 解析。
- **等价性论证**：四个调用点当前守卫分别为「block 存在+text 非 null+item 存在+item.type==='list-item'+list 存在」「item 存在+list 存在」「listItem 存在+list 存在」「content 存在+item 存在+list 存在」。由于调用链上游已保证 `text !== null`（`handleEnter`/`convertBlockToParagraph` 前置守卫），且模型中叶子内容块的父级必为 list-item/blockquote，统一守卫不改变任何可达路径的返回值。**执行时需逐调用点对拍守卫**（此单元为 Phase 1 最高风险去重）。
- **测试命令**：`npx vitest run tests/editor/controllers.test.ts tests/editor/kernel/blockTree.test.ts` → `npm test`
- **提交建议**：`refactor(editor): extract getListContext/getQuoteContext from 4 call sites`
- **风险**：L3（controllers 核心逻辑去重，需人工确认）

### U6 — 行内标记表统一（MARKERS → CHAR_BUTTONS）
- **文件**：`formatCtrl.ts`、`FloatingToolbar.tsx`
- **改动**：`formatCtrl.ts` L36 `MARKERS` 加 `export`；`FloatingToolbar.tsx` L66–113 `CHAR_BUTTONS` 的 6 个 `activeTest` 改为 `(t) => isBoundedWrap(t, ...(MARKERS[style] as [string, string]))`（bold/italic/underline/strike/code/highlight 六项与 MARKERS 键值逐一对应，已验证）。
- **等价性论证**：`MARKERS` 值与 CHAR_BUTTONS 中硬编码成对标记完全一致（`**`/`*`/`<u>`/`~~`/`` ` ``/`==`）；link/image 属 OBJECT_BUTTONS 无 activeTest，不受影响。
- **测试命令**：`npx vitest run tests/components/floatingToolbarV2.test.tsx tests/components/editorV2StickyFormat.test.tsx` → `npm test`
- **提交建议**：`refactor(editor): derive toolbar activeTest from formatCtrl MARKERS`
- **风险**：L3（controllers 新增导出 + 跨模块依赖，行为不变）

### U7 — ToolbarButton 子组件抽取（3 处按钮 JSX 统一）
- **文件**：`FloatingToolbar.tsx`（模块内私有组件，不新建文件）
- **改动**：提取 `ToolbarButton({ title, label, className?, active?, onClick })`，三处 JSX（CHAR L495–525、OBJECT L529–551、橡皮擦 L556–575）替换为 `<ToolbarButton … />`。统一规则：`className = 'ft-btn ' + (className ?? '')`；`color = active ? 'var(--accent)' : 'var(--text-sub)'`；`backgroundColor = active ? 'var(--bg-tertiary)' : 'transparent'`；`onMouseEnter → bg-tertiary`；`onMouseLeave → active ? bg-tertiary : transparent`；`onMouseDown preventDefault`；`onClick preventDefault + stopPropagation + 回调`。
- **等价性论证**：CHAR 按钮 active 分支与原样式逐项一致；OBJECT/橡皮擦 active=false 时颜色、hover 行为与现实现完全一致（现实现 hover 进 bg-tertiary、出 transparent）。渲染 DOM 结构与 class/属性不变。
- **测试命令**：`npx vitest run tests/components/floatingToolbarV2.test.tsx tests/components/editorV2StickyFormat.test.tsx` → `npm test`
- **提交建议**：`refactor(editor): extract ToolbarButton for duplicated button JSX`
- **风险**：L2（渲染结构提取，DOM 输出不变；TB1/TB5/TB6 断言覆盖）

### U8 — rAF 节流统一（createRafThrottle 工厂）
- **文件**：新增 `src/render/components/Editor/v2/rafThrottle.ts`；`FloatingToolbar.tsx`、`useCrossBlockDragSelection.ts`
- **改动**：`rafThrottle.ts` 导出 `createRafThrottle(flush: () => void): { schedule(): void; flushNow(): void; cancel(): void }`（内部持有 `rafIdRef`，`schedule` 为「已调度则复用」语义，`flushNow` 同步执行并清 id，`cancel` 取消防抖）。FloatingToolbar L316–323 `handleSelectionChange`/`flushSelection` 与 L332–335 cleanup、useCrossBlockDragSelection `scheduleFrame`（L172–176）/mouseup（L208–213）/cleanup（L261–268）改用工厂实例。
- **设计决策说明**：requirements 建议 `useRafThrottle hook`，但两处调用点的 flush 回调（`flushSelection`/`processPending`）都定义在 `useEffect` 内部，hooks 不能在此调用；工厂函数可在 effect 内实例化，改动面最小、时序语义与现状逐行一致。若坚持 hook 版需将两个 flush 提升为顶层 `useCallback` 并重构 effect 结构，diff 更大——**本计划采用工厂版**。
- **等价性论证**：`schedule` 保持「事件只写 ref、每帧最多一次 flush、已有待处理帧则复用」；`flushNow` 对应 mouseup 的「cancel 后手动补一帧」；`cancel` 对应 cleanup。调度顺序与边界（含 mouseup 前取消末帧、rAF 回调内置空 id）逐一保留。
- **测试命令**：`npx vitest run tests/components/floatingToolbarV2.test.tsx tests/components/useCrossBlockDragSelection.test.ts` → `npm test`
- **提交建议**：`refactor(editor): extract shared rAF throttle factory`
- **风险**：L3（事件时序敏感，需人工确认）

### U9 — EditorV2 变更管线统一（commitTree）
- **文件**：`EditorV2.tsx`
- **改动**：提取 `commitTree(instance)` = `{ setTree(instance.tree); syncContent(); }`，`applyAction`（L118–119 尾部）与 `applyMetaUpdate`（L244–245 尾部）共用；`applyAction` 的 focus/selection 分支保持在 commit 之前，顺序不变。
- **等价性论证**：两处尾部本就是完全相同的两行序列；提取后执行顺序（先 setTree 后 syncContent）与调用时机不变。
- **测试命令**：`npx vitest run tests/components/editorV2.test.tsx tests/components/editorV2Input.test.tsx tests/components/editorV2Convert.test.tsx tests/components/editorV2Format.test.tsx` → `npm test`
- **提交建议**：`refactor(editor): unify editor commit pipeline (setTree + syncContent)`
- **风险**：L3（编辑器核心提交路径，所有编辑动作都经过）

### U10 — convertCtrl 空段落后置统一
- **文件**：`convertCtrl.ts`
- **改动**：L49–57 `createEmptyParagraphAfter` 与 L259–261 内联「`makeParagraph('') + appendChild(root)`」合并为带参 helper `appendEmptyParagraph(tree, refId?)`（refId 有值 → `insertBlockAfter`；无值 → append 到 root），`exitEmptyListItem`/`ensureTrailingParagraph`/`exitBlockquote`/`exitListItem` 空项分支统一调用。
- **等价性论证**：两处现实现分别对应两种放置语义，参数化后按 refId 有无分派，各调用点路径与返回值不变（含 `renderBlock` 调用）。
- **测试命令**：`npx vitest run tests/editor/controllers.test.ts tests/editor/kernel/codeBlockTrailingParagraph.test.ts` → `npm test`
- **提交建议**：`refactor(editor): unify empty-paragraph placement in convertCtrl`
- **风险**：L2（单文件内部去重，退出规则测试矩阵覆盖）

---

## Phase 2：过长/嵌套函数拆分（U11–U16）

### U11 — formatRange 拆分（113 行 → 分发器 + 子函数）
- **文件**：`formatCtrl.ts`
- **改动**：拆出 `applyLinkOrImage(instance, block, style, s, e, selected, before, after, options)`（L136–146）、`stripOverlappingTokens(text, style, s, e)`（L153–186 Step 0 归一化）、`applyMarkStyleToggle(...)`（L188–210 Step 1/2）；`formatRange` 收敛为「clamp → slice → 按 style 分派 → setBlockText/render → 组装 result」。
- **等价性论证**：纯逻辑搬移，分支顺序（link/image → Step0 strip → Step1 → Step2）、`cursorOffset`/`selection` 计算式逐行保留。
- **测试命令**：`npx vitest run tests/editor/controllers/formatCtrl.test.ts tests/editor/kernel/formatCtrl.test.ts` → `npm test`
- **提交建议**：`refactor(editor): split formatRange into dispatcher + subfunctions`
- **风险**：L3

### U12 — exitListItem / exitBlockquote 分支拆分
- **文件**：`convertCtrl.ts`
- **改动**：`exitListItem`（L243–305）四分支拆为 `exitUniqueItem`（唯一项）、`exitFirstItem`（首项）、`exitMergeIntoPrevItem`（并入前项；含 allEmpty→`exitEmptyListItem` 路径），主函数收敛为守卫 + 分派；`exitBlockquote`（L313–348）三分支拆为 `exitBlockquoteUnique`/`exitBlockquoteLastEmpty`/`exitBlockquoteMoveOut`。
- **等价性论证**：`exitEmptyListItem` 已独立，其余三分支各自「返回值 + `instance.tree` 写入」完整保留，分支判定条件（children 长度、prevId、allEmpty）不变量不变。
- **测试命令**：`npx vitest run tests/editor/controllers.test.ts` → `npm test`
- **提交建议**：`refactor(editor): split exitListItem/exitBlockquote branches`
- **风险**：L3

### U13 — handleEnter 分支拆分（63 行 → 分发器）
- **文件**：`enterCtrl.ts`
- **改动**：拆出 `handleEnterInCodeBlock(instance, block, offset)`（L37–47）、`handleEnterAtFenceLine(instance, blockId, block)`（L50–63）；`handleEnter` 保留 list-item/heading/blockquote/通用拆分分支（各自已 ≤5 行，`splitAndFocusNewLeaf` 已存在）。
- **等价性论证**：分支判定顺序与 early-return 顺序逐一保留。
- **测试命令**：`npx vitest run tests/editor/controllers.test.ts` → `npm test`
- **提交建议**：`refactor(editor): split handleEnter branch handlers`
- **风险**：L3

### U14 — handleInput 拆分（58 行 → 管线）
- **文件**：`inputCtrl.ts`
- **改动**：拆出 `applyAutoPair(text, cursorOffset)` → `{ text, cursorOffset, applied }`（L58–69）、`tryConvertParagraph(instance, blockId, text)` → `InputResult | null`（L79–92）；`handleInput` 收敛为「strip → 相等短路 → autoPair → setBlockTextAndRender → code-block 早退 → paragraph 转换 → needRender 计算」。
- **等价性论证**：管线顺序、`finalOffset` 传递、`needRender` 判定式（autoPairApplied || hasFormatSyntax）不变。
- **测试命令**：`npx vitest run tests/editor/controllers.test.ts` → `npm test`
- **提交建议**：`refactor(editor): split handleInput into pipeline steps`
- **风险**：L3

### U15 — onConvertBlock 三分支拆分
- **文件**：`EditorV2.tsx`
- **改动**：拆出 `convertToParagraph(instance, blockId, block)`、`convertToHeading(instance, blockId, block, level, isRootBlock)`、`convertToStructure(instance, blockId, target, isRootBlock)`；`onConvertBlock` 保留矩阵前置校验（`canConvertBlock`）+ 分派。
- **等价性论证**：`canConvertBlock` 双保险校验、`isRootBlock`/`resolveSyntaxType` 计算、三分支判定条件与 `applyAction`/`applyMetaUpdate` 调用逐一保留。
- **测试命令**：`npx vitest run tests/components/editorV2Convert.test.tsx tests/components/editorV2.test.tsx` → `npm test`
- **提交建议**：`refactor(editor): split onConvertBlock dispatch branches`
- **风险**：L3

### U16 — ContentBlock.handleKeyDown 拆分（59 行 → 组合）
- **文件**：`blocks/ContentBlock.tsx`
- **改动**：拆出 `handleDeleteKey(e)`（跨块删除 L219–225 + 单块标记吸附删除 L228–242）与 `handleArrowKeySnap(e)`（方向键吸附 L246–267）；`handleKeyDown` 收敛为「delete 分支 → arrow 分支 → enter/backspace/tab/format 组合调用」，组合顺序不变。
- **等价性论证**：`handleDeleteKey`/`handleArrowKeySnap` 内部 guard（`!raw`、`composingRef`、修饰键组合）与 `lastDomTextRef`/`pendingOffsetRef` 写入逐一保留。
- **测试命令**：`npx vitest run tests/components/contentBlockRestore.test.tsx tests/components/editorV2Format.test.tsx tests/components/editorV2Input.test.tsx` → `npm test`
- **提交建议**：`refactor(editor): split ContentBlock handleKeyDown`
- **风险**：L3（编辑器核心交互）

---

## Phase 3：上帝组件拆分（U17–U20，串行）

> 顺序依赖：U17（DOM 注册表）→ U18（内容同步）→ U19（焦点恢复）→ U20（动作集）。每步完成后 EditorV2 保持编译通过且全量测试绿。新增 hook 文件与现有 `useCrossBlockDragSelection` 平级放 `v2/` 目录。

### U17 — useDomRegistry
- **文件**：新增 `v2/useDomRegistry.ts`；`EditorV2.tsx`
- **改动**：迁入 `domRegistryRef`、`registerDom`、`unregisterDom`，并把 `onDeleteRange` L176–184 的手写 DOM 强制同步提取为 hook 内 `forceSyncBlockDom(instance, blockId)`（`innerHTML` 比对+写入逻辑逐行保留）。hook 返回 `{ registerDom, unregisterDom, forceSyncBlockDom }`。
- **等价性论证**：ref 单例语义、注册表生命周期、比对写入条件（`el && block && block.text !== null`）不变。
- **测试命令**：`npx vitest run tests/components/editorV2.test.tsx tests/components/editorV2Input.test.tsx` → `npm test`
- **提交建议**：`refactor(editor): extract useDomRegistry hook from EditorV2`
- **风险**：L3

### U18 — useContentSync
- **文件**：新增 `v2/useContentSync.ts`；`EditorV2.tsx`
- **改动**：迁入 `lastSyncedContentRef`、外部内容同步 `useEffect`（L64–69）、`syncContent`（L86–90）。hook 签名 `useContentSync({ content, onContentChange, instanceRef, setTree })`，返回 `{ syncContent }`。
- **等价性论证**：effect 依赖 `[content]`、`lastSyncedContentRef` 先比较后写、`setTree(instanceRef.current!.tree)` 顺序不变。
- **测试命令**：同上 + `tests/components/editorV2Format.test.tsx` → `npm test`
- **提交建议**：`refactor(editor): extract useContentSync hook from EditorV2`
- **风险**：L3

### U19 — useFocusRestore
- **文件**：新增 `v2/useFocusRestore.ts`；`EditorV2.tsx`
- **改动**：迁入 `pendingFocusRef`、`pendingRangeRef`、`useLayoutEffect`（L72–81，**必须在 U17/U18 之后迁移以保证与父组件渲染时序一致**）、`getPendingRange`（L230–235）。返回 `{ getPendingRange, setPendingFocus(focus), setPendingRange(range) }`。
- **等价性论证**：`useLayoutEffect` 的 `[tree]` 依赖、`pendingRangeRef.current` 优先短路、`pendingFocusRef` 消费即清空语义不变；`applyAction`/`onInput` 中的写入点改为调用 setter，写入内容一致。
- **测试命令**：`npx vitest run tests/components/contentBlockRestore.test.tsx tests/components/editorV2Input.test.tsx tests/components/editorV2Convert.test.tsx` → `npm test`
- **提交建议**：`refactor(editor): extract useFocusRestore hook from EditorV2`
- **风险**：L3（focus 时序敏感）

### U20 — useEditorActions
- **文件**：新增 `v2/useEditorActions.ts`；`EditorV2.tsx`
- **改动**：迁入 `applyAction`（复用 U9 的 commitTree）、`applyMetaUpdate`、`onInput`/`onEnter`/`onBackspaceAtStart`/`onDeleteRange`（改用 `forceSyncBlockDom`）/`onTab`/`onShiftTab`/`onToggleTask`/`onFormat`/`onClearFormat`/`onUndo`/`onRedo`/`onFenceLanguageChange`，以及 U15 拆分后的 `onConvertBlock` 分派器。hook 消费 U17–U19 的返回，输出 `handlers`（保持与现 `BlockHandlers` 一致的 `useMemo` 结构与依赖数组）。EditorV2 主体收敛为：tree 状态 + outline + `useOutlineNavigation` + `handleContainerClick` + JSX（约 120 行）。
- **等价性论证**：所有 `useCallback` 依赖数组逐项对应；`onDeleteRange` 中「applyAction + 强制同步循环」的先后顺序保留；`handlers` 引用稳定性（memo 语义）不变。
- **测试命令**：`npx vitest run tests/components/editorV2*.test.tsx tests/components/contentBlockRestore.test.tsx tests/components/editorV2StickyFormat.test.tsx` → `npm test`
- **提交建议**：`refactor(editor): extract useEditorActions hook from EditorV2`
- **风险**：L3（本阶段最大单元，需人工确认）

---

## Phase 4：命名修正（U21–U23）

### U21 — kind:'fade' → kind:'delay-hide'
- **文件**：`FloatingToolbar.tsx`
- **改动**：`ToolbarState` 联合类型（L179–182）与 `computeToolbarState` 返回值、`flushSelection` 分支（L306–309）中的 `'fade'` 统一改名为 `'delay-hide'`（语义为「折叠选区/零尺寸选区 → 延迟隐藏」）。
- **等价性论证**：模块内私有类型与字面量，无外部引用；仅标识符改名。
- **测试命令**：`npm test`
- **提交建议**：`refactor(editor): rename kind 'fade' to 'delay-hide' in FloatingToolbar`
- **风险**：L2

### U22 — applyAction → applyBlockAction
- **文件**：`EditorV2.tsx`（若在 U20 后执行，则改 `useEditorActions.ts`）
- **改动**：私有 `useCallback` 重命名为表意名称（统一块操作入口）。
- **等价性论证**：仅私有标识符改名。
- **测试命令**：`npm test`
- **提交建议**：`refactor(editor): rename applyAction to applyBlockAction`
- **风险**：L2

### U23 — processInput → syncDomToModel
- **文件**：`blocks/ContentBlock.tsx`
- **改动**：L95 私有 `processInput` 重命名为 `syncDomToModel`（输入处理实际是「DOM 文本 → 模型」单向同步）。
- **等价性论证**：仅私有标识符改名。
- **测试命令**：`npm test`
- **提交建议**：`refactor(editor): rename processInput to syncDomToModel in ContentBlock`
- **风险**：L2

---

## 阶段间依赖关系

```
Phase 1（可并行/按序，冲突最小）
  U1 ◄── 独立
  U2 ──► U3（U3 简化依赖 U2 导出）
  U4 ──► U5（U5 复用 shared.ts 模块）
  U6/U7/U8/U9/U10 ──► 独立，互不阻塞
        │
        ▼
Phase 2（各单元独立；依赖 Phase 1 的 shared/clamp/getListContext 就位）
  U11–U16 互不依赖；U15（onConvertBlock）是 U20 的前置拆分
        │
        ▼
Phase 3（串行，前序 hook 输出被后序消费）
  U17 ─► U18 ─► U19 ─► U20
  （U9 commitTree 与 U15 拆分是 U20 的前置输入，已在 Phase 1/2 完成）
        │
        ▼
Phase 4（独立，收尾）
  U21 / U22 / U23
```

- **硬性前置**：U3→U2；U5→U4；U20→{U9, U15, U17, U18, U19}。
- **阶段间**：Phase 2 全部完成后才进入 Phase 3（避免 controllers 与 EditorV2 同时变动时定位困难）；Phase 4 可在任意阶段后穿插，但建议最后统一执行。
- **建议执行顺序**：U1→U2→U3→U4→U5→U6→U7→U8→U9→U10 → U11→U12→U13→U14→U15→U16 → U17→U18→U19→U20 → U21→U22→U23。

---

## 风险清单与缓解

| # | 风险 | 影响单元 | 缓解 |
|---|---|---|---|
| R1 | **控制器行为漂移**（分支顺序/early-return 变更） | U5、U10–U14 | 逐单元「提取前记录绿基线 → 提取 → 全量回归」；拆分时保留判定顺序注释；`controllers.test.ts`（387 行，六条退出规则矩阵）为回归护栏 |
| R2 | **rAF/事件时序变化**（节流合并、mouseup 补帧） | U8、U17–U20 | 工厂保持「已调度复用」与「flushNow 前置 cancel」语义；`floatingToolbarV2` rAF 收集 stub 用例 + `useCrossBlockDragSelection` 端点检测 11 例覆盖；可选补跑 `npx playwright test e2e/cross-block-selection.spec.ts` |
| R3 | **焦点恢复/渲染时序**（hook 拆分后 useLayoutEffect 顺序） | U18–U20 | 严格保持「外部内容 effect → 焦点恢复 layout effect」在父组件的挂载顺序；依赖数组逐项复制；`contentBlockRestore`/`editorV2Input`/`editorV2StickyFormat` 覆盖 |
| R4 | **kernel 导出波及测试**（新增导出改变 barrel 面） | U1、U2 | 只加 `export` 关键字不改函数体；`kernel/index.ts` 已 `export *` 自动透传；`syntaxType.test.ts` 对 `FloatingToolbar` 的直接 import（L26）保持导出路径不变 |
| R5 | **循环依赖**（shared.ts 被 controllers 与 v2 共用） | U4、U5 | `shared.ts` 仅 import kernel 类型，不 import 控制器/组件 → 无环；提交前 `npm run typecheck` 验证 |
| R6 | **lint --fix 全仓格式化噪音**（`npm run lint` 带 `--fix`） | 全部 | 每单元提交前用 `npx eslint <变更文件>`（不带 --fix）校验；最终门禁再跑一次 `npm run lint` 接受其修复结果 |
| R7 | **DOM 强制同步逻辑搬移出错**（onDeleteRange innerHTML 比对） | U17 | `forceSyncBlockDom` 的守卫（`el && block && block.text !== null`）与「不等才写入」逐行保留；可选补跑 e2e 拖选删除用例 |
| R8 | **测试数量基线漂移** | 全部 | 开工前记录 `npm test` 基线数量（文档记 493 例 Vitest）；任何用例数变化视为违规，先回退定位 |
| R9 | **U5 守卫语义差异**（4 调用点守卫并集） | U5 | 执行时逐调用点对拍原守卫并记录等价性结论于提交说明；若发现不可等价的情况，降级为仅共享「list-item→list」两步解析 |
| R10 | **Phase 3 大 diff** | U17–U20 | 每个 hook 独立提交、独立全绿；每个 hook 提取后立即 diff review 确认无多余改动 |

---

## 测试策略

### 基线（开工前）
```bash
npm test          # 记录 Vitest 用例数（预期 ≈493，见 docs/modules/04 §9）
npm run typecheck # 0 error
```

### 每原子单元回归（固定流程）
1. 定向快跑（见下表）→ 2. 全量 `npm test` → 3. `npm run typecheck` → 4. 变更文件 `npx eslint <files>`（无 --fix）→ 5. 通过后创建本地提交（不推送）。

| 单元 | 定向测试 |
|---|---|
| U1 | `npx vitest run tests/editor/kernel/selection.test.ts tests/editor/controllers.test.ts tests/components/editorV2Input.test.tsx` |
| U2/U3 | `npx vitest run tests/editor/kernel/syntaxType.test.ts tests/components/floatingToolbarV2.test.tsx` |
| U4 | `npx vitest run tests/editor/controllers/formatCtrl.test.ts tests/editor/kernel/formatCtrl.test.ts tests/components/floatingToolbarV2.test.tsx` |
| U5 | `npx vitest run tests/editor/controllers.test.ts tests/editor/kernel/blockTree.test.ts` |
| U6/U7 | `npx vitest run tests/components/floatingToolbarV2.test.tsx tests/components/editorV2StickyFormat.test.tsx` |
| U8 | `npx vitest run tests/components/floatingToolbarV2.test.tsx tests/components/useCrossBlockDragSelection.test.ts` |
| U9 | `npx vitest run tests/components/editorV2*.test.tsx tests/editor/controllers.test.ts` |
| U10 | `npx vitest run tests/editor/controllers.test.ts tests/editor/kernel/codeBlockTrailingParagraph.test.ts` |
| U11 | `npx vitest run tests/editor/controllers/formatCtrl.test.ts tests/editor/kernel/formatCtrl.test.ts` |
| U12/U13/U14 | `npx vitest run tests/editor/controllers.test.ts` |
| U15 | `npx vitest run tests/components/editorV2Convert.test.tsx tests/components/editorV2.test.tsx` |
| U16 | `npx vitest run tests/components/contentBlockRestore.test.tsx tests/components/editorV2Format.test.tsx tests/components/editorV2Input.test.tsx` |
| U17–U20 | `npx vitest run tests/components/editorV2*.test.tsx tests/components/contentBlockRestore.test.tsx tests/components/editorV2StickyFormat.test.tsx` |
| U21–U23 | `npm test` |

### 最终门禁
```bash
npm test
npm run typecheck
npm run lint
```
可选（交互密集单元 U7/U8/U13/U16/U17–U20）：`npx playwright test e2e/floating-toolbar.spec.ts e2e/cross-block-selection.spec.ts e2e/drag-selection-markers.spec.ts`（不作为成功标准，作为额外信心项）。

---

## 成功标准与验收清单

- [x] 开工前 `npm test` 全绿并记录基线（493 例）
- [x] 每个原子单元（U1–U23）完成后 `npm test` 全绿 + `npm run typecheck` 0 error
- [x] 最终 `npm test` 全绿（493/493）、`npm run typecheck` 0 error、`npm run lint` 0 error（8 warning 既有模式，L2）
- [x] requirements §1 五项坏味道消除经代码审查确认（见 review-report.md §4 核验表，全部 ✅）
- [x] 每单元独立本地提交（27 提交，conventional style），未推送远程
- [x] 交付总结：改动文件清单、测试结果（基线 vs 终态用例数）、审查结论、剩余风险、遗留清单（见交付记录）
- [x] `docs/modules/04-编辑主区-Editor.md` 核对：8/10 引用项 OK；`toDisplayHtml` 为计划清单误记（文档与代码均无）、`kernel/selection.ts` 文档以 `selection.ts` 形式引用且 `stripZeroWidth` 导出未动 → **文档无需同步**

## 文档同步检查点

- 检查点 1：U20（Phase 3 完成）后核对 `docs/modules/04-编辑主区-Editor.md` 中引用的函数名与文件路径：`selectionSyntaxTypesConsistent`（L20）、`syntaxTypeToOption`（L21）、`canConvertBlock`（L23）、`resolveSyntaxType`（L23/L76）、`lastAppliedRangeRef`（L27）、`ensureTrailingParagraph`（L73）、`toDisplayHtml`（L86）、`foldCrossStyleMarkers`（L136）、`kernel/syntaxType.ts`、`kernel/selection.ts`。
- **预测结论**：本计划保留全部文档引用函数的导出位置与文件路径（`FloatingToolbar.tsx` 路径不变、`syntaxTypeToOption`/`selectionSyntaxTypesConsistent` 仍在 FloatingToolbar 导出），**预期无需改动文档**；若 U5/U20 导致某被引用函数迁移文件，则同步更新对应小节。
- 检查点 2：交付前核对一次，确认无遗漏。

---

## L3/L4 风险清单（需在简报中等待用户批准）

| 等级 | 单元 | 理由 |
|---|---|---|
| **L3** | U1、U2 | kernel 新增导出（新增 API 面；需求文档 §2 已授权范围，仍按 AGENTS.md 需确认后执行） |
| **L3** | U5 | controllers 父链解析核心逻辑去重（4 调用点守卫并集） |
| **L3** | U6 | controllers 新增导出 + 跨模块依赖变更 |
| **L3** | U8 | rAF 事件时序敏感（工具栏显隐 + 拖选） |
| **L3** | U9 | 编辑器核心提交管线（所有编辑动作必经路径） |
| **L3** | U11–U16 | controllers/ContentBlock 业务模块拆分（编辑器核心交互） |
| **L3** | U17–U20 | EditorV2 上帝组件拆 4 hooks（焦点/渲染时序） |
| **L4** | 无 | 本任务不涉及生产部署、密钥、数据迁移、计费、安全策略 |

> 按 AGENTS.md 风险分级，上述 L3 单元在**执行前须以简报形式等待用户确认**；L2 单元（U3、U4、U7、U10、U21、U22、U23）可在基线确认后直接执行。建议按「Phase 1 批次确认 → Phase 2 批次确认 → Phase 3 逐 hook 确认」分三批报批，减少打断。

## 遗留清单（本次明确不改）

- `EditorScrollContainer.getContentArea` 返回滚动容器却命名"内容区"——行为疑义，不改。
- `types.ts` `BlockHandlers` 16 回调统一注入——列入遗留，本次不动。
- `tests/editor/kernel/syntaxType.test.ts` 直接 import 组件层函数（测试边界渗透）——不改。
- `BlockRenderer`/`LeafBlock`/`CodeBlock`/`ListItemBlock`/`BlockquoteBlock`/`EditorScrollContainer`/`useOutlineNavigation` 无直接单测、`inputCtrl` 零宽剥离等覆盖空白——不新增测试。
- 范围外 bug（如 getNextLeaf 注释与行为不符等）——不修复。
- `controllers/index.ts` 不在范围内——不修改。

---

## 执行摘要（建议节奏）

1. **简报确认**：按 L3 清单分三批获得批准。
2. **基线**：记录 `npm test` 数量（对照 493）与 git status 干净。
3. **Phase 1（U1–U10）**：约 10 个提交，每个「定向测试 + 全量测试 + typecheck + 提交」。
4. **Phase 2（U11–U16）**：约 6 个提交，controllers + ContentBlock 拆分。
5. **Phase 3（U17–U20）**：4 个提交，串行提取 hook，每步全绿。
6. **Phase 4（U21–U23）**：3 个提交，命名收尾。
7. **终验 + 文档核对 + 交付总结**（改动文件、测试结果、审查结论、剩余风险、遗留清单）。
