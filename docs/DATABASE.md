# WeaveMD — 数据库设计

> 本章节为占位文档，将在开发过程中逐步完善。

## Schema 概览
- `users` — id, username (UNIQUE), password_hash, created_at, updated_at, last_login
- `files` — id, user_id, name, content, created_at, modified_at, deleted_at
- `history` — id, file_id, version, diff, saved_at
- `settings` — id, user_id, theme, language, custom_colors

## 索引
- users.username (快速查询检重)
- files.user_id + files.modified_at (快速查询用户的最近文件)
- history.file_id + history.saved_at

## IPC 数据流
render (IPC invoke) ↔ main (ipc-handlers) ↔ better-sqlite3