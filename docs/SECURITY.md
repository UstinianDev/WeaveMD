# WeaveMD — 安全规范

> 本章节为占位文档，将在开发过程中逐步完善。

## 认证安全
- 密码使用 bcryptjs 加密存储，禁止明文
- JWT Token 存储在 localStorage，不暴露给 IPC
- 保留账号列表：admin, root, system, guest — 禁止注册

## 数据库安全
- 所有 SQL 查询使用参数化查询（better-sqlite3 原生支持）
- 用户数据按 user_id 隔离，IPC 调用必须携带当前用户 ID
- 删除账号时级联删除所有关联数据

## 前端安全
- 禁止 dangerouslySetInnerHTML — 使用 unified/remark 安全渲染 Markdown
- 输入验证：账号 5-15 位，正则 `^[a-zA-Z][a-zA-Z0-9_]{4,14}$`
- 密码强度：最少 8 位，含大小写字母、数字、符号