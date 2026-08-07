# SPEC-REFACTOR-EDITOR 合规审计报告

- 规则源：`docs/specs/editor-refactor-technical-debt.md`
- 审计方法（skill-comply 方法论）：规则提取（§2 发现项清单 31 项 + §3 批次纪律 + §4 验收标准）→ 逐项分类（已实施/偏差/二期）→ 证据核验（门禁输出、git diff、测试文件零改动）
- 审计日期：2026-02（批次三完成后事后审计）
- 总体遵循率：30/31 项实施完成（P1 按规范明示为二期注记，不计违规）；批次纪律与验收标准 100% 遵循

## 1. 发现项逐项核对

### 批次一（等级 A，17 项）— 全部完成

| #   | 落实证据                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | EditorV2 拖选 console.log 已删除                                                                                                          |
| X2  | selection.ts `getBlockIdFromSelection` 已删除（全库零引用核验）                                                                           |
| X3  | EditorView 只写 ref（isUpdatingFromExternalRef/sourceEditorRef）与 monaco editor 类型导入已删除；sourceEditorHandleRef 经读取方核验后保留 |
| X4  | EditorView 空 useEffect 已删除                                                                                                            |
| X5  | backspaceCtrl.mergeParagraph 折叠为单 `return null`（原 `instance.tree = tree` 为无变更赋值）                                             |
| X6  | FloatingToolbar currentType 冗余 paragraph 分支已删除                                                                                     |
| X7  | convertCtrl.renderFor 内联，6 处调用点直接 `renderBlock`                                                                                  |
| N1  | blockTree 结构操作局部变量统一 `nextTree`（getNextLeaf/adjacentLeafFocus 的块节点变量按语义保留 `next`）                                  |
| N2  | getPrevLeaf 注释修正为「到根为止无 prev 兄弟则返回 null」                                                                                 |
| N3  | enterCtrl 空文本判断改 `(text ?? '') === ''`（与 before===''&&after==='' 数学等价）                                                       |
| D1  | EditorView 合并为单回调 `handleExternalContentChange`（合规复查时发现初版保留双函数，已修正）                                             |
| D5  | kernel 导出 `defaultListMeta(source?)`，convertCtrl/listCtrl 共用；`??` 链保持 undefined 回退语义                                         |
| D7  | inlineRenderer 合并为 `findMatching(text, openIndex, open, close)`                                                                        |
| D9  | inlineRenderer 提取 `renderLink(href, innerHtml, titleAttr?)`，链接/自动链接共用                                                          |
| P2  | id 生成统一 `newBlockId(exists, prefix)`；Builder.genId 复用（'k' 前缀），格式兼容                                                        |
| P4  | `getCrossBlockSelection` 迁入 kernel/selection.ts，ContentBlock 改从 kernel 导入                                                          |
| P5  | CodeBlock `LANGUAGE_ALIASES` 查表替代 if 链                                                                                               |

### 批次二（等级 B，12 项）— 全部完成

| #   | 落实证据                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------ |
| D2  | monacoSetup 新增 `defineWeaveThemes(editor)`，双主题以 WEAVE_THEMES 配置表表达；EditorView 动态导入时序保留        |
| D3  | kernel 导出 `toDisplayHtml(inlineHtml, text)`；ContentBlock 与 EditorV2 onDeleteRange 共用（口径统一见 §3 偏差 2） |
| D4  | blockTree 提取私有 `placeNode(nextTree, node, parentId)`，insertBlockAfter/Before、appendChild 三处样板收口        |
| D6  | listCtrl 提取 `resolveListContext(tree, blockId)`，handleTab/handleShiftTab 共用                                   |
| D8  | inlineRenderer `tryPairedMarker(text, i, marker, tag)` 合并 ~~删除线~~/==高亮==                                    |
| D10 | enterCtrl 提取 `splitAndFocusNewLeaf`（可选 transform 参数覆盖 heading 转段落路径）                                |
| L2  | EditorV2 提取 `useCrossBlockDragSelection` / `useOutlineNavigation` 两个 hook（436 行 → 338 行）                   |
| L3  | FloatingToolbar 提取纯函数 `computeToolbarState`（返回 hide/fade/show 判别联合），事件回调仅装配                   |
| L4  | handleEnter 各分支收敛（blockquote/通用拆分各 1 行，heading 4 行）                                                 |
| L5  | exitListItem 三分支直返 EditorActionResult，删除 focusBlockId/focusAtStart 变量对；焦点 offset 语义逐分支核验等价  |
| N4  | kernel 新增 `setBlockTextAndRender`，inputCtrl 手动拼 blocks 的 4 行替换为单调用                                   |
| P3  | detectBlockConversion 改 `CONVERSION_RULES` 表驱动，规则顺序与原 if 链一致                                         |

### 批次三（等级 C，1 项）— 完成

| #   | 落实证据                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | parseBlocks 主循环收敛为纯分派。实施前核验：围栏/表格/引用/列表已是独立子函数（parseFence/parseTable/parseBlockquote/parseList），本次补提取标题/分割线为 parseAtxHeading/parseThematicBreak（返回绝对行索引，与原 `i++` 语义一致） |

### 二期项

| #   | 状态                                                          |
| --- | ------------------------------------------------------------- |
| P1  | 按规范仅注记，结构共享（path-copy）另行立项，本期未动（合规） |

## 2. 批次纪律与门禁证据

| 批次   | 门禁要求              | 实际结果                                                                                                              |
| ------ | --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 基线   | vitest 全量           | 238/238（与规范基线一致）                                                                                             |
| 批次一 | vitest + tsc + eslint | 238/238、0 error、0 error                                                                                             |
| 批次二 | 全五项                | vitest 238、playwright 25、tsc 0、eslint 0（含 0 warning）、vite build 成功                                           |
| 批次三 | 全五项 + 护栏         | vitest 238、playwright 25、tsc 0、eslint 0、vite build；护栏单跑 markdownRoundTrip + codeBlockTrailingParagraph 53/53 |
| 终局   | 全五项复核            | vitest 238/238（D1 修正后复跑）；tests/ 与 e2e/ 目录 git diff 为空（断言口径零变化）                                  |

批次间逐批核验后再进入下一批；批内等价性论证先行（defaultListMeta 的 `??` 语义、splitAndFocusNewLeaf transform 路径、exitListItem 焦点 offset、parseAtxHeading 行索引语义）。

## 3. 偏差与说明

1. **D1 初版未达规范口径**：批次一实施时保留两个同体回调函数，合规审计阶段发现后修正为单回调 `handleExternalContentChange` 并复跑门禁全绿。
2. **D3 在 onDeleteRange 的回退口径统一**（CodeReview Suggestion）：原 `inlineHtml ?? ''` 在 null 时输出零宽字符，新 `toDisplayHtml` 回退 `escapeHtml(text)`。deleteLeafRange 成功路径两端块必被 renderBlock，无实际差异；新口径与 ContentBlock 初始渲染一致。
3. **kernel 导出面附带新增**（CodeReview Suggestion）：因 `export *` 机制，newBlockId/defaultListMeta/setBlockTextAndRender/getCrossBlockSelection 随提取成为 kernel 公共 API（controllers 经 `'../kernel'` 导入，属规格内提取的必然结果）；getBlockIdFromSelection 从公共面移除属授权的死代码删除。既有导出签名零改动。
4. **L1 实施范围说明**：规范撰写时 parseBlocks 主体含全部块类型逻辑；实施前核验围栏/表格/引用/列表已为子函数，实际增量仅为标题/分割线提取 + 主循环注释更新。
5. **流程替代**：`/Ultra Review` 技能不存在，由内置 CodeReview 子智能体等价替代（结论：无 Critical/Warning）；test-quality-guard 因当前会话 Agent 工具仅支持内置子智能体，由主窗口代行终局门禁复核（证据见 §2）。

## 4. 零回归约束核验

- 导出 API 签名：既有签名零改动（仅新增导出与授权的死代码删除）。
- 依赖：无新增 npm 依赖。
- 测试资产：tests/、e2e/ 零改动；vitest 238/238 与 playwright 25/25 与基线逐一对应。
- SPEC-EDIT-CBTP 12 例补偿测试与往返属性测试全程未修改且全绿。
