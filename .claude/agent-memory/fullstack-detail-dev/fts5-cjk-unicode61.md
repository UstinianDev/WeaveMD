---
name: fts5-cjk-unicode61
description: FTS5 unicode61 对连续中文当一个 token，Bare CJK match 不命中；需前缀查询或向量兜底
metadata:
  type: project
---

FTS5 `unicode61` 分词器把连续 CJK 字符视为**一个 token**（无字/词分割）。实测（Electron + better-sqlite3 3.49.2）：

- content `WeaveMD 知识库支持笔记全文检索与向量融合召回。` → 因 CJK run 是一个 token，
  直接 `MATCH '知识库'`（精确、非前缀）**返回 0**；`MATCH '知识*'`（前缀）或 `MATCH 'FTS5'`（ASCII 全 token）才命中。
- 迁移 DDL `tokenize='unicode61 remove_diacritics 2'` 本身正确；触发器同步 + BM25 join 回查 kb_chunks 均实证可用。

**Why:** 中文用户查询在 kbSearch（第 3 期批次 2）若裸用原始查询词走 `MATCH ?` 会因 token 不匹配而漏召回（计划 §4.3 已预告「查询污染净化」）。

**How to apply:** 批次 2 kbSearch 的 FTS5 路需对中文 query 做处理——转前缀（`词*`）或依赖向量路（nomic-embed-text）补 CJK 语义；单测断言须用前缀/ASCII 匹配避免误判为迁移 bug。冒烟脚本 `scripts/fts5-smoke.cjs` 已用 `知识*`+`FTS5` 双例证明迁移语义。
