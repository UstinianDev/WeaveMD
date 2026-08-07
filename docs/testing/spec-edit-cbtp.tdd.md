# SPEC-EDIT-CBTP TDD 实施证据报告

> 规范：docs/specs/code-block-trailing-paragraph.md（SPEC-EDIT-CBTP v1.0）
> 日期：2026-08-07 | 运行器：Vitest 1.x（`npx vitest run`）| 环境：Windows PowerShell
> 检查点说明：本次实施**未做任何 git commit**（用户未授权提交），以本报告作为阶段检查点证据。

---

## 1. 用户旅程（缺陷复现 → 修复验证）

| 步骤 | 旅程节点                              | 修复前                                                                                            | 修复后（本实施）                                                                      |
| ---- | ------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1    | Normal Mode 输入 ` ```js ` 创建代码块 | 编辑期 `convertCtrl.ensureTrailingParagraph` 补空段落（块树：code-block + 空 paragraph）          | 不变（未触碰编辑期逻辑）                                                              |
| 2    | 保存                                  | `stateToMarkdown` 把空段落序列化为尾部空白并被 `replace(/\n+$/,'')` 剥离（信息丢失，G4 要求保持） | 不变                                                                                  |
| 3    | 重载打开文件                          | `markdownToState` 跳过空行 → 空段落消失，代码块成为最后一块 ❌                                    | `markdownToState` 返回前补偿：末叶子为 code-block 时在同父容器末尾追加空 paragraph ✅ |
| 4    | 重载后 Backspace 该空行               | （空行不存在）                                                                                    | 空段落受既有 `backspaceCtrl.mergeParagraph` 保护（零改动，G2）                        |
| 5    | 重载后再次保存                        | —                                                                                                 | 往返不变量保持：`stateToMarkdown(markdownToState(M)) === M`（G3，用例 e 验证）        |

## 2. 改动清单

| 文件                                                     | 改动摘要                                                                                                                                                                                                                                                                                        | 性质 |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `src/render/editor/kernel/markdownToState.ts`            | 唯一生产代码改动：新增文件内私有函数 `appendTrailingParagraphIfCodeLast(builder)`（DFS 复用 `blockTree.getLastLeaf` 找整树文档序最后叶子；为 code-block 时在其同父容器末尾 `addBlock('paragraph','')` + `attach`）；`markdownToState` 返回前调用；文件头注释与新增章节注释说明规则（+29/-1 行） | 生产 |
| `tests/editor/kernel/codeBlockTrailingParagraph.test.ts` | 新增 12 例（a1/a2/a3/b1/b2/b3/c/c2/d/e/f1/f2），覆盖触发/不触发/容器归属/往返不变量/零占位符                                                                                                                                                                                                    | 测试 |
| `tests/editor/kernel/markdownRoundTrip.test.ts`          | 1 处断言对齐新规范行为：「代码内容含围栏时自动加长」用例的根子块数 1 → 2（code-block + 补偿空段落），其文本往返断言不受影响（141 行 `toBe(1)` → `toBe(2)` + 注释更新）                                                                                                                          | 测试 |

未改动（规范禁区确认）：`stateToMarkdown.ts`、`editorInstance.ts`、`controllers/*`、渲染层组件。

## 3. 任务 → 测试目标 → 红/绿证据映射

| 用例  | 任务点（规范条目）                  | 测试目标                                                                      | 红阶段（未实现）                         | 绿阶段（实现后） |
| ----- | ----------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------- | ---------------- |
| a1    | 4.2 触发 + B1 主场景                | 根级尾部代码块（带语言）→ 末两块 code-block + 空 paragraph（挂 document 根）  | FAIL：leaves 长度 1（期望 2）            | PASS             |
| a2    | 6.1.1 两形态                        | 无语言空内容代码块 → 同样补偿                                                 | FAIL：leaves 长度 1（期望 2）            | PASS             |
| a3    | B7 多代码块连续                     | 仅对最后一块补偿                                                              | FAIL：leaves 长度 2（期望 3）            | PASS             |
| b1-b3 | 4.2.3 不触发 / B2                   | 代码块后跟段落/标题/列表 → 不补偿                                             | PASS（守卫用例，红阶段即通过）           | PASS             |
| c     | B3 引用内                           | 引用内尾部代码块 → 补偿段落挂 blockquote 容器内（prevId 指向代码块）          | FAIL：quote.childrenIds 长度 1（期望 2） | PASS             |
| c2    | 4.6 归一化清单（B3 序列化口径）+ G4 | 引用内补偿序列化产出尾部裸 `>` 行；输出无零宽/占位符；重解析两态收敛          | FAIL：输出无裸 `>` 行                    | PASS             |
| d     | B4 列表场景可达形态 + G3            | 列表文档尾部代码块（全文档最后叶子）→ 同父容器补偿且 `roundTrip(M) === M`     | FAIL：缺补偿段落（leaves 缺第 3 块）     | PASS             |
| e     | G3 往返不变量（6.1.3 指定断言）     | `stateToMarkdown(markdownToState('```js\ncode\n```')) === '```js\ncode\n```'` | PASS（不变量守卫，实现前后均须成立）     | PASS             |
| f1/f2 | B5 空文档/仅段落                    | 不触发补偿                                                                    | PASS（守卫用例）                         | PASS             |

用例 d 的口径说明：当前解析器把列表项内缩进围栏行收纳为段落续行（`parseListItemContent`），
解析层不可达"list-item 子级含 code-block"的树形；规范 4.5 B4 的可达形态即
"代码块为全文档最后叶子、在其同父容器末尾补偿"，用例 d 覆盖该形态并验证往返还原。
补偿逻辑本身对父容器类型无假设（`parent = tree.blocks[lastLeaf.parentId]`），
list-item 内代码块一旦由其他路径（编辑期操作）进入树中，同样适用。

## 4. 测试保证表

| 保证项（规范目标）                 | 覆盖用例                                       | 状态 |
| ---------------------------------- | ---------------------------------------------- | ---- |
| G1 重载后空行恢复（解析期补偿）    | a1/a2/a3/c/d                                   | ✅   |
| G2 保护语义不变                    | 复用 `backspaceCtrl`（零改动，既有测试覆盖）   | ✅   |
| G3 往返不变量                      | e、d、c2（重解析收敛）、存量 41 例往返全绿     | ✅   |
| G4 无占位符/零宽字符、磁盘格式不变 | c2（`not.toMatch(/[\u200B\uFEFF\u00A0]/)`）、e | ✅   |
| G5 不影响现有功能                  | 全量回归 238/238                               | ✅   |
| 不补偿场景（B2/B5）                | b1/b2/b3/f1/f2                                 | ✅   |

## 5. 命令与输出摘录（证据）

### 5.0 基线（改动前全量）

```text
$ npx vitest run
 Test Files  18 passed (18)
      Tests  226 passed (226)
```

### 5.1 红：新用例（补偿未实现）

```text
$ npx vitest run tests/editor/kernel/codeBlockTrailingParagraph.test.ts
 Test Files  1 failed (1)
      Tests  6 failed | 6 passed (12)
```

失败明细（均为"补偿未实现"）：a1/a2/a3（leaves 缺尾部空段落，`expected 2 to be 1` 类）、
c（`quote.childrenIds` 长度 1≠2）、c2（输出缺裸 `>` 行）、d（leaves 缺第 3 块）。
失败断言摘录：

````text
c2: expected '> ```js\n> code\n> ```' to be '> ```js\n> code\n> ```\n>\n>'
d : expected [ 'paragraph', 'code-block' ] to deeply equal [ 'paragraph', 'code-block', 'paragraph' ]
````

同期全量（红阶段存量不回归确认）：

```text
$ npx vitest run
 Test Files  1 failed | 18 passed (19)
      Tests  6 failed | 232 passed (238)   # 6 个失败全部为新增补偿用例
```

### 5.2 绿：最小实现后

实现：`markdownToState.ts` 新增 `appendTrailingParagraphIfCodeLast(builder)`（私有函数，
复用 `getLastLeaf` + `addBlock('paragraph','')` + `attach`），主入口返回前调用。

```text
$ npx vitest run tests/editor/kernel/codeBlockTrailingParagraph.test.ts
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

全量回归首跑发现 1 例存量断言与新规范行为冲突：
`markdownRoundTrip.test.ts > 代码内容含围栏时自动加长` 断言根子块数 `toBe(1)`，
补偿后实际为 2（code-block + 空段落）；该断言属规范前口径，其文本往返断言
`stateToMarkdown(markdownToState(result)) === result` 不受补偿影响仍成立（G3 佐证）。
最小修正：`toBe(1)` → `toBe(2)` 并更新注释（未 skip/删除任何用例）。

```text
$ npx vitest run
 Test Files  19 passed (19)
      Tests  238 passed (238)   # 存量 226 + 新增 12
```

### 5.3 重构

实现本身即最小形态（单一私有函数 + 主入口一行调用，复用内核既有 `getLastLeaf`/Builder API），
未做额外重构；重构阶段以 5.2 全量绿为门禁确认（行为无变化）。

### 5.4 门禁

```text
$ npx tsc --noEmit
TSC_OK exit=0

$ npx eslint src/render/editor/kernel/markdownToState.ts tests/editor/kernel/codeBlockTrailingParagraph.test.ts tests/editor/kernel/markdownRoundTrip.test.ts
ESLINT_EXIT=0   # 零 error 零 warning
```

## 6. 覆盖率说明（已知缺口）

```text
$ npx vitest run --coverage
 MISSING DEPENDENCY  Cannot find dependency '@vitest/coverage-v8'
```

项目未安装 coverage provider（`@vitest/coverage-v8` 或 `@vitest/coverage-istanbul`）。
按本次任务约束**不安装新依赖**，覆盖率量化记录为已知缺口。替代保证：
`markdownToState.ts` 新增补偿分支的三条路径（触发/末叶子非 code-block/空文档）
分别由 a/c/d、b/f2、f1 用例覆盖；存量往返 41 例 + 本次 12 例构成行为回归网。
如需量化，建议总指挥另行批准安装 provider 后执行 `npx vitest run --coverage`。

## 7. 遗留事项（需总指挥跟进）

1. **规范文档回写**：`docs/specs/code-block-trailing-paragraph.md` 第 9 节（实现记录）
   与 `docs/specs/editor-v2-architecture.md` 4.2 归一化清单两行追加（4.6 内容）由总指挥负责，本次未改。
2. **B4 解析层能力**：当前解析器不支持"list-item 子级 code-block"（缩进围栏被收纳为
   段落续行）。编辑期可在列表项内创建代码块，保存为缩进围栏后重载会被解析为段落续行——
   这是先于本规范存在的往返不对称，与本次补偿逻辑无关，建议立项评估。
3. **E2E**：规范 6.2 的 Playwright 用例已补齐，见第 8 节（2026-08-07，25/25 全绿）。
4. **覆盖率 provider**：见第 6 节，需批准后安装 `@vitest/coverage-v8`。
5. **git 提交**：本次所有改动均未 commit（用户未授权），工作区状态即交付物。

## 8. E2E 补充（规范 6.2，Playwright 真实 Chromium）

> 补充日期：2026-08-07 | 改动范围：仅 `e2e/exit-behavior.spec.ts`（mock 扩展 + 新增 2 例），
> 生产代码零改动，未做 git commit。

### 8.1 新增用例

| 用例（`e2e/exit-behavior.spec.ts`）                        | 规范条目   | 断言要点                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ` ```js ` 代码块 → 应用重载 → 代码块后空行恢复且点击可聚焦 | 6.2.1 / G1 | 创建代码块 → 自动保存落盘 → `page.reload()` → Ctrl+O 重开；根块为 code-fence-block + paragraph-block，末块 `span.block-content[data-empty="true"]` 且文本为空（仅零宽符），语言 select 为 `javascript`（`js` 别名归一化，既有行为），点击后 `document.activeElement` 为该 span |
| 重载后代码块尾随空行 Backspace 受保护（块树不变）          | 6.2.2 / G2 | 重载后空行上 Backspace：前后块树结构快照（根块类型 + 末块空标记/文本）完全一致，`.code-fence-block` 与 `p.paragraph-block` 各 1、`data-empty="true"` 仍在                                                                                                                      |

### 8.2 mock 扩展（仅 e2e 层，`e2e/exit-behavior.spec.ts` 的 `mockApi`）

- 新增 localStorage 持久化的 mock 磁盘存储（key `weavemd_e2e_disk_files`，跨 `page.reload()` 存活）：
  `file.write` 按路径持久化 content、`file.readDisk` 按路径回读（缺省返回空内容）、
  `file.open` 回灌最近写入的文件（path/name/content）、`deleteDisk` 同步移除记录。
- 重载链路：Ctrl+N 新建（`dialog.saveFilePath` → `file.write` → `readDisk`）→ 编辑触发
  MainPage 自动保存（1200ms debounce，测试侧以 `waitForFunction` 轮询落盘内容确定就绪，
  避免固定 sleep）→ `page.reload()`（内存块树丢失）→ Ctrl+O 经 `file.open` 回灌 content →
  `editorStore.openFile → EditorV2.setContent → markdownToState` 解析期补偿重建块树。
- 存量 9 例不依赖持久化语义（仅新建后直接编辑），扩展后行为不变，全量回归确认无影响。

### 8.3 结果摘录

```text
$ npx playwright test e2e/exit-behavior.spec.ts
 11 passed (1.6m)          # 存量 9 例 + 新增 2 例

$ npx playwright test
 Running 25 tests using 5 workers
 25 passed (1.6m)          # 存量 23 例不回归 + 新增 2 例

$ npx eslint e2e/exit-behavior.spec.ts
ESLINT_EXIT=0              # 零 error 零 warning

$ npx tsc --noEmit
TSC_EXIT=0
```

### 8.4 红/绿说明

规范 6.2 属"实现已存在、补 E2E"场景：内核补偿已在第 5 节验证（vitest 238/238），
两条新 E2E 用例反映预期行为、直接通过，无红阶段，亦未做任何生产代码修复。
首跑唯一失败为用例口径问题：语言选择器把别名 `js` 归一化为 `javascript`
（`CodeBlock.normalizeLanguage`，先于本规范存在的既有行为），修正断言后转绿。
规范 6.2 第 3 条（重载后空代码块 Enter 退出行为不变）已由存量用例
「空代码块回车 → 退出代码块并可在下方继续输入」覆盖编辑期语义；重载后 Enter 路径
复用同一 `enterCtrl`，未单列用例（如需可后续补充）。
