# editor-optimization-batch — 进度与交接记录

> 2026-08-16 grill-me 对齐 | 2026-08-17 全部交付，门禁全绿（含 1 处冲突修复）

## 状态：✅ 5 项全部交付

| # | 任务 | 交付 | 关键产物 | 验证 |
|---|---|---|---|---|
| ① | 跨块拖选闪烁卡顿 | ✅ | syntaxType.ts 单槽 memo（`resolveSyntaxTypesInRange`+`clearSyntaxRangeCache`）；useCrossBlockDragSelection mouseup 3 帧→1 帧写入前校验 | vitest 44 绿；Playwright cross-block-selection+drag-selection-move 6/6 |
| ② | 登录页四小人物 | ✅ | MascotCharacter + FourMascots（替换 InteractiveMascot 门面化，保留 MascotState）；Input 增 onVisibilityToggle；眼随鼠标/变高对视/遮眼回避/偷看/摇头 | vitest 22 绿；typecheck 0 |
| ③ | 编辑历史+文件树恢复 | ✅ | recentStore persist（`weavemd_recent`，时间倒序/去重/上限20）；fileTreeStore persist（`weavemd_filetree`，partialize 去 content）+ restore()；HistoryMenu 倒序；磁盘失效 readDisk 剔除+提示 | vitest 11 绿；Playwright recent-history-restore 2/2 |
| ④ | 内置欢迎文档 | ✅ | assets/welcome.md（29 项已实现语法，图片条目=语法示例+说明，无破图）；welcomeDocument.ts（`welcome://` 判定注入+saveFile 短路）；MainPage 注入 | vitest 10 绿（含 roundtrip 收敛 fixture）；Playwright welcome-doc 2/2 |
| ⑤ | 问题反馈→QQ 邮箱 | ✅ | 主进程 mail/（config/service/validateImages，smtp.qq.com:465 + nodemailer@^6 external）；mail_config 表（授权码 safeStorage 加密，mail:get 只回 hasAuthCode）；4 个 mail IPC；FeedbackModal+HelpMenu+i18n(三语言 feedback.error.*) | vitest 28 绿；Playwright feedback 5 passed+1 skip(真SMTP)；vite build 三包 |

## 门禁（全量，2026-08-17）

- `npm run typecheck` 0 error | `npm run test` **1478/1478 全绿** | `npm run lint` **0 error**（10 个 warning 均为既有文件）| `npx vite build` 三包成功（nodemailer 主进程 external 已验证可加载）
- `npx playwright test` **125 passed / 5 failed / 1 skipped**
  - 5 failed = drag-selection-markers **既有任务外阻塞**（DSG-R1/R2a/R2b/R3/P），未处理（本批不触碰）
  - 1 skipped = feedback 真 SMTP 手工验收（需真实授权码+网络）
- **A1c 冲突已修复**（用户决策「修 A1c 测试前置」）：④ 欢迎文档启动自动打开（需求要求"编辑区优先展示"）破坏 A1c「未打开文档」前提 → A1c 测试改为先 File→关闭欢迎文档再断言 AI 引导提示。④ 行为保持不变。

## 合规核对（Phase 7，审查智能体）

- 总体通过。安全专项（⑤）通过：授权码不 hardcode、明文不出主进程、SQL 参数化+user_id 隔离、错误分类不外透原始 SMTP 细节。
- 修正 3 项（全部已改+验证）：
  1. welcome.md 图片引用不存在 resources/*.svg → 改为语法示例+说明（计划方案 A，消除破图）。
  2. FeedbackModal 未消费 error.code → 补三语言 `feedback.error.*` 分类键 + handleSend 映射（auth_failed/network/timeout/invalid_image/generic），测试断言同步更新。
  3. Input.tsx setShowPassword updater 内副作用 → 移出（onClick 读当前值）。
- 一致性说明（非本批引入，建议后续统一）：IPC 数据通道以入参 userId+DB user_id 过滤，未校验 session token 归属（与既有全通道同模型）。

## 任务外既有阻塞（不处理，另开任务）

- electron-builder MSI 缺图标（`public/icons/icon.png` + author 元数据）。
- drag-selection-markers 5 RED（拖选含标记序列化，DSG-R1/R2a/R2b/R3/P）。

## 未完成项 / 后续建议

- ⑤ 真 SMTP 手工验收：真实 QQ 授权码 + 网络，发送含附件邮件到 2762943351@qq.com（e2e 已打标 skip）。
- ② 动画视觉人工验收：`npm run dev` 目测明暗主题/md 断点/偷看/摇头（单测已覆盖逻辑）。
- 可选增强：帮助菜单「欢迎文档」入口（④ 计划 §2.6，未做）；IPC 会话 token 归属统一加固。

## 下一任务候选

- 既有阻塞处理（MSI 图标 / drag-selection 5 RED）。
- ⑤ 真 SMTP 手工验收 + ③/④ 重启恢复人工验收。
