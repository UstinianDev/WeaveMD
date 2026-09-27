---
name: doc-pipeline-b8-done
description: B8 批次（六工具/citation/评测/四-4检索）完成记录与四个实测环境坑
metadata:
  type: project
---

# doc-pipeline B8 完成（2026-09-27）

- **状态**：✅ 4 commit：`1ca9dc6`（四工具）→ `1d51eb6`（citation+IPC）→ `80b7f81`（前缀+评测）→ `9fbcfdc`（TDD/status）。全量 vitest 157 文件 3664 passed（B7 基线 3583+81）、tsc 0、lint 0 err/106 warn、vite build 0、E2E 31 failed 与基线同名单（零新增）。证据 `docs/testing/doc-pipeline-b8.tdd.md`。
- **下一任务**：B9（三-1 超长 md 发送 + 三-3 相对路径图片，L2）。计划 `docs/plan/doc-pipeline.plan.md` §2 B9。
- **Why**：B8 承担了 B11 的陈旧工具名清理（六-1②），B11 验收时核对无尾巴即可。
- **How to apply**：B9 做「树 md 不整篇内联」时，正文按需读取可路由 searchDocument/readPage（会话附件）或 readLocalFile（本地文件，1MB 上限、**无分块**——文案已改如实）。

## 四个实测坑（再遇直接套用）

1. **vitest 环境 `path.isAbsolute` 是 browserify posix 语义**：win32 下对 `C:\...` 返回 false（实测 `platform: win32, isAbsolute: false`）。主进程代码若在 IPC handler 里判 Windows 绝对路径，不要用 `path.isAbsolute`——用显式盘符/根/UNC 白名单正则，否则测试与生产行为不一致。
2. **BM25/`bm25()` 是负分，越小越好**（`ORDER BY bm` 升序）：kbSearch 管线 `rankCandidates` 按 `a.bm - b.bm` 升序排。构造检索固定样例时 bm 必须用负值，正分会让 top1 反转。
3. **JS 测试里写 Windows 路径经 bash 工具传参会吃转义**：`C:\\docs\\x.pdf` 经 JSON/bash 两层解码后落盘成 `C:\docs\x.pdf`，JS 再把 `\d`/`\r` 当转义 → 字符串变形。测试里统一用正斜杠 `C:/docs/x.pdf`。
4. **同文档多候选会被 `aggregateAndExpand` 段聚合改写 top1**：检索命中率固定集里候选要分属不同 documentId 才能测排序/加权本身。
