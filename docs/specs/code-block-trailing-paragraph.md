# 代码块尾随保护空行持久化规范（Code Block Trailing Paragraph）

> 规范编号：SPEC-EDIT-CBTP | 版本：v1.0（草案，待评审后实施）| 更新：2026-08-07
> 关联需求：REQUIREMENTS.md EDIT-09（代码块）、EDIT-08（自动保存）
> 关联规范：SPEC-EDIT-EXIT 3.5（代码块退出与代码块后空段落保护）
> 关联文档：docs/modules/04-编辑主区-Editor.md、docs/specs/editor-v2-architecture.md（4.2 往返不变量）

---

## 1. 背景与问题

### 1.1 现状行为（编辑会话内）

Normal Mode 下通过 ` ```lang ` 前缀创建代码块时，若代码块之后没有其他内容块，
`convertCtrl.ensureTrailingParagraph` 会自动在其后插入一个**空段落**，作为退出/续写行：

- 空代码块内按 Enter → 光标移到该空段落（代码块保留）。
- 该空段落受 Backspace 保护（`backspaceCtrl.mergeParagraph`：前块为 code-block 时
  不合并、不删除），与 SPEC-EDIT-EXIT 3.5"代码块后空段落"语义一致。

### 1.2 缺陷描述

**重载应用（重新打开文件）后，代码块下方的这一空行消失**，导致：

1. 编辑会话内可见的"代码块 + 下方空行"结构，在重载后仅剩代码块本身，视觉与交互不一致。
2. 代码块成为文档最后一个块后，用户无法在代码块下方继续输入（需先在代码块内
   空内容按 Enter 退出才能续写），与重载前的交互体验不一致。

### 1.3 复现步骤

1. Normal Mode 新建文件，输入 ` ```js `（尾随空格）创建代码块。
2. 确认代码块下方出现可聚焦的空行（受 Backspace 保护）。
3. 保存并关闭文件（或重启应用），重新打开该文件。
4. **实际**：代码块下方空行消失，代码块为文档最后一块。
5. **期望**：空行仍在，行为与重载前一致。

## 2. 根因分析（代码审查结论）

空行的"创建—保存—重载"链路在**序列化/解析往返处断裂**：

| 环节 | 位置                                                   | 行为                                                                                                    |
| ---- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 创建 | `controllers/convertCtrl.ts` `ensureTrailingParagraph` | 代码块后无后续叶子时插入空 paragraph（块树层存在该空块）                                                |
| 保护 | `controllers/backspaceCtrl.ts` `mergeParagraph`        | 前块为 code-block 的段落 Backspace 受保护（行为正确，无需改动）                                         |
| 保存 | `kernel/stateToMarkdown.ts`                            | 空 paragraph 序列化后仅是块间/文末的**空白**；且主入口 `lines.replace(/\n+$/, '')` 剥离文档尾部所有换行 |
| 重载 | `kernel/markdownToState.ts` `parseBlocks`              | `isBlankLine(line)` 命中即跳过（空行仅作块分隔符），**从不生成空 paragraph 块**                         |

结论：CommonMark 文本层面无法区分"分隔空行"与"空段落块"，空段落信息在
`stateToMarkdown` 输出中即已丢失，`markdownToState` 无从还原。这属于
SPEC-EDITOR-V2 4.2 已知归一化清单中"文档首尾空行剥离"的副作用，
但当前规范未定义"重载后仍需恢复代码块尾随行"的补偿规则。

## 3. 需求与目标

| #   | 目标           | 说明                                                                                                               |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| G1  | 重载后空行恢复 | 打开文件/重建块树后，若文档序最后一个叶子块是 code-block，其后必须存在一个空 paragraph，行为与编辑会话内创建时一致 |
| G2  | 保护语义不变   | 恢复出的空段落同样受 Backspace 保护（复用既有 `mergeParagraph` 规则，零改动）                                      |
| G3  | 往返不变量保持 | `stateToMarkdown(markdownToState(M)) === M`（规范输入）仍然严格成立                                                |
| G4  | 存储内容不变   | 不向保存的 markdown 文本引入任何占位符/零宽字符；磁盘文件格式零变化                                                |
| G5  | 不影响现有功能 | 代码块后已有内容的文档、其余五种块类型、查找替换/撤销重做/模式切换行为均不变                                       |

## 4. 方案设计

### 4.1 总体思路：解析后规范化补偿（load-time normalization）

既然文本层无法表达空段落，则把"代码块尾随空行"定义为**解析期规范化规则**
（与 4.2 归一化清单同类：输入语义不变，块树结构补齐）：

> `markdownToState` 完成块级解析后，若整树文档序最后一个叶子块为 `code-block`，
> 在其后（同一父容器内）追加一个空 `paragraph` 块。

该规则与编辑期的 `ensureTrailingParagraph`（`getNextLeaf` 无后继才插入）互为镜像，
保证"新建 → 保存 → 重载"两态收敛一致。

### 4.2 规则细节

1. **触发条件**：`getLastLeaf(tree, root.id)` 存在且 `type === 'code-block'`。
2. **插入位置**：代码块之后、同一父容器内（复用 `insertBlockAfter` 语义）。
   - 根级代码块（主场景）：挂在 document 根末尾。
   - 引用内代码块且为全文档最后叶子（边缘场景）：挂在 blockquote 容器内代码块之后，
     与编辑期 `convertParagraphToBlock` 在引用内创建代码块时的插入位置一致。
3. **不触发**：代码块之后存在任何叶子块（段落/标题/列表内容等），无论其是否为空。
4. **空段落渲染**：补偿块需写入行内缓存（`renderBlock`/`renderInlineAll` 覆盖），
   空文本挂 `data-empty="true"` 后复用既有 `::before` 占位符样式。

### 4.3 实施位置（唯一收口点）

在 `kernel/markdownToState.ts` 的 `markdownToState` 主入口返回前执行补偿
（Builder 阶段 `attach` 一个空 paragraph 即可，无需不可变操作）。

选择该位置的理由——所有"文本 → 块树"入口一次性生效，无遗漏：

| 入口                     | 调用链                                                                 |
| ------------------------ | ---------------------------------------------------------------------- |
| 打开文件/应用重载        | editorStore.openFile → `EditorInstance.setContent` → `markdownToState` |
| Source → Normal 模式切换 | content → `markdownToState`                                            |
| 查找替换后整树重建       | updateContent → `setContent` → `markdownToState`                       |
| 撤销/重做快照恢复        | content 快照 → `setContent` → `markdownToState`                        |

不改动的部分：`stateToMarkdown`（序列化逻辑与剥离尾部换行行为保持原样）、
`backspaceCtrl` 保护规则、`convertCtrl` 创建逻辑、`EditorInstance.getMarkdown`
空文档判定（补偿后叶子块数为 2，不触发 `''` 短路分支）。

### 4.4 往返不变量论证（G3）

设 `M` 以围栏代码块收尾（规范输入）：

- `markdownToState(M)` = 原解析结果 + 追加空 paragraph。
- `stateToMarkdown`：document 子块以 `\n\n` 连接，空 paragraph 序列化为空串，
  产出尾部 `\n\n` 被主入口 `replace(/\n+$/, '')` 剥离 → 输出仍为 `M`。✅
- 非代码块收尾的文档不触发补偿，原不变量不受影响。✅

### 4.5 边缘场景清单

| #   | 场景                                     | 行为                                                                                                          |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| B1  | 代码块为文档最后一块（主场景）           | 补偿空段落；重载后空行恢复                                                                                    |
| B2  | 代码块后有内容（含空段落后有内容）       | 不补偿，与现状一致                                                                                            |
| B3  | 引用内代码块为全文档最后叶子             | 在引用内代码块后补偿（序列化为引用尾部一行裸 `>`，记入归一化清单，见 4.6）                                    |
| B4  | 列表项内代码块为全文档最后叶子           | 在代码块所在容器位置补偿；序列化时空段落作为 list-item 尾随空行被剥离，输出还原为 `M`，重载仍补偿（两态收敛） |
| B5  | 空文档 / 仅段落文档                      | 不触发（最后叶子非 code-block）                                                                               |
| B6  | Source 模式手工删除尾部空行后切回 Normal | 由补偿规则自动恢复空行——符合"保护空行始终存在"的语义，记为预期行为                                            |
| B7  | 多个代码块连续、最后一个为代码块         | 仅对最后一块补偿                                                                                              |

### 4.6 归一化清单补充（回写 SPEC-EDITOR-V2 4.2）

| 输入                   | 输出（规范化）                         | 说明                                 |
| ---------------------- | -------------------------------------- | ------------------------------------ |
| 以围栏代码块收尾的文档 | 块树末尾补空 paragraph（文本输出不变） | 代码块尾随行持久化（SPEC-EDIT-CBTP） |
| 引用内末尾代码块       | 引用尾部序列化出一行裸 `>`             | B3 边缘场景，语义等价                |

## 5. 改动文件清单（预估）

| 文件                                          | 改动                                                                     | 风险                   |
| --------------------------------------------- | ------------------------------------------------------------------------ | ---------------------- |
| `src/render/editor/kernel/markdownToState.ts` | `markdownToState` 返回前：最后叶子为 code-block 时 `attach` 空 paragraph | 低（纯函数，单点收口） |
| `tests/editor/kernel/`                        | 新增补偿规则与往返回归用例（见第 6 节）                                  | —                      |
| `docs/specs/editor-v2-architecture.md`        | 4.2 归一化清单追加两行（4.6 内容）                                       | —                      |
| `docs/modules/04-编辑主区-Editor.md`          | 第 4 节双向转换处补一句补偿规则；第 8 节限制项不变                       | —                      |

不改动：`stateToMarkdown.ts`、`convertCtrl.ts`、`backspaceCtrl.ts`、
`editorInstance.ts`、渲染层组件。

## 6. 测试策略

### 6.1 内核单元测试（Vitest）

1. `markdownToState`：尾部代码块（含语言/空内容两种）→ 最后两块为
   code-block + 空 paragraph（text === ''）。
2. `markdownToState`：代码块后跟段落/标题/列表 → 不补偿（块数与现状一致）。
3. 往返属性回归：现有 41 例往返测试全部保持通过；新增
   `stateToMarkdown(markdownToState('```js\ncode\n```')) === '```js\ncode\n```'`。
4. 引用内/列表项内尾部代码块补偿（B3/B4）。
5. `EditorInstance.getMarkdown`：补偿后序列化输出不含尾部空行、空文档判定不误触发。

### 6.2 E2E（Playwright 真实 Chromium）

新增 `e2e/exit-behavior.spec.ts` 用例（或独立 spec）：

1. 创建 ` ```js ` 代码块 → `page.reload()`（renderer-only 环境模拟应用重载，
   经 mock 存储回灌 content）→ 断言代码块后存在空 `.block-content`（`data-empty`），
   点击可聚焦。
2. 重载后该空行 Backspace 无反应（保护语义仍在）。
3. 重载后空代码块 Enter 退出行为不变。

### 6.3 回归门禁

`vitest run` 全量 + `tsc --noEmit` + ESLint（0 error）+ `vite build` +
`npx playwright test`（既有 23 例不回归）。

## 7. 风险与回退

| 风险                                                   | 缓解                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 补偿规则误伤"代码块收尾"的历史文档（块树多出一个空块） | 空段落不影响文本输出（G3/G4 论证）；大纲提取（`extractHeadingOutline` 只收 heading）、字数统计等下游按现状兼容；若发现下游异常可加类型过滤 |
| 与撤销栈交互：旧快照恢复后也补偿                       | 补偿在 `setContent` 唯一入口，行为一致，无分叉                                                                                             |
| 引用内补偿使保存文本出现尾部裸 `>`（B3）               | 属低频边缘场景，已入归一化清单；如需规避可将 B3 降级为不补偿（评审决议）                                                                   |
| 回退                                                   | 改动集中于 `markdownToState` 单一函数内的补偿分支，直接删除该分支即完全回退，无数据格式影响                                                |

## 8. 验收标准

- 复现步骤（1.3）第 4 步变为：重载后代码块下方空行仍在、可聚焦、Backspace 受保护。
- 新建文档"创建代码块 → 保存 → 重载"前后块树结构一致（末两块为 code-block + 空 paragraph）。
- 磁盘保存的 .md 文本内容与本规范实施前完全一致（无占位符、无尾部空行）。
- 全量测试门禁（6.3）通过；SPEC-EDIT-EXIT 六条退出规则行为不变。

## 9. 实现记录

### 9.1 已实现（2026-08-07，TDD 实施）

按第 4/5 节实施，改动集中于解析器单点，禁区文件零触碰：

| 文件                                                     | 内容                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/render/editor/kernel/markdownToState.ts`            | 唯一生产改动（+30/-1）：新增私有函数 `appendTrailingParagraphIfCodeLast(builder)`——复用内核 `getLastLeaf` DFS 找整树最后叶子，为 code-block 时在其同父容器末尾 `addBlock('paragraph', '')` + `attach`；`markdownToState` 返回前调用；文件头与章节注释同步 |
| `tests/editor/kernel/codeBlockTrailingParagraph.test.ts` | 新增 12 例：覆盖 6.1 全部 6 组用例（含多代码块仅补最后一块、B3 序列化口径、零宽字符检查）                                                                                                                                                                 |
| `tests/editor/kernel/markdownRoundTrip.test.ts`          | 1 处存量断言对齐规范后行为（围栏自动加长用例根子块数 1→2），未删除/跳过任何用例                                                                                                                                                                           |
| `e2e/exit-behavior.spec.ts`                              | 新增 2 例：重载后空行恢复且可聚焦（规范 6.2.1）、重载后空行 Backspace 受保护（规范 6.2.2）；mock 层新增 localStorage 持久化磁盘存储以支持 reload 回灌                                                                                                     |
| `docs/specs/editor-v2-architecture.md`                   | 4.2 归一化清单追加两行（4.6 内容）                                                                                                                                                                                                                        |
| `docs/modules/04-编辑主区-Editor.md`                     | 第 4 节补尾部代码块补偿规则说明                                                                                                                                                                                                                           |
| `docs/testing/spec-edit-cbtp.tdd.md`                     | TDD 证据报告（红/绿映射、保证表、命令摘录）                                                                                                                                                                                                               |

**TDD 证据**：红——新用例 12 例中 6 例因"补偿未实现"失败（存量 226 例全绿）；
绿——最小实现后 12/12 转绿；重构——实现即最小形态，未额外重构。

**验证**：`vitest run` 238/238 通过（19 文件，含存量 41 例往返回归）；
Playwright Chromium E2E 25/25（存量 23 + 新增 2）；`tsc --noEmit`、
ESLint（0 error，tests/setup.ts 4 个既有 warning）、`vite build` 均通过。
往返不变量抽查：`stateToMarkdown(markdownToState('```js\ncode\n```')) === '```js\ncode\n```'`。

**实施中发现的偏差（记录）**：

- B4 口径：现行解析器将列表项内缩进围栏收纳为段落续行，"list-item 子级
  code-block"在解析层不可达；用例 d 覆盖其可达形态（全文档最后叶子补偿 +
  往返还原）。编辑期在列表项内创建代码块保存后重载降级为段落文本，属先于
  本规范的往返不对称，建议另行立项。
- 规范 6.2 第 3 条（重载后空代码块 Enter 退出）未单列用例：编辑期语义已由
  存量 E2E 覆盖，重载后复用同一 `enterCtrl`。
- 覆盖率量化未执行：`@vitest/coverage-v8` 未安装且约束不新增依赖，补偿分支
  三路径（触发/不触发/空文档）已由 a/c/d、b/f2、f1 行为覆盖，记为已知缺口。
- Git 检查点提交未执行（用户未授权提交），以证据报告代替；全部改动留在工作区。
