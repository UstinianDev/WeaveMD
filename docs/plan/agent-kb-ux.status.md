# agent-kb-ux — 任务状态

> 档位 M，TDD standard；创建 2026-10-03；裁定 Q1~Q8 见需求文档与记忆 agent-kb-ux-progress

## 阶段进度
- [x] 阶段 0/1：M 级分级 + 一次对齐（Q1~Q8 全按推荐 + Q4 修正为仅会话消息）
- [x] 阶段 2：计划 `docs/plan/agent-kb-ux.plan.md`（含 D1~D4 阻断发现与行号核对）
- [x] 阶段 4：实现 — R2 ✅ `2820f05`；R3 ✅ `97c93f5`；R4 ✅ `ea3b81a`；R5 ✅ `f19c70b`
- [ ] 阶段 6：全量门禁 + 交付核对（R4/R5 门禁已随各提交实测，剩 docs 提交与交付核对）

## 任务执行记录
- **R2 ✅ `2820f05`**：composer `use-kb-toggle`；RED 2 failed → GREEN 71；门禁四项全绿（playwright 31 基线同名）。
- **R3 ✅（本轮提交，哈希见 git log）**：RED 12 failed → GREEN 221/221（六文件）；收尾 3 修复（i18n 缩进/vi.mocked 类型/注释×3）；
  门禁 typecheck 0 / test 4819+flaky 单跑 22 绿 / lint 0 / playwright 31·104·1 = 基线零新增 / db/index.ts 零 DDL。
  偏差：consentGranted 可选（谓词 fail-closed 等价）；预期适配仅 kbDao SQL 断言 + kbDoc fixture（计划列明）。
- **R4 ✅ `ea3b81a`**：copyPath 工具 + ContextMenu `onCopyPath` + FileTreePanel 提示条（1.5s 自清）+ 三语 sidebar.copyPath* 同位插键；
  RED 2 文件/3 例（copyPath 模块缺失 + 菜单项缺失）→ GREEN 15/15；typecheck 0 / lint 0 / test 4831+1 计时 flaky 单跑 37 绿。
- **R5 ✅ `f19c70b`**：`.ai-message-stream` CSS + AgentTab:285 挂类 + AIMessageBubble 三处内联普惠体删除（D3）；
  RED 2 例 → GREEN 9/9（CSS 测试首版为测试侧误红已修测试）；test 全量 4835 绿 / lint 0 / playwright 31·104·1 与基线 diff IDENTICAL；
  微偏差：textarea 补 className `[font-family:inherit]`（表单控件不继承字体）。
- 证据：`docs/testing/agent-kb-ux.tdd.md` 任务 3/4 两章已追加（**工作区未提交，随 docs 提交入库**）。

## 后续
1. 派发/执行 R4 → R5（两提交，i18n 同位插键）；
2. docs 提交 `docs(agent-kb-ux): record plan, tdd evidence and egress gate updates`（plan/req/status 入库，tdd 已随 R3）；
3. 阶段 6 全量门禁复核 + req §3 六条交付核对。
