# editor-opt-feedback-mail — 问题反馈邮件（主进程/IPC/DB/新依赖，L 级/TDD strict）

角色：fullstack-detail-dev | TDD strict | 分支 feat/ai-agent-ph3-ph4 | 需求 req.md §⑤ | 计划 editor-opt-feedback-mail.plan.md

## 范围

- 依赖：装 `nodemailer@^6`（deps）+ `@types/nodemailer`（devDeps）。
- **新** `src/main/mail/config.ts`（FEEDBACK_TARGET_EMAIL='2762943351@qq.com'、smtp.qq.com:465 secure、超时、上限常量 MAX_FEEDBACK_IMAGES=5/MAX_IMAGE_SIZE_MB=10/MAX_TOTAL_SIZE_MB=20）+ `service.ts`（createTransporter 每次现建现关 + sendMail Buffer 附件 + MailErrorCode 错误映射，不外透原始 SMTP error）。
- **新** `src/main/db/mail.ts`（mail_config 表 DAO，参数化，user_id 过滤）+ `db/index.ts` runMigrations 建表 + `MAIL_CONFIG_SCHEMA` 常量。
- 授权码：复用 `main/ai/secureConfig.ts` encryptApiKey/decryptApiKey；`mail:get` 只回 `{hasAuthCode}`，明文不落渲染不 hardcode。
- `shared/constants.ts` 增 MAIL_GET/MAIL_SET/MAIL_SEND/MAIL_PICK_IMAGES；`shared/types.ts` 增类型；`ipc-handlers.ts` registerMailIpcHandlers（校验 userId）；`preload.ts` WeaveMDApi.mail。
- **新** `src/render/components/Feedback/FeedbackModal.tsx`（描述 textarea + 多图 pick-images + media:// 缩略图/删单个 + 授权码区仿 ModelForm + 确认发送 + 成功/失败 toast；hasAuthCode=false 点发送首拦提示）。
- 改 `HelpMenu.tsx`（「设置」下方插「问题反馈」）+ `TopBar.tsx`（挂 FeedbackModal）。
- i18n 三 JSON（en/zh-CN/zh-TW）补 feedback.* 键，三处键集一致。

## 关键实现点

- SMTP：smtp.qq.com:465 secure:true(SSL)；from/to 均目标邮箱；subject 前缀 `[WeaveMD 问题反馈]`+时间戳。
- 图片双向校验（渲染即时 + 主进程权威 stat 前置）；文件不整读超限。
- 测试（先 RED）：mailDao.test / validateImages.test（纯函数）/ serviceSend.test（mock transport 三态错误分类）/ FeedbackModal.test。Playwright 反馈表单 spec（真 SMTP 打标跳过）。
- 安全：授权码 safeStorage 加密存 SQLite；SECURITY.md 合规。

## 门禁（本模块）

- `npx vitest run tests/main/mail tests/main/db/mail tests/components/FeedbackModal` 全绿（含先 RED 证据）
- `npm run typecheck` 0 | `npm run lint` 0（本模块文件）| vite build 三包成功
- 只返回结构化摘要：{完成项, 测试证据, 未完成项, 风险}
