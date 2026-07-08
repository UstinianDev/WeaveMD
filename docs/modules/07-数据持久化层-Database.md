# 数据持久化层 (Database) 功能总结

> 模块编号：07 | 优先级：P0 | 最后更新：2026-07-08

---

## 1. 功能概述

使用 SQLite (better-sqlite3) 实现本地数据持久化，包含用户、文件、历史版本、设置四张表。支持 WAL 模式、外键约束、数据隔离、级联删除。

## 2. 架构位置

```
src/main/db/
├── index.ts       # 数据库初始化、迁移、生命周期管理
├── users.ts       # 用户 CRUD（创建、查询、验证、删除）
├── files.ts       # 文件 CRUD（创建、读取、更新、软删除）
├── history.ts     # 历史版本 CRUD（保存、查询、删除）
└── settings.ts    # 设置 CRUD（读取、更新）
```

## 3. 数据库 Schema

```sql
-- == 用户表 ==
CREATE TABLE users (
  id TEXT PRIMARY KEY,                    -- UUID
  username TEXT UNIQUE NOT NULL,          -- 小写存储，唯一约束
  password_hash TEXT NOT NULL,            -- bcrypt 哈希（12 轮 salt）
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  last_login TEXT
);

-- == 文件表 ==
CREATE TABLE files (
  id TEXT PRIMARY KEY,                    -- UUID
  user_id TEXT NOT NULL,                  -- 外键 → users.id
  name TEXT NOT NULL,
  content TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  modified_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT,                        -- 软删除字段
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- == 历史版本表 ==
CREATE TABLE history (
  id TEXT PRIMARY KEY,                    -- UUID
  file_id TEXT NOT NULL,                  -- 外键 → files.id
  version INTEGER NOT NULL DEFAULT 1,
  diff TEXT,                              -- 旧内容快照
  saved_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

-- == 设置表 ==
CREATE TABLE settings (
  id TEXT PRIMARY KEY,                    -- UUID
  user_id TEXT UNIQUE NOT NULL,           -- 外键 → users.id（一对一）
  theme TEXT DEFAULT 'dark',
  language TEXT DEFAULT 'zh-CN',
  custom_colors TEXT,                     -- JSON 字符串存储自定义颜色
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- == 索引 ==
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_files_user_modified ON files(user_id, modified_at);
CREATE INDEX idx_history_file_saved ON history(file_id, saved_at);
CREATE INDEX idx_settings_user ON settings(user_id);
```

## 4. 数据库配置

```typescript
// src/main/db/index.ts
export function initDatabase(): Database.Database {
  const dbPath = path.join(app.getPath('userData'), 'weaveMD.db');
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL'); // WAL 模式（更好的并发性能）
  db.pragma('foreign_keys = ON'); // 启用外键约束

  runMigrations(db); // 自动创建表和索引
  return db;
}
```

## 5. 各表 CRUD 操作

### 5.1 用户表 (users.ts)

| 函数                                      | 描述                  | SQL                                                     |
| ----------------------------------------- | --------------------- | ------------------------------------------------------- |
| `createUser(username, password)`          | 创建用户 + 默认设置   | `INSERT INTO users ...` + `INSERT INTO settings ...`    |
| `findByUsername(username)`                | 按用户名查询          | `SELECT * FROM users WHERE username = ?`                |
| `findById(userId)`                        | 按 ID 查询            | `SELECT * FROM users WHERE id = ?`                      |
| `validateCredentials(username, password)` | 验证登录凭据          | `SELECT` + `bcrypt.compareSync()` + `UPDATE last_login` |
| `isUsernameTaken(username)`               | 检查用户名是否已存在  | `SELECT id FROM users WHERE username = ?`               |
| `deleteUser(userId)`                      | 级联删除用户所有数据  | `DELETE FROM settings/history/files/users WHERE ...`    |
| `getAccountInfo(userId)`                  | 获取账号信息 + 文件数 | `SELECT` + `SELECT COUNT(*) FROM files`                 |

### 5.2 文件表 (files.ts)

| 函数                                         | 描述                               | SQL                                                                                      |
| -------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `createFile(userId, name, content?)`         | 创建文件                           | `INSERT INTO files ...`                                                                  |
| `getFile(fileId, userId)`                    | 获取单个文件（含 userId 验证）     | `SELECT * FROM files WHERE id = ? AND user_id = ? AND deleted_at IS NULL`                |
| `updateFileContent(fileId, userId, content)` | 更新文件内容                       | `UPDATE files SET content = ?, modified_at = ? WHERE ...`                                |
| `renameFile(fileId, userId, newName)`        | 重命名文件                         | `UPDATE files SET name = ?, modified_at = ? WHERE ...`                                   |
| `deleteFile(fileId, userId)`                 | 软删除文件                         | `UPDATE files SET deleted_at = ? WHERE ...`                                              |
| `listFiles(userId)`                          | 列出用户所有文件（按修改时间降序） | `SELECT * FROM files WHERE user_id = ? AND deleted_at IS NULL ORDER BY modified_at DESC` |

### 5.3 历史版本表 (history.ts)

| 函数                                  | 描述                       | SQL                                                              |
| ------------------------------------- | -------------------------- | ---------------------------------------------------------------- |
| `saveVersion(fileId, version, diff?)` | 保存版本快照               | `INSERT INTO history ...`                                        |
| `getHistoryForFile(fileId)`           | 获取文件历史（按时间降序） | `SELECT * FROM history WHERE file_id = ? ORDER BY saved_at DESC` |
| `getLastVersion(fileId)`              | 获取最后版本号             | `SELECT MAX(version) FROM history WHERE file_id = ?`             |
| `deleteHistory(fileId)`               | 删除文件的所有历史         | `DELETE FROM history WHERE file_id = ?`                          |

### 5.4 设置表 (settings.ts)

| 函数                                                        | 描述         | SQL                                                                                |
| ----------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------- |
| `getSettings(userId)`                                       | 获取用户设置 | `SELECT * FROM settings WHERE user_id = ?`                                         |
| `updateSettings(userId, { theme, language, customColors })` | 更新用户设置 | `UPDATE settings SET theme = ?, language = ?, custom_colors = ? WHERE user_id = ?` |

## 6. 数据隔离策略

### 6.1 按 user_id 过滤

所有文件操作都需要传递 `userId`，在 SQL 查询中使用 `WHERE user_id = ?` 确保数据隔离：

```typescript
// files.ts — 所有操作都包含 userId 验证
export function getFile(fileId: string, userId: string): IFile | undefined {
  return db
    .prepare('SELECT * FROM files WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(fileId, userId);
}
```

### 6.2 级联删除

使用外键 `ON DELETE CASCADE` 实现级联删除：

```typescript
// 删除用户时手动级联删除
export function deleteUser(userId: string) {
  db.prepare('DELETE FROM settings WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM history WHERE file_id IN (SELECT id FROM files WHERE user_id = ?)').run(
    userId
  );
  db.prepare('DELETE FROM files WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}
```

### 6.3 软删除

文件使用 `deleted_at` 字段实现软删除，而非物理删除：

```typescript
// 软删除
export function deleteFile(fileId: string, userId: string): boolean {
  const result = db
    .prepare('UPDATE files SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .run(new Date().toISOString(), fileId, userId);
  return result.changes > 0;
}

// 查询时排除已删除文件
export function listFiles(userId: string): IFile[] {
  return db
    .prepare(
      'SELECT * FROM files WHERE user_id = ? AND deleted_at IS NULL ORDER BY modified_at DESC'
    )
    .all(userId);
}
```

## 7. 文件保存流程

```
用户编辑 → 防抖 1200ms → editorStore.saveFile()
  ↓
IPC: file:save({ fileId, content, userId })
  ↓
主进程:
  1. getFile(fileId, userId) — 读取当前文件内容
  2. getLastVersion(fileId) — 获取最后版本号
  3. saveVersion(fileId, version + 1, currentContent) — 保存旧内容为历史版本
  4. updateFileContent(fileId, userId, newContent) — 更新文件内容
  ↓
返回更新后的文件对象
  ↓
editorStore 更新 currentFile + 标记 isDirty = false
```

## 8. 数据库生命周期

```
app.whenReady()
  → initDatabase() — 初始化数据库 + 运行迁移
  → registerAllIpcHandlers() — 注册 IPC

app.on('window-all-closed')
  → closeDatabase() — 关闭数据库连接

app.on('before-quit')
  → closeDatabase() — 关闭数据库连接
```

## 9. 关键设计决策

1. **WAL 模式**：启用 WAL (Write-Ahead Logging) 提升并发读写性能
2. **UUID 主键**：使用随机 UUID 作为主键，避免自增 ID 暴露数据量
3. **外键约束**：启用 `foreign_keys = ON` 保证数据完整性
4. **软删除**：文件使用软删除便于恢复，查询时过滤 `deleted_at IS NULL`
5. **数据隔离**：所有操作通过 `user_id` 过滤，切换账号时数据完全隔离
6. **历史版本**：每次保存前自动保存旧内容作为历史版本，支持版本回溯
7. **默认设置**：注册时自动创建用户默认设置（dark 主题 + zh-CN 语言）
