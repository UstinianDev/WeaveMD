# 安全架构

> 最后更新：2026-09-09

## 安全层次

```
用户输入 → 参数验证 → 权限检查 → 加密存储 → 安全执行
```

## 认证系统

| 机制 | 说明 |
|------|------|
| 密码存储 | bcryptjs hash（禁止明文） |
| JWT | `VITE_JWT_SECRET` 或运行时生成 |
| 账号正则 | `^[a-zA-Z][a-zA-Z0-9_]{4,14}$` |
| 密码强度 | ≥8 位，含大小写字母、数字、符号 |
| 保留账号 | admin/root/system/guest/test/administrator 禁止注册 |

## 数据安全

### SQL 注入防护

所有 SQL 使用参数化查询（`?` 占位符），禁止字符串拼接。

```typescript
// ✅ 正确
db.prepare('SELECT * FROM users WHERE username = ?').get(username);

// ❌ 禁止
db.prepare(`SELECT * FROM users WHERE username = '${username}'`);
```

### 数据隔离

用户数据严格按 `user_id` 过滤，IPC 调用必须验证当前用户身份。

### XSS 防护

禁止使用 `dangerouslySetInnerHTML`，使用 unified/remark 安全渲染。

## 密钥管理

| 机制 | 说明 |
|------|------|
| 存储 | Electron `safeStorage` 加密存 SQLite |
| 传输 | 网络请求全走主进程，密钥不落渲染进程 |
| 禁止 | 代码中 hardcode 密钥/Token/密码 |

## AI 安全

### 写控制

| 模式 | 行为 |
|------|------|
| `auto` | AI 直接执行写操作 |
| `manual` | 弹确认卡片（红删绿增预览） |

### 知情同意

首次联网/外发弹知情同意页：

- `allowNetwork`：允许联网
- `allowSend`：允许笔记外发

### 文件操作安全

`deleteLocalFile` 系统关键路径黑名单：

```
/windows/system, /program files, /usr, /bin, /etc, /root, /boot, /dev, /sys, /proc, /lib, /var
```

## 输入验证

| 输入 | 验证 |
|------|------|
| 用户名 | `^[a-zA-Z][a-zA-Z0-9_]{4,14}$` |
| 密码 | ≥8 位，含大小写字母、数字、符号 |
| 文件路径 | 系统路径黑名单检查 |
| IPC 参数 | 参数类型检查 + 业务逻辑校验 |

## 硬性规则

- 不提交密钥、API Key、密码、Token 或 `.env` 文件
- 不删除测试（除非明确批准）
- 不削弱认证或权限控制
- 不擅自修改已应用过的历史迁移文件
- 不将数据库、内部服务或管理接口暴露到公网
- 不自动部署到生产环境
