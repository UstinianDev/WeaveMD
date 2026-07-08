# 认证系统 (Auth) 功能总结

> 模块编号：02 | 优先级：P0 | 最后更新：2026-07-08

---

## 1. 功能概述

完整的本地认证系统，支持用户注册、登录、会话恢复、账号切换、记住密码、多账号管理。所有数据存储在本地 SQLite 数据库，无需网络连接。

## 2. 架构位置

```
src/render/pages/AuthPage.tsx                    # 认证页面容器（双栏布局）
src/render/components/Auth/
├── LoginPage.tsx                                # 登录表单
├── SignupPage.tsx                               # 注册表单
├── SplashLoader.tsx                             # 加载动画
├── InteractiveMascot.tsx                        # 交互式吉祥物
└── AuthWindowControls.tsx                       # 窗口控制按钮
src/render/stores/authStore.ts                   # 认证状态管理
src/render/utils/crypto.ts                       # 加密工具（记住密码）
src/render/utils/validators.ts                   # 验证工具
src/main/ipc-handlers.ts                         # 认证 IPC 处理器
src/main/db/users.ts                             # 用户数据库操作
src/shared/types.ts                              # 类型定义
src/shared/constants.ts                          # 常量（验证规则、保留账号）
```

## 3. 实现逻辑流程

### 3.1 注册流程

```
用户输入 → 前端实时验证 → IPC 调用主进程 → 数据库操作 → 返回结果
```

**步骤详解：**

```
┌─────────────────────────────────────────────────────────┐
│ 前端 (SignupPage.tsx)                                    │
│                                                         │
│ 1. 用户输入账号 (5-15位)                                 │
│ 2. 实时格式验证: /^[a-zA-Z][a-zA-Z0-9_]{4,14}$/        │
│ 3. 500ms 防抖后 IPC 检查账号可用性                       │
│ 4. 用户输入密码 → 强度指示器（弱/中/强）                 │
│ 5. 用户输入验证码（数学题 a [+/-/×/÷] b = ?）           │
│ 6. 勾选"已阅读条款"（可选）                              │
│ 7. 点击 Register → IPC 调用注册                          │
└──────────────────────┬──────────────────────────────────┘
                       │ ipcRenderer.invoke('auth:register')
                       ▼
┌─────────────────────────────────────────────────────────┐
│ 主进程 (ipc-handlers.ts → users.ts)                      │
│                                                         │
│ 1. 验证用户名格式（正则）                                │
│ 2. 检查保留账号列表                                      │
│ 3. 查询数据库检查是否已存在                              │
│ 4. bcryptjs.hashSync(password, 12) 加密密码              │
│ 5. INSERT INTO users (id, username, password_hash)       │
│ 6. 自动创建默认设置 (theme: 'dark', language: 'zh-CN')   │
│ 7. 返回 { success: true, userId }                        │
└──────────────────────┬──────────────────────────────────┘
                       │ IpcResponse
                       ▼
┌─────────────────────────────────────────────────────────┐
│ 前端 (SignupPage.tsx)                                    │
│                                                         │
│ 1. 显示成功提示                                          │
│ 2. 调用 onSwitchToLogin(username) 跳转登录页              │
│ 3. 登录页自动填充账号名                                  │
└─────────────────────────────────────────────────────────┘
```

### 3.2 登录流程

```
用户输入 → 前端验证 → IPC 调用 → 凭据验证 → JWT 生成 → 状态更新
```

**步骤详解：**

```
┌─────────────────────────────────────────────────────────┐
│ 前端 (LoginPage.tsx)                                    │
│                                                         │
│ 1. 加载历史账号列表 (localStorage)                       │
│ 2. 加载记住的凭据 (加密存储)                             │
│ 3. 用户选择/输入账号                                    │
│ 4. 用户输入密码                                          │
│ 5. 勾选"记住密码"（可选）                                │
│ 6. 点击 Log in → IPC 调用登录                           │
└──────────────────────┬──────────────────────────────────┘
                       │ ipcRenderer.invoke('auth:login')
                       ▼
┌─────────────────────────────────────────────────────────┐
│ 主进程 (ipc-handlers.ts → users.ts)                      │
│                                                         │
│ 1. 查询用户: SELECT * FROM users WHERE username = ?     │
│ 2. bcrypt.compareSync(password, password_hash)           │
│ 3. 更新 last_login                                      │
│ 4. jwt.sign({ userId, username }, secret, { expiresIn }) │
│    - 记住我: 30d  |  否则: 1d                           │
│ 5. 返回 { token, user: { id, username, ... } }          │
└──────────────────────┬──────────────────────────────────┘
                       │ IpcResponse<LoginResponse>
                       ▼
┌─────────────────────────────────────────────────────────┐
│ 前端 (LoginPage.tsx → authStore.ts)                      │
│                                                         │
│ 1. 保存记住的凭据（如勾选）                              │
│ 2. 显示 success 状态（600ms）                            │
│ 3. authStore.login(user, token):                         │
│    a. localStorage.setItem('weavemd_token', token)       │
│    b. localStorage.setItem('weavemd_user', JSON.stringify(user))
│    c. set({ user, token, isAuthenticated: true })        │
│    d. addRecentAccount(username)                         │
│ 4. App.tsx 检测 isAuthenticated → 跳转 MainPage          │
└─────────────────────────────────────────────────────────┘
```

### 3.3 会话恢复流程

```
App.tsx 启动
  ↓
读取 localStorage: weavemd_token + weavemd_user
  ↓
IPC: auth:validate-token(token)
  ↓
┌─── 有效 ───→ authStore.login(user, token) → 加载设置 → MainPage
│
└─── 无效 ───→ 清除 localStorage → AuthPage
```

### 3.4 账号切换流程

```
设置 → 账号管理 → 切换账号
  ↓
显示历史账号列表
  ↓
选择目标账号 → 输入密码
  ↓
IPC: auth:login(username, password)
  ↓
成功 → 清除旧 Token → 加载新账号数据
  ↓
所有 UI 状态、设置、文件列表全部重新加载
```

### 3.5 账号删除流程

```
设置 → 账号管理 → 删除账号
  ↓
确认弹框
  ↓
IPC: account:delete(userId)
  ↓
主进程级联删除:
  DELETE FROM settings WHERE user_id = ?
  DELETE FROM history WHERE file_id IN (SELECT id FROM files WHERE user_id = ?)
  DELETE FROM files WHERE user_id = ?
  DELETE FROM users WHERE id = ?
  ↓
清除 localStorage → 跳转登录页
```

## 4. 实现细节

### 4.1 类型定义

```typescript
// 登录请求/响应
interface LoginRequest {
  username: string;
  password: string;
  rememberMe: boolean;
}

interface LoginResponse {
  token: string;
  user: IUserPublic;
}

// 注册请求
interface RegisterRequest {
  username: string;
  password: string;
}

// 账号可用性检查
interface UsernameCheckResponse {
  available: boolean;
  message: string;
}

// 用户公开信息
interface IUserPublic {
  id: string;
  username: string;
  createdAt: string;
  lastLogin: string | null;
}

// 账号信息（设置页）
interface AccountInfo {
  username: string;
  createdAt: string;
  lastLogin: string | null;
  fileCount: number;
}
```

### 4.2 验证规则

```typescript
// src/shared/constants.ts
export const USERNAME_MIN_LENGTH = 5;
export const USERNAME_MAX_LENGTH = 15;
export const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]{4,14}$/;
export const PASSWORD_MIN_LENGTH = 8;
export const MAX_RECENT_ACCOUNTS = 10;

// 保留账号列表
export const RESERVED_USERNAMES = ['admin', 'root', 'system', 'guest', 'test', 'administrator'];
```

### 4.3 密码强度检测

| 等级 | 条件                                |
| ---- | ----------------------------------- |
| 弱   | 长度 < 8 或仅含一种字符类型         |
| 中   | 长度 ≥ 8 且含两种字符类型           |
| 强   | 长度 ≥ 8 且含大小写字母、数字、符号 |

### 4.4 验证码（数学题）

- 格式：`a [+/-/×/÷] b = ?`
- 范围：1-20 的正整数，结果为整数
- 支持重新生成（转圈图标）

### 4.5 JWT 实现

```typescript
// 密钥生成（每台机器唯一，重启后稳定）
function getJwtSecret(): string {
  return crypto.createHash('sha256').update(app.getPath('userData')).digest('hex');
}

// Token 生成
function generateToken(userId: string, username: string, rememberMe: boolean): string {
  const expiresIn = rememberMe ? '30d' : '1d';
  return jwt.sign({ userId, username }, getJwtSecret(), { expiresIn });
}

// Token 验证
function verifyToken(token: string): { userId: string; username: string } | null {
  try {
    return jwt.verify(token, getJwtSecret()) as { userId: string; username: string };
  } catch {
    return null;
  }
}
```

### 4.6 密码加密

```typescript
// 注册时加密
const BCRYPT_ROUNDS = 12;
const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);

// 登录时验证
const valid = bcrypt.compareSync(password, user.password_hash);
```

### 4.7 记住密码实现

```typescript
// src/render/utils/crypto.ts
// 使用 XOR + base64 加密存储凭据
// 存储键: 'weavemd_remembered'
// 有效期: 30 天
// 包含: { username, password, expiresAt }
```

### 4.8 历史账号管理

```typescript
// authStore.ts
addRecentAccount: (username) => {
  const { recentAccounts } = get();
  const filtered = recentAccounts.filter((a) => a !== username);
  const updated = [username, ...filtered].slice(0, 10); // 最多 10 个
  localStorage.setItem('weavemd_recent_accounts', JSON.stringify(updated));
  set({ recentAccounts: updated });
};
```

### 4.9 交互式吉祥物状态

| 状态             | 触发条件         | 视觉反馈   |
| ---------------- | ---------------- | ---------- |
| `idle`           | 无操作           | 默认表情   |
| `focus-username` | 账号输入框聚焦   | 看向输入框 |
| `focus-password` | 密码输入框聚焦   | 看向密码框 |
| `typing`         | 正在输入账号     | 打字动画   |
| `success`        | 登录/注册成功    | 微笑/庆祝  |
| `error`          | 验证失败         | 惊讶/难过  |
| `hover-submit`   | 鼠标悬停提交按钮 | 期待表情   |

### 4.10 IPC 通道

| 通道                  | 参数                                 | 返回值                            |
| --------------------- | ------------------------------------ | --------------------------------- |
| `auth:login`          | `{ username, password, rememberMe }` | `IpcResponse<LoginResponse>`      |
| `auth:register`       | `{ username, password }`             | `IpcResponse<{ userId: string }>` |
| `auth:check-username` | `username: string`                   | `UsernameCheckResponse`           |
| `auth:validate-token` | `token: string`                      | `IpcResponse<IUserPublic>`        |
| `account:info`        | `userId: string`                     | `IpcResponse<AccountInfo>`        |
| `account:delete`      | `userId: string`                     | `IpcResponse<void>`               |

## 5. 数据模型

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,                    -- UUID
  username TEXT UNIQUE NOT NULL,          -- 小写存储
  password_hash TEXT NOT NULL,            -- bcrypt 哈希
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  last_login TEXT
);

CREATE INDEX idx_users_username ON users(username);
```

## 6. 与其他模块的交互

| 模块       | 交互方式                                           |
| ---------- | -------------------------------------------------- |
| 编辑器     | 登录后加载用户文件列表；切换账号时清除编辑器状态   |
| 设置       | 登录后加载用户设置（主题、语言）；账号管理在设置中 |
| 导航栏     | 显示当前账号标签；账号切换入口                     |
| 数据持久化 | 所有数据库操作通过 `user_id` 过滤，实现数据隔离    |
| 窗口控制   | 认证页使用独立窗口控制组件                         |

## 7. 关键设计决策

1. **纯本地认证**：使用 SQLite + bcryptjs + JWT，无需后端服务，完全离线可用
2. **多账号支持**：同一用户可创建多个账号，数据通过 `user_id` 完全隔离
3. **JWT 密钥**：基于 `app.getPath('userData')` 的 SHA-256 哈希，每台机器唯一
4. **数据隔离**：所有操作通过 `user_id` 过滤，删除账号时级联删除所有关联数据
5. **交互式吉祥物**：7 种状态反馈，提升用户体验
6. **安全存储**：密码使用 bcrypt（12 轮 salt），记住密码使用 XOR + base64 加密
