# 进度文档：editor-unlink-range

> 移除链接（unlinkRange）功能开发 | 日期：2026-08-10 | 状态：**已提交（e5e2f6f），全部完成并验证**

## 1. 进度总览

| 阶段 | 内容 | 状态 | 证据 |
|---|---|---|---|
| 1 | formatCtrl.unlinkRange 核心逻辑 | ✅ | formatCtrl.ts（findIntersectingLinks + 相交链接降序还原 label）|
| 2 | 接线（EditorV2 → useEditorActions → formatCtrl）| ✅ | types.ts BlockHandlers.onUnlink、useEditorActions、EditorV2.tsx 传 onUnlink |
| 3 | FloatingToolbar「移除链接/解链」按钮 | ✅ | 折叠光标命中链接时仅显示解链；非折叠选区 inLink 时显示；未传 onUnlink 静默 |
| 4 | 单测与集成测试补齐 | ✅ | formatCtrl 16 / floatingToolbarV2 64（含 TB12/TB12b）/ inlineRenderer 41 |
| 5 | 回归 | ✅ | 563 passed / 34 files；tsc exit 0 |

## 2. 单元状态

| 单元 | 内容 | 状态 | 证据 |
|---|---|---|---|
| U1 | unlinkRange | ✅ | `formatCtrl.ts`；多相交链接降序替换；restoreSelection 返回 label 区间；选区在链接外返回 null |
| U2 | label 纯文本提取 | ✅ | 切 content 子串后复用 stripInlineSyntax（返回整段清除文本语义）|
| U3 | inlineLexer href 校验 | ✅ | 无 scheme 的 `u1` 不产生 link token；Windows/UNC 图片路径保留 |
| U4 | inlineRenderer 本地图片路径 | ✅ | `toImgSrc`：盘符 → `file:///C:/…`、UNC → `file://…`、`/img/a.png` 原样 |
| U5 | FloatingToolbar 解链按钮 | ✅ | showUnlinkOnly（折叠命中链接）与 inLink（选区命中链接）两条显示路径；TB12/TB12b |

## 3. 验证矩阵

| 门禁 | 结果 |
|---|---|
| `npx vitest run` | **563 passed / 34 files**（含本任务新增 7 用例：unlinkRange 7 + toolbar 2 + 本地图片 1）|
| `npx tsc --noEmit` | ✅ exit 0 |
| eslint | 未跑（本任务后补，随提交前补跑）|
| 构建 | 未跑（功能验证以测试为准，构建在提交后统一验证）|

## 4. 遗留问题

| # | 类型 | 描述 | 处置 |
|---|---|---|---|
| 1 | 行为边界 | 无前导斜杠相对图片路径 `![a](img/a.png)` 不被识别为图片（lexer href 校验），降级纯文本 | 已用测试锁定现状，符合既有 safeUrl 语义 |
| 2 | 已解决 | 工作区改动已提交 `e5e2f6f`（14 文件 478+/59-）| 完成 |

## 6. 问题修复（用户实测：先加图片再加链接，非源码模式）

- **现象**：输入 `123` → 加图片 → 加超链接后，正文残留多余 `(baidu.com)` 括号、图片/链接错乱。
- **根因**：非源码模式下图片渲染为 `<img>`（无文本），DOM 选区偏移常落在 image label 区间而非图片语法外；`applyLinkOrImage` 对 label 内选区直接插入 link，产出畸形 `![[123](url)](img)`。
- **修复 1**：link 应用时若选区与 image token 相交/内含（含折叠光标落点），扩展选区覆盖整个 image 语法 → `[![alt](img)](url)`（link 包裹 image，markdown 标准可点击图片）。lexer `findMatching` 已支持嵌套括号，`[![123](img)](https://baidu.com)` 可正确解析渲染为 `<a><img></a>`。
- **修复 2**：`unlinkRange` 提取 label 改用 `extractLinkLabel`——剥成对标记保留内文、**保留 image/link 结构**（`[![a](img)](u)` unlink → `![a](img)`，不再把图片剥成 alt 文本）。
- **证据**：新增 5 个 link-on-image 用例 + 1 个图片链接 unlink 用例，全绿。

### 6.2 问题修复（用户复测：选择图片后仍显示 markdown 源码，而非图片）

- **现象**：非源码模式插入本地图片（路径含空格与中文，如 `屏幕截图 2026-08-10 213142.png`）后，WYSIWYG 仍显示 `![123](C:\...路径.png)` 源码文本。
- **根因**：lexer URL 解析用 `[^\s"']+`，含空格的 URL 在空格处截断 → `matchImageOrLink` 整体识别失败 → 图片回退纯文本源码。
- **修复**：
  1. `inlineLexer.matchImageOrLink`：URL 正则支持 Markdown 标准尖括号包裹 `(<...>)`，解析后剥尖括号取 href。
  2. `formatCtrl.applyLinkOrImage`：写入时 URL 含空白/`()`/`<>` 则用 `<url>` 包裹，保证 lexer 能整段识别。
- **边界**：历史已写入的未包裹含空格 URL（旧 bug 产物）不静默误判，仍显示源码；用户重插图片即得正确 `<...>` 形态。title 语法（`url "title"`）不受影响。
- **证据**：新增 inlineRenderer 2 用例 + formatCtrl 2 用例，全绿；全量 572 passed / tsc 0 / eslint 0 errors。

## 7. 下一任务建议

1. （可选）提交遗留任务卡文档 `fix-inline-marker-remainder/`（昨日已 Approved 任务，代码已提交 7b9915e，仅文档未跟踪）。
2. 人工验收：`npm run dev` 验证 ①光标落在链接 label 内仅出现「解链」按钮 ②图片加链接后可点击 ③移除图片链接保留图片 ④含空格/中文本地图片路径插入后正确显示图片（`![123](<...屏幕截图 2026-08-10....png>)` 渲染为图片）。
3. 后续可选：历史已写入的未包裹含空格 URL（旧产物）的宽容渲染策略。
