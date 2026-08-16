---
name: editor-table-m1-codec
description: 可编辑表格块 M1 kernel 编解码——tableCodec.ts parser/serializer 契约、SEPARATOR_RE 与内核独立、isSeparatorRow 双判定
metadata:
  type: project
---

编辑表格块 M1（kernel 编解码）已交付，供 M2（TableBlock 渲染/编辑）与 M3（增删行列/导航）复用。关键契约：

- `parseTableText(text): TableMatrix`：空/<2 行→`{header:[],rows:[]}`；L1 必须是分隔行否则保守空；L0 表头定列数；L2+ 数据行 `padToColumns` 恒矩形。切分顺序：去首尾 `|` → `split(/(?<!\\)\|/)` → trim → `replace(/\\\|/g,'|')` 解义。**每格会 trim**（边界空白剥离），故含层首尾空格的矩阵不满足 `parse(serialize(m))===m`（属预期归一化）。
- `serializeTable(m): string`：`| c | c |` 每行、第 2 行固定 `| --- | --- |`、`escapeCell = s.replace(/\|/g,'\\|')`；空矩阵→`''`。
- **`isSeparatorRow(line)` 双判定**：`SEPARATOR_RE.test(line) || /-{3}/.test(line)`——后者覆盖单列无竖线分隔行 `---`（SEPARATOR_RE 的 `+` 组强依赖 `|`，纯 `---` 不匹配，必须靠 fallback）。与 `markdownToState.TABLE_SEPARATOR_RE`（L46）语义一致但独立，内核未改。
- 仅处理 `\|`，通用反斜杠字面保留（如 `\\`），`splitRowCells` 对 `\\|` 场景保守按字面。
- 文件：`src/render/editor/kernel/tableCodec.ts` + `tests/editor/kernel/tableCodec.test.ts`(21例) + `kernel/index.ts` `export * from './tableCodec'`。

**测试证据**：RED=套件因模块缺失解析失败(0 test)；GREEN=21/21 绿 + 内核 373/373 全绿（含 markdownRoundTrip 61 例无回归）；typecheck 0、eslint 0。

关联 [[rewrite-leaf-index-a4]]（同一 kernel 目录既有纯函数规范）。
