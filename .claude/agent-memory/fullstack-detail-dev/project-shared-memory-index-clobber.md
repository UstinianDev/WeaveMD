---
name: shared-memory-index-clobber
description: 多个并行智能体共用 fullstack-detail-dev 记忆目录，MEMORY.md 索引会被整文件覆盖而非追加，写入前须合并
metadata:
  type: project
---

本项目多个并行智能体（拆分/文档/执行）共用同一记忆目录 `.claude/agent-memory/fullstack-detail-dev/`，`MEMORY.md` 会被后写者**整文件覆盖**而非追加——2026-10-03 拆分智能体一次写入把已有 8 条 multi-intent 索引行清成 1 行（原记忆文件仍在磁盘）。

**Why:** 索引是各会话的唯一入口，被覆盖后历史记忆事实性失联，且被覆盖的改动若随后入库即永久丢失索引。

**How to apply:** 写 `MEMORY.md` 前先用 `git show HEAD:<path>` 取已提交版本，与工作区当前内容合并去重后再写回；发现索引行缺失而对应 `.md` 文件存在时，主动补回。记忆文件本身可直接新增，不必等待。相关约定见 。
