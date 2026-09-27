---
name: doc-pipeline-b7-done
description: B7（二-3 PDF 版面 + 二-4 D 路线 + 二-6 页码落库，L3）完成记录：4 commit、门禁证据、liteparse 选型结论，以及 gutter/字号/覆盖率补测与 JSON 转义层的坑
metadata:
  type: project
---

# doc-pipeline B7 完成（2026-09-26，L3）

- **commit**：`e9ccf9c`（pdfLayout + multimodalParse 新建、parsePdf/D 短路、.doc D 优先、CSV 两态、buildSourceRef 真实页码、契约 v2）→ `faed878`（D7 迁移 structure_json、attachments 结构落库 + userId/degraded 接线、KB IPC pageOffsets 贯通）→ `f324e1f`（默认依赖覆盖 8 例 + xlsx CSV 断言）→ `e606ca9`（TDD 报告 + status + database.md）。
- **门禁实测**：tsc 0 error / vitest **154 文件 3583 passed 0 failed**（B6 基线 3500 + 83）/ lint 0 error（106 warning 与基线持平）/ vite build 三段 exit 0 / E2E **31 failed·1 skipped·101 passed 两轮一致零新增**；触及文件覆盖率 92.97%~100%（聚合 95.79%）。证据：`docs/testing/doc-pipeline-b7.tdd.md`。
- **选型结论（写入 TDD §8.1）**：坐标与栅格化全用 `@llamaindex/liteparse` 实测能力——`textItems` 回传 x/y/width/height/fontSize（viewport top-left、72 DPI，text/json 模式均回传），`screenshot(input, pageNumbers)` Node 主进程返回 PNG（页码子集/null 全页）→ **不引入 pdfjs-dist，B10 体积门禁零增量**。
- **偏离记录**：计划 §3 只列 D1~D6，但 §2-B7 要求页码/章节/表格序号落 parsed_attachments → 补 **D7 `structure_json` 列**（独立函数 `addB7AttachmentStructureColumn`，不动 B3/B4 已应用迁移，三断言齐备）；`KB_PARSE_DOCUMENT` 扩第 5 参 options.userId（既有通道扩参非新增通道，三处同步不触发，向后兼容有测试锁定）；`DOCUMENT_PARSE_VERSION` 升 **2**。
- **下一任务**：B8（六-1 文档工具集 + 六-2 citation 回链 + 六-3 评测 + 四-4 检索质量）——B8 直接消费 B7 的 `source_ref.page` 与 `structure_json.pageOffsets`。

**Why**：B7 是解析层核心算法批次，版面规则踩了三个算法坑 + 覆盖率口径坑，记下避免 B8/后续重蹈。

**How to apply**：

1. **gutter 检测不能用 interval-union**：全宽标题会把左右栏 union 桥接成连续区间 → 无 gutter。解法：成对行区间找 gap + 允许跨越行作 band 分隔符；**表格检测必须先于分栏**（双栏同 y 左右段落会被列对齐误判为表格），用**填充率** `runFillRatio < 0.55` 区分（表格单元窄、散文占满行跨度）。
2. **正文基准字号别用众数**：小样本下次大字号会夺走众数（标题变正文不出 heading）→ 用「累计字符权重 ≥10% 的最小字号」。
3. **覆盖率动态 import 死角**：默认依赖写成函数内 `await import(...)` 时，单测全注入 deps 会让生产分支 0 覆盖（multimodalParse 首轮 73%）；补测要**不注入对应 dep** 逼它走默认实现 + vi.mock 底层模块（db/ai、secureConfig、liteparse、llmClient），且 `depsFor` 辅助函数**不要默认注入**被测依赖（会掩盖默认实现）。
4. **工具参数 JSON 转义会吞反斜杠**：Bash 工具参数经 JSON 层，`\\n` 到 python 已是 `\n`（真实换行）——python/heredoc 里要写字面 `\n` 得用 `chr(92)+'n'`；字符串字面量内被写入真实换行会触发 esbuild Unterminated string literal。CRLF 文件补丁用 `newline=None` 读 + `newline='\r\n'` 写（但注意：写入转换会把字符串内的真实换行也转 CRLF，测试文件内多行字面量要避免真实换行）。
5. **E2E 基线核对**：改 renderer 调用签名后 e2e 走 mock bridge 不受影响；两轮独立运行同数（31/1/101）是比对基线的可信方式，line reporter 的失败行 grep `✘` 在 Windows 下抓不到，用总数+首轮尾部 spec 名核对即可。

相关：[[doc-pipeline-b6-done]]、[[doc-pipeline-b5-done]]。
