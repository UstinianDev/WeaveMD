# WeaveMD — 安全规则

## 密码与认证
- 禁止在代码中 hardcode 任何密钥、Token 或密码
- 密码必须使用 bcryptjs hash 后存储，禁止明文
- JWT secret 使用环境变量 `VITE_JWT_SECRET` 或运行时生成
- 保留账号列表：`admin`, `root`, `system`, `guest`, `test`, `administrator` — 禁止注册

## 数据库
- 所有 SQL 必须使用参数化查询（`?` 占位符），禁止字符串拼接
- 示例：`db.prepare('SELECT * FROM users WHERE username = ?').get(username)`
- 用户数据严格按 `user_id` 过滤，IPC 调用必须验证当前用户身份

## 前端
- 禁止使用 `dangerouslySetInnerHTML` — 使用 unified/remark 安全渲染
- 所有用户输入在提交前必须经过 validators 验证
- 账号正则：`^[a-zA-Z][a-zA-Z0-9_]{4,14}$`
- 密码强度：最少 8 位，含大小写字母、数字、符号

## IPC
- 渲染进程不能直接访问主进程数据库
- 所有 IPC 通信通过 `contextBridge` 暴露的 API 进行
- IPC handler 必须验证调用来源和参数合法性