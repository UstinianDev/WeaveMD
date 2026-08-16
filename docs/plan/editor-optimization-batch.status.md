# editor-optimization-batch — 进度与交接记录

> 2026-08-16 | grill-me 需求对齐（已完成，非实现）| 本文件为**下一会话交接输入**

## 状态

- **需求交接文档**：`docs/requirements/editor-optimization-batch.req.md`（5 项优化/功能，含代码现状、决策、验收标准、范围外）。
- 5 项已 grill-me 对齐（AskUserQuestion 一次确认）：
  - ① 跨块向上拖选闪烁卡顿（性能）——优化 `resolveSyntaxTypesInRange` 缓存 + 排查 mouseup replay。
  - ② 登录页四小人物动画——**完整复刻 careercompass**（替换 InteractiveMascot，纯 CSS）。
  - ③ 「编辑历史」实现 + **恢复整个文件树**（两者都要）。
  - ④ 内置全量 markdown 语法文档——**每次启动注入**。
  - ⑤ 帮助「问题反馈」→ **QQ 邮箱 SMTP 自收**（授权码 safeStorage 加密，nodemailer）。
- 任务外既有阻塞（本批不处理）：electron-builder MSI 缺图标（`public/icons/icon.png` + author 元数据）、
  drag-selection-markers 5 个已知 RED。

## 下一会话 devflow-core 提示词（用户直接复制）

```
剩余任务：编辑器 5 项优化与功能（新开会话）。

【交接背景】grill-me 已对齐需求，见 docs/requirements/editor-optimization-batch.req.md
（含代码现状与决策）。上一任务 editor-table-block 已交付且门禁全绿，工作树含未提交改动
（上批 editor-table-block 变更 + 本批需求/status 文档）。

【本次范围】按顺序，每项 devflow L 级走完整流程（grill-me 已对齐，可直接进规划）：
① 性能：跨块向上拖选不同语法类型段落光标闪烁卡顿 → 优化 resolveSyntaxTypesInRange
   缓存（syntaxType.ts 95-117 每 selectionchange 帧重扫无缓存）+ 排查
   useCrossBlockDragSelection mouseup 3 帧 replay 竞争（223-248）。
② 登录页左侧四小人物动画：参考 github.com/arsh342/careercompass（眼随鼠标/邮箱变高对视/
   密码遮眼回避/显示偷看/失败摇头），替换现有 InteractiveMascot（AuthPage.tsx:37），纯 CSS 无动画库。
③ 顶部导航栏「编辑历史」实现（HistoryMenu/HistoryPanel/historyStore 已有但非最近打开，
   需时间倒序+persist 到 localStorage）+ 恢复整个文件树（fileTreeStore 无 persist，
   重启恢复文件夹树+当前编辑文件，磁盘失效优雅跳过）。
④ 内置全量 markdown 语法欢迎文档，每次启动注入左侧文件树+编辑区优先展示，可删除但重启再注入
   （无现有欢迎机制，新增 src/render/assets/welcome.md + MainPage 空态种子逻辑；内容以编辑器实际支持语法为准）。
⑤ 帮助菜单「设置」下方加「问题反馈」：表单+多图，确认发送统一到 2762943351@qq.com；
   主进程 nodemailer + mail/send IPC，QQ 邮箱 SMTP 自收，授权码 safeStorage 加密存 SQLite 不 hardcode。

【参考】5 项彼此独立可拆子任务并行；每项门禁 tsc 0/vitest/lint 0/vite build/Playwright 全绿；
任务外既有阻塞（MSI 图标、drag-selection 5 RED）不处理仅报告。需求细节/验收标准见 req.md。
```

## 分级建议（供下会话阶段 0 参考）

- ⑤（邮件+IPC+加密存 key+新依赖）跨模块涉安全 → L 级。
- ③（persist + 文件树恢复）跨模块 → M~L。
- ②（纯 UI 动画）→ M。
- ④（内置文档+种子逻辑）→ M。
- ①（性能优化+回归）→ M。
