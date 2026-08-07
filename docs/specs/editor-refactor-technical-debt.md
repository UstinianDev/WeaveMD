# SPEC-REFACTOR-EDITOR：编辑主区技术债清理规范

> 状态：待实施 | 版本：v1.0 | 日期：2026-08-07
> 范围：`src/render/editor/`（内核 + 控制器）、`src/render/components/Editor/`（v2 渲染层 + EditorView）
> 硬约束：**纯重构，零行为变更**。验收以既有测试全绿为准（vitest 238 / playwright 25 /
> tsc / ESLint 0 error / vite build），不新增功能、不改磁盘格式、不动往返不变量。

## 1. 背景与原则

编辑主区 v2 功能主线（六条退出规则、浮动工具栏、跨块拖选、SPEC-EDIT-CBTP）已交付，
进入质量维护期。本规范以「行为不变」为前提，按五个技术债维度登记发现项，
并给出分批实施计划。原则：

- 每项改动独立可回退；同一批次内的改动共享一次全量门禁。
- 死代码删除必须有「全仓零引用」证据；重复代码合并必须保留两侧既有测试语义。
- 不做架构级重写（块树不可变模型、控制器分发结构保持不变）。

## 2. 发现项清单

风险等级：A=纯机械/零风险，B=逻辑等价重组，C=涉及渲染/焦点时序需谨慎。

### 2.1 重复代码

| #   | 位置                                                            | 问题                                                                                     | 建议                                                                         | 等级 |
| --- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---- |
| D1  | `EditorView.tsx` L131-145                                       | `handleSourceContentChange` 与 `handleFindReplaceContentChange` 函数体完全相同           | 合并为 `handleExternalContentChange` 单回调                                  | A    |
| D2  | `EditorView.tsx` L54-120                                        | 两个 Monaco 主题 rules/colors 结构重复约 80 行                                           | 提取 `defineWeaveThemes(monaco)` 到 `utils/monacoSetup.ts`，主题以配置表表达 | B    |
| D3  | `ContentBlock.tsx` L244 与 `EditorV2.tsx` L249-253              | 空 html → `\u200B` 的展示规则两处硬编码                                                  | 内核导出 `toDisplayHtml(inlineHtml, text)` 单点收口                          | B    |
| D4  | `blockTree.ts` insertBlockAfter/Before、appendChild             | 「克隆树 → 确保节点存在 → detach → 设 parentId → link」样板重复 3 次                     | 提取私有 `placeNode(next, nodeId, node)`                                     | B    |
| D5  | `convertCtrl.buildList` L104-109 与 `listCtrl.handleTab` L32-37 | 列表元数据默认值 `{listMarker:'-',orderedStart:1,orderedDelimiter:'.',loose:false}` 重复 | 内核导出 `defaultListMeta()`                                                 | A    |
| D6  | `listCtrl.ts` handleTab/handleShiftTab L11-19、L50-60           | block→list-item→list（→外层）的父链查找前置重复                                          | 提取 `resolveListContext(tree, blockId)`                                     | B    |
| D7  | `inlineRenderer.ts` findMatchingBracket/findClosingParen        | 两个括号配对扫描函数结构相同（仅括号字符不同）                                           | 参数化合并为 `findMatching(text, openIndex, open, close)`                    | A    |
| D8  | `inlineRenderer.ts` tryDel/tryHighlight                         | 成对标记（`~~`/`==`）处理器结构相同                                                      | 合并为 `tryPairedMarker(text, i, marker, tag)`                               | B    |
| D9  | `inlineRenderer.ts` renderImageLink/tryAutoLink                 | `<a target="_blank" rel="noopener noreferrer">` 属性串重复                               | 提取 `renderLink(href, innerHtml, extra?)`                                   | A    |
| D10 | `enterCtrl.ts` L72-113                                          | heading/blockquote/通用拆分三处「splitLeaf → render → focus 新块 offset 0」近似序列      | 提取 `splitAndFocusNewLeaf(instance, blockId, offset)`                       | B    |

### 2.2 死代码与调试残留

| #   | 位置                                                            | 问题                                                                     | 建议                           | 等级 |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------ | ---- |
| X1  | `EditorV2.tsx` L90-91                                           | 残留 `console.log('[drag] effect')` 调试语句（带 eslint-disable）        | 删除                           | A    |
| X2  | `selection.ts` `getBlockIdFromSelection`                        | 全仓零调用，且 `void root` 未使用参数                                    | 删除                           | A    |
| X3  | `EditorView.tsx` `isUpdatingFromExternalRef`、`sourceEditorRef` | 只写不读的 ref（连带 `monaco-editor` 的 editor 类型导入）                | 删除                           | A    |
| X4  | `EditorView.tsx` L257-259                                       | 空 useEffect（仅注释）                                                   | 删除                           | A    |
| X5  | `backspaceCtrl.mergeParagraph` L77-82                           | 「无前兄弟」两分支均 return null，前一分支 `instance.tree = tree` 无变更 | 折叠为单 `return null`         | A    |
| X6  | `FloatingToolbar.tsx` currentType L212-213                      | `paragraph` 分支与默认分支返回同值，冗余                                 | 删除冗余分支                   | A    |
| X7  | `convertCtrl.renderFor`                                         | 仅是 `renderBlock(tree, block.id)` 的参数换位包装，调用处可读性差        | 内联删除，直接用 `renderBlock` | A    |

### 2.3 函数过长 / 过度嵌套

| #   | 位置                                                              | 问题                                                                | 建议                                                                                                                     | 等级 |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---- |
| L1  | `markdownToState.parseBlocks`（约 260 行单函数）                  | 围栏/表格/引用/列表/标题/分割线解析全在 while 循环内，缩进最深 5 层 | 按块类型拆 `parseFencedCode/parseTable/parseBlockquote/parseList` 子函数，主循环仅分派                                   | C    |
| L2  | `EditorV2.tsx`（436 行，14 个 ref）                               | 事件路由、跨块拖选、大纲导航、滚动高亮、链接打开、DOM 强制同步混杂  | 提取 `useCrossBlockDragSelection`、`useOutlineNavigation` 两个 hook；onDeleteRange 的 DOM 同步改走 D3 的 `toDisplayHtml` | B    |
| L3  | `FloatingToolbar.handleSelectionChange`（约 50 行，5 个提前退出） | 选区判定、偏移计算、位置计算混在一个事件回调                        | 拆 `computeToolbarState(sel, container)` 纯函数 + 事件装配                                                               | B    |
| L4  | `enterCtrl.handleEnter`（5 分支约 90 行）                         | 分支内细节外露                                                      | 配合 D10 抽取后各分支收敛到 5 行内                                                                                       | B    |
| L5  | `convertCtrl.exitListItem`（约 60 行，3 分支 + 焦点变量对）       | `focusBlockId/focusAtStart` 变量对驱动后置计算，理解成本高          | 三分支各自直接返回 `EditorActionResult`                                                                                  | B    |

### 2.4 命名清晰度

| #   | 位置                                                | 问题                                                    | 建议                                                         | 等级 |
| --- | --------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------ | ---- |
| N1  | `blockTree` 各操作局部变量 `next`                   | 与块字段 `nextId` 同域共存易混                          | 统一改名 `nextTree`                                          | A    |
| N2  | `getPrevLeaf` L251-256 注释                         | 「回退到父块本身」与 return null 行为不符               | 修正注释为「到根为止无 prev 兄弟则返回 null」                | A    |
| N3  | `enterCtrl` `beforeText === '' && afterText === ''` | 等价于 `text === ''`，表意绕                            | 改为 `(content.text ?? '') === ''`                           | A    |
| N4  | `inputCtrl` L71-74                                  | renderBlock 后手动拼 blocks 写 text，绕过了内核既有 API | 内核新增 `setBlockTextAndRender(tree, id, text)`，调用点替换 | B    |

### 2.5 公共逻辑与性能注记

| #   | 位置                                                                                                                     | 问题                                             | 建议                                                              | 等级 |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------- | ---- |
| P1  | `blockTree.cloneTree` 每次结构操作全树深克隆；`editorInstance.renderInlineAll` 逐块 setInlineHtml（每块一次克隆，O(n²)） | 大文档下加载/批量渲染开销随块数平方增长          | 本期仅注记 + benchmark；结构共享（path-copy）列为二期，需专项测试 | 二期 |
| P2  | `blockTree.generateBlockId` 与 `Builder.genId`                                                                           | 两套 id 生成实现并存                             | 统一到单一生成器（保持 id 格式兼容）                              | A    |
| P3  | `blockTree.detectBlockConversion`                                                                                        | 7 段串行 if-match，返回结构同型                  | 表驱动：`[{re, build}]` 数组循环                                  | B    |
| P4  | `getCrossBlockSelection`（ContentBlock.tsx 内）                                                                          | DOM 选区逻辑属内核职责，放组件文件不利复用与测试 | 迁移至 `kernel/selection.ts`                                      | A    |
| P5  | `CodeBlock.normalizeLanguage` if 链                                                                                      | 别名归一化可表驱动                               | `LANGUAGE_ALIASES: Record<string,string>` 查表                    | A    |

## 3. 实施批次

每批次独立通过全量门禁后方可进入下一批；批内遵循 TDD（先确认相关测试绿基线 →
重构 → 重跑同一测试目标确认无回归）。

1. **批次一（死代码 + 机械重命名，等级 A）**：X1-X7、N1-N3、D1、D5、D7、D9、P2、P4、P5。
2. **批次二（重复模式合并，等级 B）**：D2、D3、D4、D6、D8、D10、L2-L5、N4、P3。
3. **批次三（解析器拆分，等级 C）**：L1。该批必须以 `markdownRoundTrip` 往返属性
   测试 + SPEC-EDIT-CBTP 12 例补偿测试作为回归护栏，逐子函数提取。
4. **二期（另行立项）**：P1 结构共享性能优化。

## 4. 验收标准

- `npx vitest run` 238/238、`npx playwright test` 25/25、`tsc --noEmit`、
  ESLint 0 error、`vite build` 全绿（与重构前基线一致）。
- `git diff` 不含任何导出 API 签名变更（删除死代码除外）、无新增依赖。
- 往返不变量测试与 SPEC-EDIT-CBTP 测试无修改（断言口径不变）。

## 5. 风险与回退

- 最大风险点在 L1（解析器拆分）与 D3（展示 HTML 收口影响焦点恢复时序）；
  均要求批前记录绿基线、批后同目标复跑，任何断言变化视为违规并回退该批。
- 每批单独提交（需用户授权），可独立 revert。

## 6. 实现记录

三批次已全部实施完成，零行为变更，门禁与基线一致（vitest 238/238、playwright 25/25、
tsc 0、eslint 0、vite build 全绿；tests/ 与 e2e/ 零改动）。合规审计见
`docs/testing/spec-refactor-editor.comply.md`。

- 批次一（17 项）：X1-X7、N1-N3、D1、D5、D7、D9、P2、P4、P5 全部完成。
- 批次二（12 项）：D2-D4、D6、D8、D10、L2-L5、N4、P3 全部完成。
- 批次三（L1）：围栏/表格/引用/列表实施前已为子函数，补提取标题/分割线为
  parseAtxHeading/parseThematicBreak，主循环收敛为纯分派；护栏（往返属性测试 +
  CBTP 12 例，合 53 用例）逐批全绿。
- 偏差：D1 初版保留双回调，审计后修正为单回调 handleExternalContentChange；
  toDisplayHtml 在 onDeleteRange 统一了空内容回退口径（无实际行为差异）；
  kernel 因 export * 附带新增 newBlockId/defaultListMeta/setBlockTextAndRender/
  getCrossBlockSelection 导出（既有签名零改动）。P1 按本期约束仅注记。
- 流程：/Ultra Review 不存在，由内置 CodeReview 子智能体替代（无 Critical/Warning）。
