# editor-opt-feedback-mail — 帮助「问题反馈」→ QQ 邮箱 SMTP 自收（L 级）

> 2026-08-16 | 需求见 editor-optimization-batch.req.md §⑤ | Plan 智能体产出
> 涉主进程/IPC/DB/新依赖/授权码加密 → L 级 + 安全合规

## 1. 现状分析

- `HelpMenu.tsx:15-30` 仅「设置」+版本，无反馈入口；`TopBar.tsx:166` 挂载。
- IPC 注册于 `main/ipc-handlers.ts` registerAllIpcHandlers，preload `main/preload.ts:318`
  contextBridge 暴露 `weaveMD`；通道集中 `shared/constants.ts` IPC_CHANNELS；类型 `shared/types.ts` IpcResponse。
- `main/ai/secureConfig.ts` 已有 `encryptApiKey/decryptApiKey/isEncryptionAvailable`（含 basic_text 降级标记），
  存 SQLite `ai_config.api_key_enc`——可直接复用。
- DB 迁移：`PRAGMA table_info` 探测 + ALTER/建表（`ADD COLUMN IF NOT EXISTS` 对 better-sqlite3 11.x 报错，
  用探测法）。
- **无 nodemailer**；图片本地 media://；`DIALOG_PICK_IMAGE` 已有单选；i18n 三 JSON 均无 feedback 键。

## 2. 技术方案

### 主进程 mail 模块（新增 src/main/mail/）
- `config.ts`：`FEEDBACK_TARGET_EMAIL='2762943351@qq.com'`、smtp.qq.com、port 465、secure true(SSL)、
  超时、上限常量 `MAX_FEEDBACK_IMAGES=5`/`MAX_IMAGE_SIZE_MB=10`/`MAX_TOTAL_SIZE_MB=20`。**无授权码明文**。
- `service.ts`：`createTransporter(authCode)`（每次 send 现建现关，`transporter.close()` 防授权码常驻内存）+
  `sendMail({to,subject,text,attachmentsPath[]})`：fs.readFileSync → nodemailer attachments（Buffer form）。
  返回 `{success, messageId?, error?:{code,message}}`。
- 错误分类 `MailErrorCode`：not_configured / auth_failed(535/EAUTH) / network(ECONNREFUSED/ENOTFOUND) /
  timeout(ETIMEDOUT) / invalid_image / send_failed(554)。**不外透原始 SMTP error**，映射 i18n。

### 授权码存储（仿 ai.ts + secureConfig.ts）
- 新增独立表 `mail_config`（user_id UNIQUE，仅 1 列密文 auth_code_enc）；`db/index.ts` runMigrations 建表 +
  `MAIL_CONFIG_SCHEMA` 常量导出（供测试）。
- DAO `main/db/mail.ts`：`getMailAuthEnc/setMailAuthEnc`（参数化，user_id 过滤）。
- 加解密在 IPC 层：`mail:set` 接收明文立即 `encryptApiKey` 落库；`mail:get` 只回 `{hasAuthCode}`，
  明文只在主进程瞬态，**绝不回传渲染**。

### IPC / preload / 通道（4 个）
```
MAIL_GET: 'mail:get',           // { userId } -> { hasAuthCode }
MAIL_SET: 'mail:set',           // { userId, authCode }
MAIL_SEND: 'mail:send',         // { userId, subject, body, images: string[] }
MAIL_PICK_IMAGES: 'mail:pick-images'  // dialog.showOpenDialog multiSelections -> string[]|null
```
- `registerMailIpcHandlers()` 仿 registerAiIpcHandlers；校验 userId 归属；preload `WeaveMDApi.mail` invoke 包装。

### 渲染端 FeedbackModal
- HelpMenu「设置」下方插入「问题反馈」→ 打开 `FeedbackModal`（TopBar 受控 open）。
- 表单：问题描述 textarea（必填）+ 多图（pick-images 多选，media:// 缩略图列表+可删单个+数量/大小徽标）
  + 授权码区（仿 ModelForm：type=password、hasAuthCode 布尔、已设置隐藏、清空即断开；basic_text 弱密钥环警告）
  + 确认发送 → 成功/失败 toast（loading 态+禁用）。
- 首拦：hasAuthCode=false 点发送 → 提示先配授权码（不静默）。

### 图片处理
- pick-images 只拿路径数组（渲染不读内容）；mail/send 主进程 stat.size 前置校验 + fs.readFileSync Buffer 附件；
  contentType 按扩展名映射；数量≤5、单图≤10MB、总≤20MB 双向校验（主进程权威）。

## 3. SMTP 配置要点
- smtp.qq.com:465 + secure:true（SSL）；必须 16 位**授权码**（填 QQ 密码触发 535 EAUTH）；新授权码可能延迟 ~1h 生效。
- from/to 均 2762943351@qq.com（自收）；subject 带固定前缀 `[WeaveMD 问题反馈]`+时间戳。
- nodemailer@^6 + @types/nodemailer（dev）。

## 4. 变更清单

**新增**
- `src/main/mail/config.ts`、`src/main/mail/service.ts`、`src/main/db/mail.ts`
- `src/render/components/Feedback/FeedbackModal.tsx`
- 依赖 nodemailer@^6（deps）+ @types/nodemailer（devDeps）

**修改**
- `src/shared/constants.ts`（4 个 MAIL IPC 通道）、`src/shared/types.ts`（MailAuthCode/MailSendResult/MailErrorCode）
- `src/main/db/index.ts`（mail_config 建表）、`src/main/ipc-handlers.ts`（registerMailIpcHandlers）、`src/main/preload.ts`
- `src/render/components/Navbar/HelpMenu.tsx`（插「问题反馈」）、`TopBar.tsx`（挂 FeedbackModal）
- i18n 三 JSON（en/zh-CN/zh-TW）补 feedback.* 键（三处键集一致）

**测试（先 RED）**
- `tests/main/db/mailDao.test.ts`、`tests/main/mail/validateImages.test.ts`（纯函数）、
  `tests/main/mail/serviceSend.test.ts`（mock transport 三态）、`tests/components/FeedbackModal.test.tsx`
- Playwright 反馈表单流程 spec（真 SMTP 打标跳过，mock 覆盖）

## 5. 实施步骤（TDD）
1. 装 nodemailer + @types/nodemailer。
2. RED：validateImages 纯函数测试 → GREEN config.ts + validateImages。
3. RED：mailDao.test → GREEN db/mail.ts + index.ts migration。
4. RED：serviceSend.test（mock transport 错误分类）→ GREEN service.ts。
5. shared constants/types；ipc-handlers + preload。
6. RED：FeedbackModal.test → GREEN FeedbackModal + 授权码区。
7. HelpMenu 插项 + TopBar 挂载；i18n 三处补键。
8. 全量门禁（tsc/vitest/lint/vite build/Playwright）。

## 6. 验收标准
- 帮助菜单「问题反馈」位于「设置」下方；表单填描述+多图（≤5/≤10MB/≤20MB）+确认发送；
  成功/失败明确提示；邮箱 2762943351@qq.com 收到含描述+附件图片邮件（真 SMTP 手工验收）。
- 授权码 safeStorage 加密存 SQLite；渲染仅 hasAuthCode 无明文；不 hardcode。

## 7. 风险
- 真 SMTP 依赖网络/授权码，CI 无法真发 → Playwright 打标跳过真发送 + mock 单测 + 手工验收脚本。
- nodemailer 新依赖 electron-builder 打包 → 主进程构建 external 化 + 构建后 smoke。
- mail/send 大量 Buffer 同步读阻塞 → stat 前置校验 + 总量上限先拒。
- IPC/contextBridge 扩展破坏既有 ai/kb → 既有组件测试回归。
- safeStorage Linux basic_text 明文等价 → 弱密钥环警告（SECURITY 合规）。
