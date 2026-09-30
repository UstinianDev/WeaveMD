# 安全架构

> 最后更新：2026-10-01（2026-09-09 首版；含 agent-cost-optimize 2026-09-23 的三配置门禁/联网同意闸停用、知识库开关随 Module 10 移除等后续结论）

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

| 模式 | 设计意图 | 实现现状（B11 八-2② 如实记录） |
|------|------|------|
| `auto` | AI 直接执行写操作 | **主进程工具执行路径无消费点**——仅 UI toggle + IPC 持久化（`ai_config.write_mode`），不构成权限放宽 |
| `manual` | 弹确认卡片（红删绿增预览） | 生效路径：`FORCE_CONFIRM_TOOLS` 硬确认（删除类）+ proposal 确认（恒 manual）；附件/解析产物写入一律按 manual 确认语义（仅用户显式动作触发，AI 工具集无触发点） |

> `write_mode` 完整接线列为后续（不阻塞）；staleness 实为 **xxHash64**（`src/shared/utils/hashUtil.ts`），非早期文档所称 MD5。

### 知情同意

联网许可已由**三配置门禁**（LLM + Embedding + 搜索任一缺失即锁面板）表达，故独立联网同意闸停用：

- ~~`allowNetwork`：允许联网~~ —— `needsConsent` 恒返回 `false`，DB 列保留作历史数据兼容
- `allowSend`：允许笔记外发（KB 外发闸，`needsKbSendConsent` / `ConsentOverlay`）
  —— 注：渲染侧唯一触发点是 `useKnowledgeBase && !allowSend`，而知识库开关已随 Module 10 移除，
  故该弹层**当前在生产 UI 中不可达**（主进程 KB 工具注入仍按 `kbEgressAuthorized` 生效）

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
