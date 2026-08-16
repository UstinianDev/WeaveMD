# editor-table-m1-codec — kernel 表格矩阵编解码（T1，先行）

角色：fullstack-detail-dev | TDD strict | 分支 feat/ai-agent-ph3-ph4 | 需求 T1.1~T1.4

## 范围（独立可跑，先行无依赖）

- `src/render/editor/kernel/tableCodec.ts`（**新**）：纯 TS 无 React/DOM。
  - `interface TableMatrix { header: string[]; rows: string[][] }`
  - `parseTableText(text): TableMatrix`：空/<2行→`{header:[],rows:[]}`；L0=表头、L1=分隔行
    （宽松正则 `^ *\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$`，不匹配→保守空）；
    L2+ 数据行；切分：去首尾 `|` → `split(/(?<!\\)\|/)` → trim → `replace(/\\\|/g,'|')` 解义；
    不足补空、多余截断（恒矩形）。仅处理 `\|`，不做通用反斜杠解义。
  - `serializeTable(m): string`：`| c | c |` 行，第 2 行固定 `| --- | --- |`，`escapeCell = s.replace(/\|/g,'\\|')`，
    空矩阵→`''`，无尾空行。
  - 互逆不变量：`parse(serialize(m))===m`（矩形 m）。
- `src/render/editor/kernel/index.ts`：`export * from './tableCodec';`
- `tests/editor/kernel/tableCodec.test.ts`（**新**，先写 RED）：往返、`\|` 转义/解义、对齐容错
  （`:---:` 输入→`---` 输出归一）、畸形保守空、与 `markdownToState`/`stateToMarkdown` 端到端往返
  （`parseTableText(serializeTable(...))` 后经 markdownToState 重解析列数一致）。

## 关键实现点

- 独立 `isSeparatorRow(line)` 辅助函数，注释标明与 `markdownToState.TABLE_SEPARATOR_RE` 独立（不改内核）。
- 单元格切分必须先按未转义 `|` 切，再对每格解义 `\|`（负向后瞻 `/(?<!\\)\|/`）。
- 不引入任何外部依赖；纯函数，无 I/O。

## 门禁

- `npx vitest run tests/editor/kernel/tableCodec.test.ts` 全绿（含先 RED 证据）
- `npm run typecheck` 0 error | `npm run lint` 0 error（本模块文件）
- 只返回结构化摘要：{完成项, 测试证据, 未完成项, 风险}，附 parse/serialize 签名与互逆测试关键断言。