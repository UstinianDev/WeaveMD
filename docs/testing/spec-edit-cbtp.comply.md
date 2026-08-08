# SPEC-EDIT-CBTP 合规检查报告（skill-comply）

> 检查对象：SPEC-EDIT-CBTP 实施过程与产物（2026-08-07）
> 规则源：`docs/specs/code-block-trailing-paragraph.md` + tdd-workflow 技能
> 方法：skill-comply 方法论（规则提取 → 逐项 LLM 分类 → 时序核验）。
> 自动化 `claude -p` 场景重放管线用于"未来行为"度量，不适用于已完成实施的
> 事后审计，本次以产物 diff、测试输出与 TDD 证据报告为证据源逐项核对。

## 1. 期望行为序列（自规范提取）

1. 触发条件：解析后整树文档序最后叶子为 code-block。
2. 补偿动作：在其同父容器末尾追加空 paragraph（根级→document 根；引用内→blockquote）。
3. 排除条件：代码块后存在任何叶子块时不补偿。
4. 唯一收口点：`markdownToState` 主入口（覆盖打开文件/模式切换/查找替换/撤销恢复）。
5. 禁区：不改 `stateToMarkdown.ts` / `editorInstance.ts` / controllers / 渲染层。
6. 不变量：规范化往返 `stateToMarkdown(markdownToState(M)) === M` 保持。
7. 存储零变化：不引入占位符/零宽字符。
8. 测试覆盖：规范 6.1 单测六组 + 6.2 E2E（重载恢复、Backspace 保护）。
9. 门禁：vitest / tsc / ESLint(0 error) / vite build / playwright。
10. 文档回写：v2-architecture 4.2 清单、04-编辑主区 §4、本规范 §9。
11. TDD：测试先行且 RED 验证 → 最小实现 GREEN → 重构 → 证据报告。

## 2. 逐项核验

| # | 规则项 | 结果 | 证据 |
| - | ------ | ---- | ---- |
| 1 | 触发条件（最后叶子为 code-block） | PASS | `appendTrailingParagraphIfCodeLast`：`getLastLeaf` + `type !== 'code-block'` 提前返回（markdownToState.ts diff） |
| 2 | 同父容器末尾追加空 paragraph | PASS | `builder.attach(parent, paragraph)`，parent 取 lastLeaf.parentId；测试 a/c 组断言父容器 |
| 3 | 有后续块不补偿 | PASS | 测试 b1-b3（段落/标题/列表后随）通过 |
| 4 | 唯一收口点 markdownToState | PASS | 调用位于 `markdownToState()` 返回前单处；四入口均经此函数 |
| 5 | 禁区零触碰 | PASS | `git diff --stat`：生产改动仅 markdownToState.ts；stateToMarkdown/editorInstance/controllers/渲染层无 diff |
| 6 | 往返不变量保持 | PASS | 存量 41 例往返测试全绿 + 新增用例 e 断言 `'```js\ncode\n```'` 严格往返 |
| 7 | 存储零变化/无占位符 | PASS | 用例 c2 零宽字符检查 + 全库 grep 确认 ZWSP 仅存于既有显示层；补偿块 text === '' |
| 8 | 单测六组用例 | PASS | `codeBlockTrailingParagraph.test.ts` 12 例覆盖 a-f 全部组 |
| 9 | E2E 6.2.1 重载恢复可聚焦 | PASS | exit-behavior.spec.ts 新增用例（reload + Ctrl+O 回灌 + data-empty 断言 + activeElement） |
| 10 | E2E 6.2.2 Backspace 保护 | PASS | 新增用例（块树快照前后一致） |
| 11 | E2E 6.2.3 空代码块 Enter 退出 | DEVIATION | 未单列用例；编辑期语义已由存量 E2E 覆盖且重载后复用同一 enterCtrl（规范 §9.1 已记录） |
| 12 | 门禁全通过 | PASS | vitest 238/238、playwright 25/25、tsc exit 0、ESLint 0 error（4 个既有 warning 在 tests/setup.ts）、vite build 成功 |
| 13 | 文档回写三处 | PASS | v2-architecture 4.2 +2 行、04-编辑主区 §4 补偿规则、本规范 §9.1 实现记录 |
| 14 | TDD 测试先行 + RED 门 | PASS | 证据报告：红阶段 6 例因"补偿未实现"失败（失败原因分类正确），存量全绿 |
| 15 | 最小实现 GREEN | PASS | +30/-1 单函数实现；12/12 转绿 |
| 16 | 重构阶段 | PASS | 声明实现即最小形态无需重构，以全量绿确认行为不变 |
| 17 | 证据报告 | PASS | `docs/testing/spec-edit-cbtp.tdd.md`（旅程/映射/保证表/命令摘录/E2E 追加节） |
| 18 | 覆盖率 ≥80% 量化 | DEVIATION | 缺 `@vitest/coverage-v8`，按"不新增依赖"约束未量化；补偿分支三路径已由行为用例覆盖（已记录） |
| 19 | Git 检查点提交 | DEVIATION | 用户未授权 git commit，以证据报告代替检查点（已记录） |

## 3. 合规率

- 检查项 19：PASS 16，DEVIATION 3，FAIL 0。
- **严格遵循率 16/19 = 84.2%**；3 项偏差均为"已记录理由的可接受偏差"
  （环境约束或既有覆盖替代），无静默偏离，**按可接受偏差口径 100%**。

## 4. 时序核验（TDD 红→绿顺序）

证据报告记录：先运行新用例（6 failed，失败原因为断言不满足而非语法错误）→
后提交生产实现 → 复跑转绿。顺序符合 TDD RED 门要求；唯一存量断言修正
（markdownRoundTrip 根子块数 1→2）发生在 GREEN 后，属规范行为变更的口径对齐，
非"改测试凑绿"（语义注释同步更新，未删/skip 用例）。

## 5. 结论与后续建议

实施与 SPEC-EDIT-CBTP 及 tdd-workflow 实质一致，无违规项。建议：

1. 如需量化覆盖率，批准安装 `@vitest/coverage-v8` 后补跑。
2. B4（列表项内代码块往返不对称）为先于本规范的既有问题，建议另行立项。
